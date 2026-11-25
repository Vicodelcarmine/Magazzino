// Lettore dei vecchi file Excel «.xls» (quelli binari, prima del 2007), quanto basta per le chiusure della cassa.
//
// La cassa di oggi esporta in questo formato. Finora lo trasformava in foglio Google il vecchio gestionale;
// leggendolo qui direttamente, il magazzino non dipende più da lui. Si legge il primo foglio e si restituiscono
// le celle come righe di valori (testi e numeri). Niente formule, niente formati: non servono.
//
// Il file è fatto di due strati: fuori un «contenitore» (lo stesso dei vecchi .doc), dentro la sequenza di
// registrazioni di Excel. Tutti i numeri sono scritti dal byte meno importante al più importante.

const FINE = 0xFFFFFFFE; // da qui in su i numeri di settore sono segnali («fine catena», «libero»)

// Tira fuori dal contenitore il flusso del foglio di lavoro («Workbook», o «Book» nei file più vecchi).
function flussoDelFoglio(bytes) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firma = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  if (bytes.length < 512 || firma.some((b, i) => bytes[i] !== b)) throw new Error("Non è un file .xls.");
  const lato = 1 << d.getUint16(30, true);
  const settore = (n) => 512 + n * lato;
  const perSettore = lato / 4;
  // L'elenco dei settori che contengono la tabella delle catene: i primi 109 stanno nell'intestazione.
  const indice = [];
  for (let i = 0; i < 109; i += 1) indice.push(d.getUint32(76 + i * 4, true));
  for (let n = d.getUint32(68, true), giri = 0; n < FINE && giri < 10000; giri += 1) {
    for (let i = 0; i < perSettore - 1; i += 1) indice.push(d.getUint32(settore(n) + i * 4, true));
    n = d.getUint32(settore(n) + (perSettore - 1) * 4, true);
  }
  const catene = [];
  indice.forEach((n) => { if (n < FINE) for (let i = 0; i < perSettore; i += 1) catene.push(d.getUint32(settore(n) + i * 4, true)); });
  function segui(inizio, tabella, pezzo, lungo) {
    const parti = [];
    const visti = new Set();
    for (let n = inizio; n < FINE && !visti.has(n) && n < tabella.length; n = tabella[n]) { visti.add(n); parti.push(pezzo(n)); }
    const out = new Uint8Array(parti.length * lungo);
    parti.forEach((p, i) => out.set(p, i * lungo));
    return out;
  }
  const grande = (inizio) => segui(inizio, catene, (n) => bytes.subarray(settore(n), settore(n) + lato), lato);
  // L'elenco di ciò che il contenitore contiene.
  const cartella = grande(d.getUint32(48, true));
  const dc = new DataView(cartella.buffer, cartella.byteOffset, cartella.byteLength);
  let radice = null, foglio = null;
  for (let i = 0; i + 128 <= cartella.length; i += 128) {
    const lung = dc.getUint16(i + 64, true);
    let nome = "";
    for (let k = 0; k + 2 < lung && k < 64; k += 2) nome += String.fromCharCode(dc.getUint16(i + k, true));
    const voce = { nome: nome, tipo: cartella[i + 66], inizio: dc.getUint32(i + 116, true), lunghezza: dc.getUint32(i + 120, true) };
    if (voce.tipo === 5) radice = voce;
    if (voce.tipo === 2 && (nome === "Workbook" || nome === "Book") && !foglio) foglio = voce;
  }
  if (!foglio) throw new Error("Nel file non trovo il foglio di lavoro.");
  if (foglio.lunghezza >= d.getUint32(56, true) || !radice) return grande(foglio.inizio).subarray(0, foglio.lunghezza);
  // I flussi piccoli stanno a pezzetti da 64 dentro un flusso a parte.
  const piccoli = grande(radice.inizio);
  const tp = grande(d.getUint32(60, true));
  const dp = new DataView(tp.buffer, tp.byteOffset, tp.byteLength);
  const catenePiccole = [];
  for (let i = 0; i + 4 <= tp.length; i += 4) catenePiccole.push(dp.getUint32(i, true));
  return segui(foglio.inizio, catenePiccole, (n) => piccoli.subarray(n * 64, n * 64 + 64), 64).subarray(0, foglio.lunghezza);
}

// Un numero «compresso» di Excel (RK): intero o con la virgola, eventualmente da dividere per 100.
function numeroRk(v) {
  let n;
  if (v & 2) n = v >> 2; // intero con segno su 30 bit
  else {
    const b = new DataView(new ArrayBuffer(8));
    b.setUint32(0, 0, true);
    b.setUint32(4, v & 0xFFFFFFFC, true);
    n = b.getFloat64(0, true);
  }
  return v & 1 ? n / 100 : n;
}

// bytes: il contenuto del file (Uint8Array). Restituisce le righe del primo foglio: [[cella, cella…], …].
export function leggiXls(bytes) {
  const w = flussoDelFoglio(bytes);
  const d = new DataView(w.buffer, w.byteOffset, w.byteLength);
  const reg = [];
  for (let i = 0; i + 4 <= w.length;) {
    const tipo = d.getUint16(i, true), lung = d.getUint16(i + 2, true);
    reg.push({ tipo: tipo, da: i + 4, a: i + 4 + lung });
    i += 4 + lung;
  }
  const testo = (da, quanti, largo) => {
    let s = "";
    for (let k = 0; k < quanti; k += 1) s += String.fromCharCode(largo ? d.getUint16(da + k * 2, true) : w[da + k]);
    return s;
  };

  // I testi stanno tutti insieme in una tabella, che può proseguire in più registrazioni «continua».
  const testi = [];
  reg.forEach((r, k) => {
    if (r.tipo !== 0x00FC) return;
    const pezzi = [r];
    for (let j = k + 1; j < reg.length && reg[j].tipo === 0x003C; j += 1) pezzi.push(reg[j]);
    let ip = 0, pos = r.da + 8;
    const quanti = d.getUint32(r.da + 4, true);
    const salta = (n) => {
      pos += n;
      while (ip < pezzi.length - 1 && pos >= pezzi[ip].a) { pos = pezzi[ip + 1].da + (pos - pezzi[ip].a); ip += 1; }
    };
    for (let t = 0; t < quanti && pos < pezzi[pezzi.length - 1].a; t += 1) {
      salta(0);
      const caratteri = d.getUint16(pos, true);
      const segni = w[pos + 2];
      pos += 3;
      let formati = 0, extra = 0;
      if (segni & 8) { formati = d.getUint16(pos, true); pos += 2; }
      if (segni & 4) { extra = d.getUint32(pos, true); pos += 4; }
      let largo = segni & 1, s = "", restano = caratteri;
      while (restano > 0) {
        if (pos >= pezzi[ip].a) { // il testo prosegue nel pezzo dopo, che ridice se è a uno o due byte per lettera
          if (ip >= pezzi.length - 1) break;
          ip += 1; pos = pezzi[ip].da; largo = w[pos] & 1; pos += 1;
        }
        const qui = Math.min(restano, Math.floor((pezzi[ip].a - pos) / (largo ? 2 : 1)));
        if (qui <= 0) break;
        s += testo(pos, qui, largo);
        pos += qui * (largo ? 2 : 1);
        restano -= qui;
      }
      salta(formati * 4 + extra);
      testi.push(s);
    }
  });

  const celle = new Map();
  let righe = 0, colonne = 0, fogli = 0;
  const metti = (r, c, v) => { celle.set(r + ":" + c, v); if (r + 1 > righe) righe = r + 1; if (c + 1 > colonne) colonne = c + 1; };
  for (const r of reg) {
    if (r.tipo === 0x0809) { if (r.a - r.da >= 4 && r.a <= w.length && d.getUint16(r.da + 2, true) === 0x0010) fogli += 1; continue; }
    if (fogli !== 1) continue; // solo il primo foglio
    // Solo le registrazioni che descrivono una cella, e solo se stanno tutte dentro il file.
    if ([0x00FD, 0x0203, 0x027E, 0x00BD, 0x0204, 0x0006].indexOf(r.tipo) < 0 || r.a - r.da < 6 || r.a > w.length) continue;
    const riga = d.getUint16(r.da, true), col = d.getUint16(r.da + 2, true);
    if (riga > 20000 || col > 255) continue;
    if (r.tipo === 0x00FD) metti(riga, col, testi[d.getUint32(r.da + 6, true)] || "");
    else if (r.tipo === 0x0203) metti(riga, col, d.getFloat64(r.da + 6, true));
    else if (r.tipo === 0x027E) metti(riga, col, numeroRk(d.getUint32(r.da + 6, true)));
    else if (r.tipo === 0x00BD) {
      const quante = Math.floor((r.a - r.da - 6) / 6);
      for (let k = 0; k < quante; k += 1) metti(riga, col + k, numeroRk(d.getUint32(r.da + 4 + k * 6 + 2, true)));
    } else if (r.tipo === 0x0204) {
      const n = d.getUint16(r.da + 6, true);
      metti(riga, col, testo(r.da + 9, n, w[r.da + 8] & 1));
    } else if (r.tipo === 0x0006 && d.getUint16(r.da + 12, true) !== 0xFFFF) metti(riga, col, d.getFloat64(r.da + 6, true));
  }
  const out = [];
  for (let r = 0; r < righe; r += 1) {
    const riga = [];
    for (let c = 0; c < colonne; c += 1) riga.push(celle.has(r + ":" + c) ? celle.get(r + ":" + c) : "");
    out.push(riga);
  }
  return out;
}
