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
