// La copia dei dati tenuta sul dispositivo (telefono o computer), per non riscaricare tutto
// ogni volta e per poter leggere anche senza rete.
//
// Ogni copia sta in uno «spazio» che dice di chi è: archivio + utente + ristorante.
// Così un altro utente sullo stesso telefono non vede e non usa mai le righe di un altro.
// Dentro lo spazio, per ogni tabella: le righe e il «segno», cioè il numero d'ordine
// dell'ultima modifica già scaricata.

// Le righe stanno anche in memoria, per non rileggerle dal disco a ogni pagina.
function conMemoria(disco) {
  const memoria = new Map(); // "spazio|tabella" → Map(id → riga)
  const k = (s, t) => s + "|" + t;
  async function carica(s, t) {
    if (!memoria.has(k(s, t))) {
      const m = new Map();
      (await disco.leggi(s, t)).forEach((r) => m.set(r.id, r));
      memoria.set(k(s, t), m);
    }
    return memoria.get(k(s, t));
  }
  return {
    async leggi(s, t) { return Array.from((await carica(s, t)).values()); },
    async conta(s, t) { return (await carica(s, t)).size; },
    // Aggiunge righe nuove e sostituisce quelle con la stessa identità.
    async metti(s, t, righe) {
      if (!righe.length) return;
      const m = await carica(s, t);
      righe.forEach((r) => m.set(r.id, r));
      await disco.metti(s, t, righe);
    },
    // Butta via ciò che c'era e tiene solo queste righe.
    async sostituisci(s, t, righe) {
      const m = new Map();
      righe.forEach((r) => m.set(r.id, r));
      memoria.set(k(s, t), m);
      await disco.svuotaTabella(s, t);
      await disco.metti(s, t, righe);
    },
    segno(s, t) { return disco.segno(s, t); },
    mettiSegno(s, t, n) { return disco.mettiSegno(s, t, n); },
    // La coda delle operazioni fatte senza rete, in attesa di partire (vedi coda.js).
    codaTutte(s) { return disco.codaTutte(s); },
    codaMetti(s, op) { return disco.codaMetti(s, op); },
    codaTogli(s, n) { return disco.codaTogli(s, n); },
    // Cancella dal dispositivo tutti gli spazi che cominciano così (per esempio all'uscita di un utente).
    async svuota(inizio) {
      Array.from(memoria.keys()).forEach((x) => { if (x.startsWith(inizio)) memoria.delete(x); });
      await disco.svuota(inizio);
    },
  };
}

// Copia che vive solo finché la pagina è aperta: per le prove e per i browser senza disco.
export function copiaInMemoria() {
  const righe = new Map(), segni = new Map(), code = new Map();
  const k = (s, t) => s + "|" + t;
  return conMemoria({
    async leggi(s, t) { return Array.from((righe.get(k(s, t)) || new Map()).values()); },
    async metti(s, t, nuove) {
      if (!righe.has(k(s, t))) righe.set(k(s, t), new Map());
      nuove.forEach((r) => righe.get(k(s, t)).set(r.id, r));
    },
    async svuotaTabella(s, t) { righe.delete(k(s, t)); },
    async segno(s, t) { return segni.get(k(s, t)) || 0; },
    async mettiSegno(s, t, n) { segni.set(k(s, t), n); },
    async codaTutte(s) { return Array.from((code.get(s) || new Map()).values()).sort((a, b) => a.n - b.n).map((o) => JSON.parse(JSON.stringify(o))); },
    async codaMetti(s, op) { if (!code.has(s)) code.set(s, new Map()); code.get(s).set(op.n, JSON.parse(JSON.stringify(op))); },
    async codaTogli(s, n) { if (code.has(s)) code.get(s).delete(n); },
    async svuota(inizio) {
      [righe, segni, code].forEach((m) => Array.from(m.keys()).forEach((x) => { if (x.startsWith(inizio)) m.delete(x); }));
    },
  });
}

function promessa(richiesta) {
  return new Promise((ok, no) => { richiesta.onsuccess = () => ok(richiesta.result); richiesta.onerror = () => no(richiesta.error); });
}
function finita(transazione) {
  return new Promise((ok, no) => {
    transazione.oncomplete = () => ok();
    transazione.onerror = () => no(transazione.error);
    transazione.onabort = () => no(transazione.error);
  });
}

// La copia vera, sul disco del dispositivo (IndexedDB). Se il disco non è disponibile
// (navigazione privata, spazio negato) si ripiega su quella in memoria: l'app funziona lo stesso.
export async function apriCopia(nome) {
  if (typeof indexedDB === "undefined") return copiaInMemoria();
  let db;
  try {
    const apertura = indexedDB.open(nome || "erp-copia", 2);
    apertura.onupgradeneeded = () => {
      const d = apertura.result;
      if (!d.objectStoreNames.contains("righe")) d.createObjectStore("righe", { keyPath: ["s", "t", "id"] });
      if (!d.objectStoreNames.contains("segni")) d.createObjectStore("segni", { keyPath: ["s", "t"] });
      if (!d.objectStoreNames.contains("coda")) d.createObjectStore("coda", { keyPath: ["s", "n"] });
    };
    db = await promessa(apertura);
  } catch (e) {
    return copiaInMemoria();
  }
  const tutte = (s, t) => IDBKeyRange.bound([s, t, ""], [s, t, String.fromCharCode(0xffff)]);
  return conMemoria({
    async leggi(s, t) {
      const trovate = await promessa(db.transaction("righe").objectStore("righe").getAll(tutte(s, t)));
      return trovate.map((x) => x.r);
    },
    async metti(s, t, righe) {
      const tx = db.transaction("righe", "readwrite");
      righe.forEach((r) => tx.objectStore("righe").put({ s: s, t: t, id: r.id, r: r }));
      await finita(tx);
    },
    async svuotaTabella(s, t) {
      const tx = db.transaction(["righe", "segni"], "readwrite");
      tx.objectStore("righe").delete(tutte(s, t));
      tx.objectStore("segni").delete([s, t]);
      await finita(tx);
    },
    async segno(s, t) {
      const x = await promessa(db.transaction("segni").objectStore("segni").get([s, t]));
      return x ? x.n : 0;
    },
    async mettiSegno(s, t, n) {
      const tx = db.transaction("segni", "readwrite");
      tx.objectStore("segni").put({ s: s, t: t, n: n });
      await finita(tx);
    },
    async codaTutte(s) {
      const trovate = await promessa(db.transaction("coda").objectStore("coda").getAll(IDBKeyRange.bound([s, 0], [s, Infinity])));
      return trovate.map((x) => x.op);
    },
    async codaMetti(s, op) {
      const tx = db.transaction("coda", "readwrite");
      tx.objectStore("coda").put({ s: s, n: op.n, op: op });
      await finita(tx);
    },
    async codaTogli(s, n) {
      const tx = db.transaction("coda", "readwrite");
      tx.objectStore("coda").delete([s, n]);
      await finita(tx);
    },
    async svuota(inizio) {
      const FINE = String.fromCharCode(0xffff);
      const intervallo = IDBKeyRange.bound([inizio], [inizio + FINE, FINE, FINE]);
      const tx = db.transaction(["righe", "segni", "coda"], "readwrite");
      tx.objectStore("righe").delete(intervallo);
      tx.objectStore("segni").delete(intervallo);
      tx.objectStore("coda").delete(IDBKeyRange.bound([inizio], [inizio + FINE, Infinity]));
      await finita(tx);
    },
  });
}
