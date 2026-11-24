// Dalla fattura letta al carico in magazzino.
//
// Il lettore (metro.js, domani quello dell'XML) dà le righe come stanno in fattura. Qui si decide,
// per ogni riga: a quale articolo di magazzino corrisponde, e quanta merce entra nell'unità di
// quell'articolo (kg, L, pz). Quello che si decide una volta viene ricordato per il codice del
// fornitore («abbinamento»), così la volta dopo la riga arriva già pronta.
//
// Qui non si scrive niente nell'archivio: si prepara soltanto. Scrive dati.js.

// Lo stesso codice si trova scritto con e senza zeri davanti (08026924063718 / 8026924063718).
export function chiaveCodice(codice) {
  return String(codice == null ? "" : codice).trim().toUpperCase().replace(/\s+/g, "").replace(/^0+(?=.)/, "");
}

// Gli abbinamenti di UN fornitore, per codice.
export function indice(abbinamenti, fornitoreId) {
  const m = new Map();
  (abbinamenti || []).forEach((a) => { if (a.fornitore_id === fornitoreId) m.set(chiaveCodice(a.codice), a); });
  return m;
}

function trova(riga, perCodice) {
  return perCodice.get(chiaveCodice(riga.codice)) || (riga.gtin ? perCodice.get(chiaveCodice(riga.gtin)) : null) || null;
}

const arrotonda = (n, cifre) => { const p = Math.pow(10, cifre); return Math.round(n * p) / p; };

// Quanta merce entra, nell'unità dell'articolo scelto. fonte dice da dove viene il numero:
//  "fattura"   il peso è scritto in fattura (merce a peso): è certo;
//  "ricordata" l'hai confermato una volta precedente per questo codice;
//  "proposta"  l'ho ricavato dalla descrizione («KG2,5», «G100X8»): va guardato;
//  ""          non lo so: va scritto.
export function proponi(riga, articolo, abbinamento) {
  if (!articolo || !(riga.qtaFattura > 0)) return { quantita: null, fonte: "" };
  if (riga.pesoVariabile && articolo.udm === "kg") return { quantita: arrotonda(riga.qtaFattura, 4), fonte: "fattura" };
  // Merce a peso contata a pezzi (un branzino): ogni volta i pezzi sono diversi, non c'è niente da ricordare.
  if (riga.pesoVariabile) return { quantita: null, fonte: "" };
  if (abbinamento && abbinamento.articolo_id === articolo.id && Number(abbinamento.contenuto) > 0) {
    return { quantita: arrotonda(riga.qtaFattura * Number(abbinamento.contenuto), 4), fonte: "ricordata" };
  }
  if (riga.udmLetta === articolo.udm && riga.qtaLetta > 0) return { quantita: arrotonda(riga.qtaLetta, 4), fonte: "proposta" };
  return { quantita: null, fonte: "" };
}

// lettura: ciò che restituisce il lettore. Restituisce le righe pronte per essere riviste.
//  azione: "carica" (entra in magazzino), "salta" (non entra), "decidi" (manca qualcosa).
export function prepara(lettura, abbinamenti, articoli, fornitoreId) {
  const perCodice = indice(abbinamenti, fornitoreId);
  const perId = new Map((articoli || []).map((a) => [a.id, a]));
  return (lettura.righe || []).map((r, i) => {
    const leggibile = !r.anomala && r.importo != null && r.qtaFattura > 0;
    const riga = {
      n: i + 1, codice: r.codice || "", gtin: r.gtin || "", descrizione: r.descrizione || "",
      leggibile: leggibile, errore: leggibile ? "" : (r.errore || "Riga non letta."),
      qtaFattura: leggibile ? r.qtaFattura : null, udmFattura: r.udmFattura || "",
      importo: leggibile ? (r.importoNetto != null ? r.importoNetto : r.importo) : null,
      lordo: leggibile ? r.importo : null, sconto: leggibile ? (r.scontoFattura || 0) : 0,
      pesoVariabile: !!r.pesoVariabile, udmLetta: r.udm || "", qtaLetta: r.qta,
      articolo_id: null, quantita: null, fonte: "", azione: "decidi", saltaSempre: false,
    };
    if (!leggibile) return riga;
    const abb = trova(r, perCodice);
    if (abb && abb.salta) { riga.azione = "salta"; riga.saltaSempre = true; return riga; }
    const articolo = abb && abb.articolo_id ? perId.get(abb.articolo_id) : null;
    if (articolo && articolo.attivo !== false) {
      riga.articolo_id = articolo.id;
      Object.assign(riga, proponi(riga, articolo, abb));
      riga.azione = decisa(Object.assign({}, riga, { azione: "carica" })) ? "carica" : "decidi";
    }
    return riga;
  });
}

// Una riga è decisa quando si sa cosa farne: saltarla, oppure caricarla con articolo e quantità.
export function decisa(r) {
  if (r.azione === "salta") return true;
  return r.azione === "carica" && r.leggibile && !!r.articolo_id && Number(r.quantita) > 0;
}

export function riepilogo(righe) {
  const out = { carica: 0, salta: 0, daDecidere: 0, valore: 0, saltato: 0 };
  righe.forEach((r) => {
    if (!decisa(r)) out.daDecidere += 1;
    else if (r.azione === "salta") { out.salta += 1; out.saltato += Number(r.importo || 0); }
    else { out.carica += 1; out.valore += Number(r.importo || 0); }
  });
  out.valore = arrotonda(out.valore, 2);
  out.saltato = arrotonda(out.saltato, 2);
  return out;
}

// Il riferimento che lega un movimento alla sua riga di fattura.
export const riferimento = (fatturaId, n) => "fattura:" + fatturaId + "#" + n;
export const eDellaFattura = (movimento, fatturaId) => String(movimento.riferimento || "").startsWith("fattura:" + fatturaId + "#");

// Mette insieme tutto ciò che va scritto per caricare la fattura.
//  c: { fatturaId, ristoranteId, fornitoreId, fornitoreNome, numero, data (AAAA-MM-GG), autoreId, nuovoId }
//  giaFatte: i riferimenti delle righe già entrate (se un carico si era interrotto a metà): non si ripetono.
export function componi(c, righe, abbinamenti, giaFatte) {
  const perCodice = indice(abbinamenti, c.fornitoreId);
  const fatte = giaFatte || new Set();
  const qui = { ristorante_id: c.ristoranteId };
  const quando = new Date(c.data + "T12:00:00").toISOString(); // mezzogiorno del giorno della fattura
  const movimenti = [], prezzi = [], nuovi = [], cambi = [];

  function ricorda(r, voluto) {
    const codice = chiaveCodice(r.codice || r.gtin);
    if (!codice) return;
    const c0 = perCodice.get(codice);
    if (!c0) {
      const nuovo = Object.assign({ id: c.nuovoId(), fornitore_id: c.fornitoreId, codice: codice,
        descrizione: r.descrizione }, qui, voluto);
      nuovi.push(nuovo);
      perCodice.set(codice, nuovo);
      return;
    }
    const uguale = (c0.articolo_id || null) === voluto.articolo_id && !!c0.salta === voluto.salta
      && Math.abs(Number(c0.contenuto || 0) - Number(voluto.contenuto || 0)) < 5e-7;
    if (uguale) return;
    const appenaNato = nuovi.find((x) => x.id === c0.id);
    if (appenaNato) Object.assign(appenaNato, voluto);
    else cambi.push({ id: c0.id, cambi: voluto });
    Object.assign(c0, voluto);
  }

  righe.forEach((r) => {
    if (r.azione === "salta") {
      if (r.saltaSempre) ricorda(r, { articolo_id: null, salta: true, contenuto: null });
      return;
    }
    const quantita = arrotonda(Number(r.quantita), 4);
    const contenuto = r.pesoVariabile ? null : arrotonda(quantita / r.qtaFattura, 6);
    ricorda(r, { articolo_id: r.articolo_id, salta: false, contenuto: contenuto });
    const rif = riferimento(c.fatturaId, r.n);
    if (fatte.has(rif)) return;
    const unitario = arrotonda(Math.max(0, Number(r.importo)) / quantita, 6);
    const mov = Object.assign({
      id: c.nuovoId(), tipo: "carico", articolo_id: r.articolo_id, quantita: quantita, importo_unitario: unitario,
      fornitore_id: c.fornitoreId, qta_confezione: contenuto, acquisto_diretto: false, avvenuto_il: quando,
      origine: "fattura", riferimento: rif, autore_id: c.autoreId,
      nota: (r.descrizione + " — fattura " + (c.fornitoreNome || "") + " " + c.numero).trim(),
    }, qui);
    movimenti.push(mov);
    if (unitario > 0) {
      prezzi.push(Object.assign({ id: c.nuovoId(), articolo_id: r.articolo_id, fornitore_id: c.fornitoreId,
        tipo: "fattura", data: c.data, prezzo_udm: unitario, qta_confezione: contenuto || 0,
        origine: "movimento:" + mov.id }, qui));
    }
  });

  // Quello che resta scritto nella fattura: ogni riga con ciò che se n'è fatto.
  const salvate = righe.map((r) => ({ n: r.n, codice: r.codice, descrizione: r.descrizione, qtaFattura: r.qtaFattura,
    udmFattura: r.udmFattura, importo: r.importo, azione: r.azione, articolo_id: r.azione === "carica" ? r.articolo_id : null,
    quantita: r.azione === "carica" ? arrotonda(Number(r.quantita), 4) : null }));
  return { movimenti: movimenti, prezzi: prezzi, abbinamentiNuovi: nuovi, abbinamentiCambi: cambi, righe: salvate };
}

// La stessa fattura (stesso fornitore, stesso numero, stesso anno) fra quelle conosciute.
export function trovaFattura(fatture, fornitoreId, numero, data) {
  const anno = String(data || "").slice(0, 4);
  const n = String(numero || "").trim();
  return (fatture || []).find((f) => f.fornitore_id === fornitoreId && String(f.numero).trim() === n
    && String(f.data).slice(0, 4) === anno) || null;
}

// Il nome di un fornitore ridotto all'osso, per riconoscere «Biancalani Srl» e «BIANCALANI S.R.L.» come lo stesso.
export function nomeFornitore(nome) {
  return String(nome || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(s\.?\s?r\.?\s?l\.?\s?s?\.?|s\.?\s?p\.?\s?a\.?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?s\.?|societa|unipersonale)(?=\s|$)/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
