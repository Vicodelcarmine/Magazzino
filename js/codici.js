// Codici leggibili (PIZ-001, LAT-009): prefisso dalla categoria, numero progressivo.
// Logica ripresa dal vecchio gemello (js/codice_piatto.js). Qui il codice è solo
// un'etichetta: l'identità vera di piatti e articoli è il loro id.
// Le liste sono oggetti con { codice, categoria }.

function chiave(nome) {
  return String(nome || "").trim().toLocaleLowerCase("it");
}

function etichetta(nome) {
  const t = String(nome || "").trim();
  if (!t) return "";
  return t.charAt(0).toLocaleUpperCase("it") + t.slice(1);
}

export function lettereCategoria(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

function parti(codice) {
  const m = /^([A-Z]+)-(\d+)$/.exec(String(codice || "").trim().toUpperCase());
  return m ? { prefisso: m[1], n: Number(m[2]) } : null;
}

// «dallAltraParte»: i codici dell'altra famiglia (gli articoli quando si crea un piatto,
// i piatti quando si crea un articolo). I loro prefissi risultano sempre occupati,
// così un piatto e un articolo non finiscono mai con lo stesso codice.
const ALTRA_FAMIGLIA = "\u0000altra famiglia";

function occupati(lista, dallAltraParte) {
  const map = new Map();
  (dallAltraParte || []).forEach((p) => {
    const parte = parti(p && p.codice);
    if (!parte) return;
    if (!map.has(parte.prefisso)) map.set(parte.prefisso, new Set());
    map.get(parte.prefisso).add(ALTRA_FAMIGLIA);
  });
  (lista || []).forEach((p) => {
    const parte = parti(p && p.codice);
    if (!parte) return;
    const k = chiave(p && p.categoria);
    if (!map.has(parte.prefisso)) map.set(parte.prefisso, new Set());
    if (k) map.get(parte.prefisso).add(k);
  });
  return map;
}

function libero(map, prefisso, chiaveCat) {
  const set = map.get(prefisso);
  if (!set || !set.size) return true;
  return set.size === 1 && set.has(chiaveCat);
}

function prefissoNuovo(categoria, map) {
  const chiaveCat = chiave(categoria);
  const lettere = lettereCategoria(categoria);
  const piene = lettere.length >= 3 ? lettere : (lettere + "XXX").slice(0, 3);
  for (let n = 3; n <= piene.length; n++) {
    const c = piene.slice(0, n);
    if (libero(map, c, chiaveCat)) return c;
  }
  const radice = piene.slice(0, 3);
  for (let n = 0; n < 26; n++) {
    const c = radice + String.fromCharCode(65 + n);
    if (libero(map, c, chiaveCat)) return c;
  }
  let n = 2;
  while (!libero(map, radice + n, chiaveCat)) n += 1;
  return radice + String(n);
}

function prefissiCategoria(lista, categoria) {
  const chiaveCat = chiave(categoria);
  const trovati = [];
  (lista || []).forEach((p) => {
    if (chiave(p && p.categoria) !== chiaveCat) return;
    const parte = parti(p && p.codice);
    if (parte && trovati.indexOf(parte.prefisso) < 0) trovati.push(parte.prefisso);
  });
  return trovati;
}

function prossimoNumero(lista, prefisso) {
  let max = 0;
  (lista || []).forEach((p) => {
    const parte = parti(p && p.codice);
    if (parte && parte.prefisso === prefisso && parte.n > max) max = parte.n;
  });
  return max + 1;
}

function componi(prefisso, n) {
  return prefisso + "-" + String(n).padStart(3, "0");
}

// Piatti: si continua il prefisso già usato nella categoria (quello col numero più alto).
export function prossimoCodicePiatto(piatti, categoria, articoli) {
  const chiaveCat = chiave(categoria);
  let scelto = "";
  let maxN = -1;
  (piatti || []).forEach((p) => {
    if (chiave(p && p.categoria) !== chiaveCat) return;
    const parte = parti(p && p.codice);
    if (parte && parte.n > maxN) { maxN = parte.n; scelto = parte.prefisso; }
  });
  const prefisso = scelto || prefissoNuovo(categoria, occupati(piatti, articoli));
  return componi(prefisso, prossimoNumero(piatti, prefisso));
}

// Articoli: un solo prefisso nella categoria → si continua quello. Più prefissi
// (la dispensa ha FAR, OLI e LAT) → se ne crea uno dalle lettere della categoria,
// senza rubare un codice già di un'altra.
export function prossimoCodiceArticolo(articoli, categoria, piatti) {
  const trovati = prefissiCategoria(articoli, categoria);
  const prefisso = trovati.length === 1 ? trovati[0] : prefissoNuovo(categoria, occupati(articoli, piatti));
  return componi(prefisso, prossimoNumero(articoli, prefisso));
}

export function categorie(lista) {
  const visti = new Map();
  (lista || []).forEach((p) => {
    const mostra = etichetta(p && p.categoria);
    const k = chiave(mostra);
    if (k && !visti.has(k)) visti.set(k, mostra);
  });
  return Array.from(visti.values()).sort((a, b) => a.localeCompare(b, "it"));
}

// Il codice di una cosa NUOVA. Lo decide sempre il sistema, mai chi scrive:
// progressivo dentro la sua famiglia, e mai uguale a un codice già esistente,
// né fra gli articoli né fra i piatti.
// famiglia: "articolo" | "preparazione" | "piatto"
export function codiceNuovo(famiglia, categoria, articoli, piatti) {
  const proposto = famiglia === "piatto"
    ? prossimoCodicePiatto(piatti, categoria || "Piatti", articoli)
    : prossimoCodiceArticolo(articoli, categoria || (famiglia === "preparazione" ? "Preparazioni" : "Articoli"), piatti);
  const presi = new Set((articoli || []).concat(piatti || []).map((x) => String(x.codice || "").toUpperCase()));
  const parte = parti(proposto);
  let n = parte.n;
  while (presi.has(componi(parte.prefisso, n))) n += 1;
  return componi(parte.prefisso, n);
}
