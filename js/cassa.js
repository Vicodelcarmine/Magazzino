// Le chiusure di cassa: dal foglio «STAMPA ARTICOLI» alle vendite. Funzioni pure, senza pagina.
//
// La cassa stampa ogni notte l'elenco di ciò che ha venduto: codice della voce, descrizione, quantità, incasso.
// Il raccoglitore consegna il foglio così com'è; qui lo si interpreta, e si decide per ogni voce a quale
// piatto corrisponde (i «codici di cassa» dei piatti, collegamenti_piatto con sistema = cassa).

// «18.0» → «18»: i fogli scrivono i codici numerici con la virgola.
export function codiceCassa(valore) {
  let s = String(valore == null ? "" : valore).trim();
  if (/^\d+[.,]0+$/.test(s)) s = s.replace(/[.,]0+$/, "");
  return s;
}

function numero(valore) {
  let t = String(valore == null ? "" : valore).trim().replace(/[€\s]/g, "");
  if (!t) return 0;
  if (t.indexOf(",") >= 0 && t.indexOf(".") >= 0) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

// «STAMPA ARTICOLI del 22-11-2026 01.14.21» → l'istante della chiusura (ora del locale). null se il nome non lo dice.
export function quandoChiusura(nomeFile) {
  const m = /del (\d{2})-(\d{2})-(\d{4}) (\d{2})\.(\d{2})\.(\d{2})/.exec(String(nomeFile || ""));
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// valori: le righe del foglio (ogni riga un elenco di celle). Le intestazioni stanno alla riga 6, le voci dalla 7;
// la colonna A è il codice, la B la descrizione; quantità e importo si trovano dal nome della colonna.
// Restituisce [{ codice, descrizione, quantita, importo }], una riga per codice.
export function leggiChiusura(valori) {
  const righe = Array.isArray(valori) ? valori : [];
  if (righe.length < 7) return [];
  const testa = (righe[5] || []).map((c) => String(c || "").trim().toLowerCase().replace(/à/g, "a"));
  let colQta = 2, colImporto = null;
  testa.forEach((h, i) => {
    const eQta = ["qta", "quantit", "qty", "pz"].some((k) => h.includes(k));
    if (eQta) colQta = i;
    if (colImporto == null && !eQta && ["importo", "totale", "valore", "amount", "incasso"].some((k) => h.includes(k))) colImporto = i;
  });
  const perCodice = new Map();
  righe.slice(6).forEach((r) => {
    if (!Array.isArray(r) || !r.length) return;
    const codice = codiceCassa(r[0]);
    const quantita = numero(r[colQta]);
    if (!codice || !(quantita > 0)) return;
    const importo = colImporto != null ? numero(r[colImporto]) : 0;
    const gia = perCodice.get(codice);
    if (gia) { gia.quantita += quantita; gia.importo += importo; gia.descrizione = gia.descrizione || String(r[1] || "").trim(); }
    else perCodice.set(codice, { codice: codice, descrizione: String(r[1] || "").trim(), quantita: quantita, importo: importo });
  });
  return Array.from(perCodice.values()).map((x) => Object.assign(x, { importo: Math.round(x.importo * 100) / 100 }));
}

// Il riferimento che lega una vendita alla sua voce di chiusura.
export const riferimentoVendita = (nomeFile, codice) => nomeFile + "#" + codice;

// Cosa c'è da scrivere per una chiusura.
//  collegamenti: i codici di cassa dei piatti; movimenti: quelli già nel registro (per non ripetere niente).
// Restituisce { vendite: [righe di movimento senza id], senzaPiatto: [voci], gia: quante c'erano già }.
export function daRegistrare(chiusura, voci, collegamenti, movimenti, extra) {
  const quando = quandoChiusura(chiusura.nome_file);
  const perCodice = new Map();
  (collegamenti || []).forEach((c) => { if (c.sistema === "cassa") perCodice.set(codiceCassa(c.chiave), c.piatto_id); });
  const fatti = new Set();
  let interaGia = false; // le chiusure portate dal vecchio gestionale hanno come riferimento il solo nome del file
  (movimenti || []).forEach((m) => {
    if (m.tipo !== "vendita") return;
    if (m.riferimento === chiusura.nome_file) interaGia = true;
    else if (String(m.riferimento || "").startsWith(chiusura.nome_file + "#")) fatti.add(m.riferimento);
  });
  const esito = { vendite: [], senzaPiatto: [], gia: 0, quando: quando };
  if (!quando) return esito;
  voci.forEach((v) => {
    const piatto = perCodice.get(v.codice);
    if (!piatto) { esito.senzaPiatto.push(v); return; }
    const rif = riferimentoVendita(chiusura.nome_file, v.codice);
    if (interaGia || fatti.has(rif)) { esito.gia += 1; return; }
    esito.vendite.push(Object.assign({ tipo: "vendita", piatto_id: piatto, quantita: v.quantita,
      importo_unitario: v.importo > 0 ? Math.round(v.importo / v.quantita * 1e6) / 1e6 : null,
      avvenuto_il: quando, origine: "cassa", riferimento: rif }, extra || {}));
  });
  return esito;
}

// Le voci di cassa che non hanno ancora un piatto, sommate su tutte le chiusure arrivate: da sistemare.
export function vociDaSistemare(chiusure, collegamenti) {
  const noti = new Set((collegamenti || []).filter((c) => c.sistema === "cassa").map((c) => codiceCassa(c.chiave)));
  const out = new Map();
  (chiusure || []).forEach((c) => {
    if (c.stato === "scartata") return;
    let valori = [];
    try { valori = JSON.parse(c.valori || "[]"); } catch (e) { valori = []; }
    leggiChiusura(valori).forEach((v) => {
      if (noti.has(v.codice)) return;
      const x = out.get(v.codice) || { codice: v.codice, descrizione: v.descrizione, quantita: 0, importo: 0, chiusure: 0 };
      x.quantita += v.quantita; x.importo = Math.round((x.importo + v.importo) * 100) / 100; x.chiusure += 1;
      x.descrizione = x.descrizione || v.descrizione;
      out.set(v.codice, x);
    });
  });
  return Array.from(out.values()).sort((a, b) => b.importo - a.importo);
}
