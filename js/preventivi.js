// Preventivi dei fornitori: il link, il controllo di ciò che il fornitore ha scritto, i prezzi da caricare.
// Funzioni senza pagina. Ciò che arriva dal fornitore è testo scritto da un estraneo: qui lo si ripulisce
// prima di mostrarlo o di farne dei prezzi.

// Un link nuovo: 24 byte a caso, scritti con lettere e cifre che stanno bene in un indirizzo.
export function nuovoGettone() {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// L'impronta del link, che è ciò che resta nell'archivio (lo stesso conto che fa l'archivio quando il link arriva).
export async function improntaDi(gettone) {
  const dati = new TextEncoder().encode(String(gettone));
  const h = await globalThis.crypto.subtle.digest("SHA-256", dati);
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("");
}

// L'indirizzo da mandare al fornitore. Il link sta dopo il cancelletto.
export function indirizzoLink(paginaApp, gettone, archivio) {
  const base = String(paginaApp).replace(/[#?].*$/, "").replace(/[^/]*$/, "");
  return base + "preventivo.html" + (archivio ? "?archivio=" + encodeURIComponent(archivio) : "") + "#" + gettone;
}

export function scadeFra(giorni, oggi) {
  const n = Math.round(Number(giorni));
  if (!(n >= 1 && n <= 365)) return null;
  const d = new Date(oggi || Date.now());
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function testoWhatsApp(fornitore, indirizzo, scade) {
  const p = String(scade || "").slice(0, 10).split("-");
  const fino = p.length === 3 ? " Valido fino al " + p[2] + "/" + p[1] + "/" + p[0] + "." : "";
  return "Ciao " + fornitore + ", qui il link per il preventivo." + fino + "\n" + indirizzo;
}

function elenco(testoJson) {
  try { const v = JSON.parse(testoJson || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
export const articoliDi = (p) => elenco(p.articoli).filter((a) => a && a.id && a.nome)
  .map((a) => ({ id: String(a.id), nome: String(a.nome), udm: a.udm === "L" || a.udm === "pz" ? a.udm : "kg" }));

const pulito = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const numero = (v, massimo) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= massimo ? v : null);

// La risposta del fornitore, ripulita: solo righe con prezzo e formato sensati; le righe normali solo se
// riguardano un articolo che era davvero nella richiesta. Gli «alternativi» sono articoli proposti da lui.
export function righeControllate(p) {
  const chiesti = new Map(articoliDi(p).map((a) => [a.id, a]));
  const viste = new Set();
  const out = [];
  elenco(p.righe).slice(0, 2000).forEach((r) => {
    if (!r || typeof r !== "object") return;
    const prezzo = numero(r.prezzo, 100000), confezione = numero(r.confezione, 100000);
    if (prezzo == null || confezione == null) return;
    const id = pulito(r.id, 60);
    if (!id || viste.has(id)) return;
    const base = { id: id, prezzo: Math.round(prezzo * 100) / 100, confezione: Math.round(confezione * 1e4) / 1e4,
      codice: pulito(r.codice, 40), note: pulito(r.note, 240) };
    if (r.alternativo === true) {
      const unita = ["g", "kg", "L", "PZ"].indexOf(r.unita) >= 0 ? r.unita : "kg";
      out.push(Object.assign(base, { alternativo: true, nome: pulito(r.nome, 80) || "Articolo alternativo",
        udm: unita === "L" ? "L" : (unita === "PZ" ? "pz" : "kg") }));
    } else {
      const a = chiesti.get(id);
      if (!a) return; // non era nella richiesta: non si considera
      out.push(Object.assign(base, { alternativo: false, nome: a.nome, udm: a.udm }));
    }
    viste.add(id);
  });
  return out;
}

// I prezzi da scrivere quando il titolare preme «Carica».
//  associa: { id della riga alternativa → id di un articolo di magazzino } (le non associate non entrano).
//  articoli: gli articoli di magazzino, per controllare che l'articolo esista e l'unità sia la stessa.
export function prezziDaCaricare(p, associa, articoli, oggi) {
  const perId = new Map((articoli || []).map((a) => [a.id, a]));
  // Il prezzo vale dal giorno in cui il fornitore l'ha mandato, non da quando lo si carica.
  const mandato = /^\d{4}-\d{2}-\d{2}/.test(String(p.inviato_il || "")) ? String(p.inviato_il).slice(0, 10) : "";
  const data = mandato || oggi || new Date().toISOString().slice(0, 10);
  const out = [], saltate = [];
  righeControllate(p).forEach((r) => {
    const articoloId = r.alternativo ? (associa || {})[r.id] : r.id;
    const a = articoloId ? perId.get(articoloId) : null;
    if (!a) { if (!r.alternativo) saltate.push(r.nome + ": l'articolo non c'è più in magazzino"); return; }
    if (a.udm !== r.udm) { saltate.push(r.nome + ": il prezzo è al " + r.udm + ", l'articolo si conta in " + a.udm); return; }
    out.push({ articolo_id: a.id, fornitore_id: p.fornitore_id, tipo: "preventivo", data: data, prezzo_udm: r.prezzo,
      qta_confezione: r.confezione, origine: "prev:" + p.id, codice: r.codice });
  });
  return { prezzi: out, saltate: saltate };
}

// L'elenco degli articoli da mandare al fornitore come file che Excel apre (punto e virgola, come vuole Excel in italiano).
export function fileArticoli(articoli) {
  const cella = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const righe = [["Articolo", "Unità", "Cod. fornitore", "Formato confezione", "Prezzo per unità", "Note"]]
    .concat(articoli.map((a) => [a.nome, a.udm, "", "", "", ""]));
  return "﻿" + righe.map((r) => r.map(cella).join(";")).join("\r\n") + "\r\n";
}
