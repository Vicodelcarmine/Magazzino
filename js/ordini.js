// Ordini ai fornitori: scadenza della fattura attesa, ritardi, testo da inviare. Funzioni pure, senza pagina.

// Entro quanti giorni lavorativi arriva la fattura, se sul fornitore non è scritto altro.
export const GIORNI_PREDEFINITI = 2;

// I giorni lavorativi di attesa per questo fornitore. 0 = non si aspetta la fattura.
export function giorniDi(fornitore) {
  const n = fornitore ? fornitore.giorni_fattura : null;
  return n == null || n === "" ? GIORNI_PREDEFINITI : Math.max(0, Math.round(Number(n)));
}

const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

// Il giorno entro cui la fattura deve essere arrivata: tanti giorni lavorativi dopo l'ordine
// (sabato e domenica non contano: ordine di giovedì, due giorni → lunedì). null se non si aspetta.
export function scadenza(inviatoIl, giorni) {
  if (!(giorni > 0)) return null;
  const d = new Date(inviatoIl);
  d.setHours(12, 0, 0, 0);
  let restano = giorni;
  while (restano > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) restano -= 1;
  }
  return iso(d);
}

// Vero se l'ordine aspetta ancora la fattura e il termine è passato (il giorno del termine è ancora buono).
export function inRitardo(ordine, adesso) {
  return ordine.stato === "aperto" && !!ordine.attesa_entro && String(ordine.attesa_entro).slice(0, 10) < iso(new Date(adesso));
}

export function righeDi(ordine) {
  try { const r = JSON.parse(ordine.righe || "[]"); return Array.isArray(r) ? r : []; } catch (e) { return []; }
}

const numero = (n) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 }).format(Number(n));
// Come si scrive una riga a un fornitore: a confezioni quando l'articolo si compra a confezioni.
export function quantoTesto(r) {
  if (r.colli != null && r.qtaConfezione > 0) {
    return numero(r.colli) + (Number(r.colli) === 1 ? " confezione" : " confezioni") + " da " + numero(r.qtaConfezione) + " " + r.udm;
  }
  return numero(r.quantita) + " " + r.udm;
}

// Il messaggio da mandare con WhatsApp o per email.
export function testoOrdine(ristorante, righe, nota) {
  return ["Buongiorno, ordine per " + ristorante + ":", ""]
    .concat(righe.map((r) => "• " + r.nome + ": " + quantoTesto(r)))
    .concat(nota ? ["", nota] : [], ["", "Grazie."]).join("\n");
}

// L'ordine più vecchio ancora aperto di questo fornitore, a cui una fattura con questa data può riferirsi
// (una fattura più vecchia dell'ordine non può essere la sua).
export function ordinePerFattura(ordini, fornitoreId, dataFattura) {
  return (ordini || []).filter((o) => o.stato === "aperto" && o.fornitore_id === fornitoreId
    && iso(new Date(o.inviato_il)) <= String(dataFattura).slice(0, 10))
    .sort((a, b) => String(a.inviato_il).localeCompare(String(b.inviato_il)))[0] || null;
}

// ----- confronto fra ciò che si è ordinato e ciò che la fattura porta -----

// Entro questo scarto due quantità si considerano uguali (un prosciutto ordinato a 4 kg ne pesa 4,1).
export const SCARTO = 0.05;

// righeOrdine: quelle salvate nell'ordine. righeFattura: [{ articolo_id, quantita }] di ciò che entra in magazzino.
// nomi: Map(articolo_id → { nome, udm }) per dare un nome alle cose arrivate senza essere state ordinate.
export function confronta(righeOrdine, righeFattura, nomi) {
  const arrivato = new Map();
  (righeFattura || []).forEach((r) => {
    if (!r.articolo_id || !(Number(r.quantita) > 0)) return;
    arrivato.set(r.articolo_id, (arrivato.get(r.articolo_id) || 0) + Number(r.quantita));
  });
  const out = { uguali: [], diverse: [], mancanti: [], inPiu: [] };
  const visti = new Set();
  (righeOrdine || []).forEach((o) => {
    visti.add(o.articolo_id);
    const ordinata = Number(o.quantita), avuta = arrivato.get(o.articolo_id) || 0;
    const voce = { articolo_id: o.articolo_id, nome: o.nome, udm: o.udm, ordinata: ordinata, arrivata: Math.round(avuta * 1e4) / 1e4 };
    if (!(avuta > 0)) out.mancanti.push(voce);
    else if (Math.abs(avuta - ordinata) <= SCARTO * ordinata) out.uguali.push(voce);
    else out.diverse.push(voce);
  });
  arrivato.forEach((q, id) => {
    if (visti.has(id)) return;
    const a = nomi && nomi.get(id);
    out.inPiu.push({ articolo_id: id, nome: a ? a.nome : "articolo", udm: a ? a.udm : "", ordinata: 0, arrivata: Math.round(q * 1e4) / 1e4 });
  });
  out.tuttoTorna = !out.diverse.length && !out.mancanti.length && !out.inPiu.length;
  return out;
}

// L'ultimo prezzo pagato a QUESTO fornitore per un articolo, prima di questa fattura.
export function ultimoPrezzo(prezzi, articoloId, fornitoreId) {
  return (prezzi || []).filter((p) => p.articolo_id === articoloId && p.fornitore_id === fornitoreId && !p.annullato_il
    && p.tipo !== "preventivo" && Number(p.prezzo_udm) > 0)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.creato_il || "").localeCompare(String(a.creato_il || "")))[0] || null;
}

// Gli articoli che in questa fattura costano più dell'ultima volta, oltre la soglia (0,1 = 10%).
// righeFattura: [{ articolo_id, quantita, importo }].
export function aumenti(righeFattura, prezzi, fornitoreId, soglia, nomi) {
  const out = [];
  const fatti = new Set();
  (righeFattura || []).forEach((r) => {
    if (!r.articolo_id || !(Number(r.quantita) > 0) || !(Number(r.importo) > 0) || fatti.has(r.articolo_id)) return;
    const prima = ultimoPrezzo(prezzi, r.articolo_id, fornitoreId);
    if (!prima) return;
    const ora = Number(r.importo) / Number(r.quantita), ieri = Number(prima.prezzo_udm);
    if (ora > ieri * (1 + (soglia == null ? 0.1 : Number(soglia)))) {
      fatti.add(r.articolo_id);
      const a = nomi && nomi.get(r.articolo_id);
      out.push({ articolo_id: r.articolo_id, nome: a ? a.nome : "articolo", udm: a ? a.udm : "", prima: ieri, ora: ora,
        delta: ora / ieri - 1, dataPrima: String(prima.data).slice(0, 10) });
    }
  });
  return out.sort((x, y) => y.delta - x.delta);
}

// Una spesa fatta di persona (lista unica) è un ordine già ritirato: non c'è niente da inviare, ma la fattura si aspetta lo stesso.
export const DI_PERSONA = "Spesa fatta di persona";
export const eDiPersona = (ordine) => String(ordine.nota || "").startsWith(DI_PERSONA);
