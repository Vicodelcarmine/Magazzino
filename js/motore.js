// Il motore dei conti: giacenza, sfrido, spesa, food cost, allerta prezzi.
// Funzioni pure: riceve le righe dell'archivio e restituisce numeri. Niente rete, niente pagina.
// Niente viene salvato: tutto si ricalcola ogni volta dal registro dei movimenti.
//
// Le formule vengono dal vecchio gemello (riferimenti/erp-leggero/js/engine.js), con i
// cinque difetti noti corretti:
//  1. il consumo medio si divide per i giorni REALI coperti dalle vendite, non per il periodo previsto;
//  2. una giacenza negativa non gonfia la spesa (per l'ordine vale zero, e viene segnalata);
//  3. i prezzi scadono: un documento troppo vecchio non vince più il confronto;
//  4. il food cost di categoria conta solo le vendite che hanno un prezzo;
//  5. la giacenza dopo l'ultimo conteggio scala il consumo CON lo sfrido.
// In più: le ricette valgono per data (una dose cambiata oggi non riscrive i consumi di ieri)
// e le preparazioni si scompongono sempre nei loro ingredienti (non hanno giacenza propria).

const EPS = 1e-9;
const GIORNO = 86400000;

function ms(v) {
  if (v == null || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

// Una fila di eventi { t, q } ordinata, con le somme già pronte per chiedere «quanto fra due momenti».
function serie(eventi) {
  const ord = eventi.slice().sort((a, b) => a.t - b.t);
  const tempi = ord.map((e) => e.t);
  const cumulo = [0];
  ord.forEach((e) => cumulo.push(cumulo[cumulo.length - 1] + e.q));
  function fino(t) { // quanti eventi hanno tempo <= t
    let lo = 0, hi = tempi.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tempi[m] <= t) lo = m + 1; else hi = m; }
    return lo;
  }
  return {
    eventi: ord,
    // somma degli eventi con daEscluso < t <= aIncluso (null = senza limite)
    somma(daEscluso, aIncluso) {
      const a = daEscluso == null ? 0 : fino(daEscluso);
      const b = aIncluso == null ? tempi.length : fino(aIncluso);
      return cumulo[Math.max(a, b)] - cumulo[a];
    },
  };
}

// dati: { articoli, piatti, righe, movimenti, prezzi, fornitori, impostazioni, adesso }
export function prepara(dati) {
  const adesso = ms(dati.adesso) == null ? Date.now() : ms(dati.adesso);
  const imp = dati.impostazioni || {};
  const opz = {
    giorniCopertura: Math.max(1, Number(imp.giorni_copertura) || 7),
    giorniStorico: Math.max(1, Number(imp.giorni_storico) || 30),
    validitaPrezzo: Math.max(1, Number(imp.giorni_validita_prezzo) || 180),
    sogliaAllerta: Number.isFinite(Number(imp.soglia_allerta)) ? Number(imp.soglia_allerta) : 0.1,
  };
  const articoli = new Map((dati.articoli || []).map((a) => [a.id, a]));
  const piatti = new Map((dati.piatti || []).map((p) => [p.id, p]));
  const fornitori = new Map((dati.fornitori || []).map((f) => [f.id, f]));

  // ----- ricette per data -----
  const perPadrone = new Map();
  const cambi = new Set();
  (dati.righe || []).forEach((r) => {
    const k = r.piatto_id ? "p:" + r.piatto_id : "a:" + r.preparazione_id;
    const riga = { articolo: r.articolo_id, q: Number(r.quantita) || 0, dal: ms(r.valida_dal), al: ms(r.valida_al) };
    if (!perPadrone.has(k)) perPadrone.set(k, []);
    perPadrone.get(k).push(riga);
    if (riga.dal != null) cambi.add(riga.dal);
    if (riga.al != null) cambi.add(riga.al);
  });
  const momentiCambio = Array.from(cambi).sort((a, b) => a - b);
  function fase(t) { let n = 0; while (n < momentiCambio.length && momentiCambio[n] <= t) n += 1; return n; }

  function esplodi(chiave, t, fattore, out, profondita) {
    (perPadrone.get(chiave) || []).forEach((r) => {
      if (r.dal != null && r.dal > t) return;
      if (r.al != null && r.al <= t) return;
      const a = articoli.get(r.articolo);
      if (a && a.prodotto_in_cucina && profondita < 8) {
        esplodi("a:" + r.articolo, t, fattore * r.q, out, profondita + 1); // preparazione: dentro i suoi ingredienti
      } else {
        out.set(r.articolo, (out.get(r.articolo) || 0) + fattore * r.q);
      }
    });
  }
  const memoRicette = new Map();
  // Quanto di ogni articolo serve per UNA porzione del piatto, nel momento t.
  function ricetta(piattoId, t) {
    const k = piattoId + "|" + fase(t);
    if (!memoRicette.has(k)) {
      const out = new Map();
      esplodi("p:" + piattoId, t, 1, out, 0);
      memoRicette.set(k, out);
    }
    return memoRicette.get(k);
  }

  // ----- movimenti -----
  const annullati = new Set();
  (dati.movimenti || []).forEach((m) => { if (m.tipo === "annullamento" && m.annulla_id) annullati.add(m.annulla_id); });
  const grezzi = new Map(); // articolo → { carichi, conteggi, correzioni, consumi }
  const di = (id) => {
    if (!grezzi.has(id)) grezzi.set(id, { carichi: [], conteggi: [], correzioni: [], consumi: [] });
    return grezzi.get(id);
  };
  const venditePiatto = new Map();
  const acquisti = []; // { t, q: euro, fornitore } di ogni arrivo che ha un prezzo
  let primaVendita = null, ultimaVendita = null;
  (dati.movimenti || []).forEach((m) => {
    if (m.tipo === "annullamento" || annullati.has(m.id)) return;
    const t = ms(m.avvenuto_il);
    const q = Number(m.quantita) || 0;
    if (t == null || t > adesso) return;
    if (m.tipo === "carico") {
      di(m.articolo_id).carichi.push({ t: t, q: q, id: m.id });
      if (Number(m.importo_unitario) > 0) acquisti.push({ t: t, q: q * Number(m.importo_unitario), fornitore: m.fornitore_id || "" });
    }
    else if (m.tipo === "conteggio") di(m.articolo_id).conteggi.push({ t: t, q: q, id: m.id });
    else if (m.tipo === "correzione") di(m.articolo_id).correzioni.push({ t: t, q: q, id: m.id, nota: m.nota || "" });
    else if (m.tipo === "vendita" && q > 0) {
      const prezzo = m.importo_unitario == null || m.importo_unitario === "" ? null : Number(m.importo_unitario);
      if (!venditePiatto.has(m.piatto_id)) venditePiatto.set(m.piatto_id, []);
      venditePiatto.get(m.piatto_id).push({ t: t, q: q, prezzo: prezzo });
      ricetta(m.piatto_id, t).forEach((dose, articolo) => di(articolo).consumi.push({ t: t, q: q * dose }));
      if (primaVendita == null || t < primaVendita) primaVendita = t;
      if (ultimaVendita == null || t > ultimaVendita) ultimaVendita = t;
    }
  });
  const mov = new Map();
  grezzi.forEach((g, id) => mov.set(id, {
    carichi: serie(g.carichi), conteggi: serie(g.conteggi), correzioni: serie(g.correzioni), consumi: serie(g.consumi),
  }));
  const vuota = { carichi: serie([]), conteggi: serie([]), correzioni: serie([]), consumi: serie([]) };

  return {
    adesso: adesso, opz: opz, articoli: articoli, piatti: piatti, fornitori: fornitori,
    prezzi: dati.prezzi || [], ricetta: ricetta, venditePiatto: venditePiatto, acquisti: acquisti,
    primaVendita: primaVendita, ultimaVendita: ultimaVendita,
    mov: (id) => mov.get(id) || vuota,
  };
}

// ----- sfrido: consumo reale / consumo teorico, sommati su tutti i periodi fra due conteggi -----
export function sfrido(c, articoloId) {
  const a = c.articoli.get(articoloId);
  const tempo = !!(a && a.tipo === "tempo");
  const vuoto = { coef: 1, fonte: tempo ? "tempo" : "manca", periodi: [], scartati: 0, reale: 0, teorico: 0, limite: "" };
  if (!a || tempo) return vuoto;
  const m = c.mov(articoloId);
  const conteggi = m.conteggi.eventi;
  const periodi = [];
  let reale = 0, teorico = 0, scartati = 0;
  for (let i = 1; i < conteggi.length; i += 1) {
    const prima = conteggi[i - 1], dopo = conteggi[i];
    const teo = m.consumi.somma(prima.t, dopo.t);
    if (teo <= EPS) continue;
    const entrate = m.carichi.somma(prima.t, dopo.t) + m.correzioni.somma(prima.t, dopo.t);
    const vero = prima.q + entrate - dopo.q;
    if (vero < 0) { scartati += 1; continue; } // conteggio o carico incoerenti: il periodo non conta
    reale += vero;
    teorico += teo;
    periodi.push({ da: prima.t, a: dopo.t, inizio: prima.q, fine: dopo.q, entrate: entrate, reale: vero, teorico: teo });
  }
  if (teorico <= EPS) return Object.assign(vuoto, { periodi: periodi, scartati: scartati, reale: reale, teorico: teorico });
  let coef = reale / teorico, limite = "";
  if (coef < 0.1) { coef = 0.1; limite = "min"; }
  if (coef > 10) { coef = 10; limite = "max"; }
  return { coef: coef, fonte: "inventari", periodi: periodi, scartati: scartati, reale: reale, teorico: teorico, limite: limite };
}

// ----- articoli «a tempo» (detersivi): consumo al giorno fra gli ultimi due conteggi -----
export function consumoTempo(c, articoloId) {
  const a = c.articoli.get(articoloId);
  if (!a || a.tipo !== "tempo") return { giornaliero: 0, fonte: "non_applicabile" };
  const m = c.mov(articoloId);
  const k = m.conteggi.eventi;
  if (k.length >= 2) {
    const prima = k[k.length - 2], dopo = k[k.length - 1];
    const giorni = (dopo.t - prima.t) / GIORNO;
    if (giorni >= 0.5) {
      const tot = prima.q + m.carichi.somma(prima.t, dopo.t) + m.correzioni.somma(prima.t, dopo.t) - dopo.q;
      if (tot > EPS) return { giornaliero: tot / giorni, fonte: "conteggi", giorni: giorni };
    }
  }
  if (Number(a.consumo_stimato) > 0) return { giornaliero: Number(a.consumo_stimato), fonte: "stimato" };
  return { giornaliero: 0, fonte: "nessuno" };
}

// ----- giacenza: ultimo conteggio + entrate successive − consumo successivo (con lo sfrido) -----
export function giacenza(c, articoloId) {
  const a = c.articoli.get(articoloId);
  if (!a) return { valore: 0, contatoIl: null };
  const m = c.mov(articoloId);
  const k = m.conteggi.eventi;
  const ultimo = k.length ? k[k.length - 1] : null;
  const da = ultimo ? ultimo.t : null;
  const base = ultimo ? ultimo.q : 0;
  const entrate = m.carichi.somma(da, c.adesso) + m.correzioni.somma(da, c.adesso);
  if (a.tipo === "tempo") {
    const ritmo = consumoTempo(c, articoloId).giornaliero;
    const inizio = ultimo ? ultimo.t : (m.carichi.eventi.length ? m.carichi.eventi[0].t : null);
    if (inizio == null) return { valore: 0, contatoIl: null };
    return { valore: base + entrate - ritmo * Math.max(0, (c.adesso - inizio) / GIORNO), contatoIl: da };
  }
  const coef = sfrido(c, articoloId).coef;
  return { valore: base + entrate - m.consumi.somma(da, c.adesso) * coef, contatoIl: da };
}

// ----- prezzo: per ogni fornitore vince l'ultimo documento; fra i fornitori il €/unità più basso -----
function scaduto(c, p) {
  const oggi = new Date(c.adesso).toISOString().slice(0, 10);
  if (p.valido_fino) return String(p.valido_fino).slice(0, 10) < oggi;
  const t = ms(p.data);
  return t != null && t < c.adesso - c.opz.validitaPrezzo * GIORNO;
}

function piuRecente(a, b) {
  const da = String(a.data || ""), db = String(b.data || "");
  if (da !== db) return da > db ? a : b;
  const fa = a.tipo === "fattura" ? 1 : 0, fb = b.tipo === "fattura" ? 1 : 0;
  return fb > fa ? b : a;
}

export function prezzo(c, articoloId) {
  const a = c.articoli.get(articoloId);
  const perFornitore = new Map();
  c.prezzi.forEach((p) => {
    if (p.articolo_id !== articoloId || p.annullato_il || !(Number(p.prezzo_udm) > 0) || !p.fornitore_id) return;
    const gia = perFornitore.get(p.fornitore_id);
    perFornitore.set(p.fornitore_id, gia ? piuRecente(p, gia) : p);
  });
  let valido = null, vecchio = null;
  perFornitore.forEach((p) => {
    if (scaduto(c, p)) { if (!vecchio || Number(p.prezzo_udm) < Number(vecchio.prezzo_udm)) vecchio = p; }
    else if (!valido || Number(p.prezzo_udm) < Number(valido.prezzo_udm) - 1e-12) valido = p;
  });
  const scelto = valido || vecchio; // senza prezzi validi resta l'ultimo conosciuto, ma segnalato
  if (!scelto) return null;
  const f = c.fornitori.get(scelto.fornitore_id);
  const conf = Number(scelto.qta_confezione) > 0 ? Number(scelto.qta_confezione) : (a ? Number(a.qta_confezione) || 0 : 0);
  return {
    fornitoreId: scelto.fornitore_id, fornitore: f ? f.nome : "", prezzoUdm: Number(scelto.prezzo_udm),
    qtaConfezione: conf, tipo: scelto.tipo === "preventivo" ? "preventivo" : "fattura",
    data: String(scelto.data || "").slice(0, 10), scaduto: !valido,
  };
}

// ----- tutto ciò che serve sapere di un articolo -----
export function profilo(c, articoloId) {
  const a = c.articoli.get(articoloId);
  if (!a) return null;
  const tempo = a.tipo === "tempo";
  const sfr = sfrido(c, articoloId);
  const g = giacenza(c, articoloId);
  const pr = prezzo(c, articoloId);
  let consumoMedio = 0, fonte = "nessuno", giorniBase = 0;
  let copertura = c.opz.giorniCopertura;
  if (tempo) {
    const ct = consumoTempo(c, articoloId);
    consumoMedio = ct.giornaliero;
    fonte = ct.fonte === "conteggi" ? "tempo" : ct.fonte;
    copertura = Math.max(1, Number(a.giorni_copertura) || c.opz.giorniCopertura);
  } else {
    // La finestra finisce all'ultima vendita arrivata, e si divide per i giorni che i dati coprono davvero.
    const fine = c.ultimaVendita == null ? c.adesso : Math.min(c.adesso, c.ultimaVendita);
    const inizio = fine - c.opz.giorniStorico * GIORNO;
    const teo = c.mov(articoloId).consumi.somma(inizio, fine);
    if (teo > EPS) {
      const coperti = c.primaVendita == null ? c.opz.giorniStorico : (fine - Math.max(inizio, c.primaVendita)) / GIORNO;
      giorniBase = Math.max(1, Math.min(c.opz.giorniStorico, coperti));
      consumoMedio = (teo * sfr.coef) / giorniBase;
      fonte = "storico";
    } else if (Number(a.consumo_stimato) > 0) {
      consumoMedio = Number(a.consumo_stimato);
      fonte = "stimato";
    }
  }
  const fabbisogno = consumoMedio * copertura;
  const disponibile = Math.max(0, g.valore); // una giacenza negativa non può «mancare due volte»
  return {
    id: a.id, nome: a.nome, categoria: a.categoria || "Senza categoria", udm: a.udm, tipo: tempo ? "tempo" : "ricetta",
    attivo: a.attivo !== false, coef: sfr.coef, fonteSfrido: sfr.fonte, limiteSfrido: sfr.limite, periodiScartati: sfr.scartati,
    giacenza: g.valore, giacenzaNegativa: g.valore < -EPS, contatoIl: g.contatoIl,
    consumoMedio: consumoMedio, fonteConsumo: fonte, giorniBase: giorniBase, giorniCopertura: copertura,
    fabbisogno: fabbisogno, daComprare: Math.max(0, fabbisogno - disponibile),
    autonomia: consumoMedio > EPS ? disponibile / consumoMedio : null,
    prezzo: pr, acquistoSfuso: !!a.acquisto_sfuso,
    qtaConfezione: pr && pr.qtaConfezione > 0 ? pr.qtaConfezione : (Number(a.qta_confezione) || 0),
  };
}

export function cruscotto(c) {
  const out = [];
  c.articoli.forEach((a) => { if (!a.prodotto_in_cucina) out.push(profilo(c, a.id)); });
  return out.sort((x, y) => x.nome.localeCompare(y.nome, "it"));
}

// ----- lista della spesa, per fornitore -----
function rigaOrdine(p) {
  if (!p || !p.attivo || p.daComprare <= EPS) return null;
  let colli = null, quantita = p.daComprare, unita = p.udm;
  const avvisi = [];
  if (p.acquistoSfuso) quantita = Math.round(p.daComprare * 1000) / 1000;
  else if (p.qtaConfezione > 0) { colli = Math.max(1, Math.ceil(p.daComprare / p.qtaConfezione - 1e-12)); quantita = colli; unita = "collo"; }
  else avvisi.push("Manca quanto contiene una confezione: l'ordine resta in " + p.udm + ".");
  let costo = null;
  if (p.prezzo && p.prezzo.prezzoUdm > 0) {
    costo = round2(colli != null ? colli * p.prezzo.prezzoUdm * p.qtaConfezione : quantita * p.prezzo.prezzoUdm);
    if (p.prezzo.scaduto) avvisi.push("Prezzo vecchio (" + p.prezzo.data + "): da riconfermare.");
  } else avvisi.push("Nessun prezzo: serve una fattura o un preventivo.");
  if (p.giacenzaNegativa) avvisi.push("Giacenza sotto zero: va ricontato.");
  return Object.assign({}, p, {
    fornitore: p.prezzo ? p.prezzo.fornitore : "", colli: colli, quantita: quantita, unita: unita, costo: costo,
    avviso: avvisi.join(" "),
  });
}

export function spesa(c) {
  const righe = cruscotto(c).map(rigaOrdine).filter(Boolean);
  const gruppi = new Map();
  righe.forEach((r) => {
    const k = r.fornitore || "Senza fornitore";
    if (!gruppi.has(k)) gruppi.set(k, []);
    gruppi.get(k).push(r);
  });
  const elenco = Array.from(gruppi, ([fornitore, rs]) => ({
    fornitore: fornitore, righe: rs,
    totale: round2(rs.reduce((s, r) => s + (r.costo || 0), 0)), parziale: rs.some((r) => r.costo == null),
  })).sort((a, b) => a.fornitore.localeCompare(b.fornitore, "it"));
  return {
    righe: righe, gruppi: elenco, totale: round2(righe.reduce((s, r) => s + (r.costo || 0), 0)),
    parziale: righe.some((r) => r.costo == null),
  };
}

// ----- food cost per piatto e per categoria -----
export function foodCost(c) {
  const memo = new Map();
  const dati = (id) => {
    if (!memo.has(id)) {
      const a = c.articoli.get(id), pr = prezzo(c, id);
      memo.set(id, { a: a, euro: pr ? pr.prezzoUdm : null, fornitore: pr ? pr.fornitore : "",
        coef: a && a.tipo === "tempo" ? 1 : sfrido(c, id).coef });
    }
    return memo.get(id);
  };
  const piatti = [];
  c.piatti.forEach((p) => {
    if (p.stato === "archiviato") return;
    let teorico = 0, reale = 0;
    const righe = [], mancano = [];
    c.ricetta(p.id, c.adesso).forEach((q, articoloId) => {
      const d = dati(articoloId);
      const euro = d.euro || 0;
      teorico += q * euro;
      reale += q * d.coef * euro;
      if (d.euro == null) mancano.push(d.a ? d.a.nome : "?");
      righe.push({ id: articoloId, nome: d.a ? d.a.nome : "?", udm: d.a ? d.a.udm : "", quantita: q, prezzoUdm: d.euro,
        fornitore: d.fornitore, coef: d.coef, costoTeorico: q * euro, costoReale: q * d.coef * euro });
    });
    let venduti = 0, conPrezzo = 0, ricavo = 0;
    (c.venditePiatto.get(p.id) || []).forEach((v) => {
      venduti += v.q;
      if (v.prezzo != null && v.prezzo >= 0) { conPrezzo += v.q; ricavo += v.q * v.prezzo; }
    });
    const listino = Number(p.prezzo_listino) > 0 ? Number(p.prezzo_listino) : null;
    const incasso = conPrezzo > 0 ? ricavo / conPrezzo : null;
    piatti.push({
      id: p.id, nome: p.nome, categoria: p.categoria || "Senza categoria", costoTeorico: teorico, costoReale: reale,
      listino: listino, incasso: incasso, fcListino: listino ? reale / listino : null,
      fcIncasso: incasso > 0 ? reale / incasso : null, margine: incasso > 0 ? incasso - reale : (listino ? listino - reale : null),
      venduti: venduti, vendutiConPrezzo: conPrezzo, ricavo: ricavo, righe: righe, mancanoPrezzi: mancano,
      senzaMerce: p.senza_merce === true || p.senza_merce === 1,
    });
  });
  // Coperto, acqua alla spina e simili: incasso vero, ma nessuna merce. Stanno a parte, per non far sembrare
  // il food cost più basso di quello che è sui piatti veri.
  const senzaMerce = piatti.filter((p) => p.senzaMerce);
  const incassoSenzaMerce = senzaMerce.reduce((s, p) => s + p.ricavo, 0);
  for (let i = piatti.length - 1; i >= 0; i -= 1) if (piatti[i].senzaMerce) piatti.splice(i, 1);
  piatti.sort((a, b) => (b.fcIncasso == null ? -1 : b.fcIncasso) - (a.fcIncasso == null ? -1 : a.fcIncasso));
  const cat = new Map();
  piatti.forEach((p) => {
    if (!cat.has(p.categoria)) cat.set(p.categoria, { categoria: p.categoria, costo: 0, ricavo: 0, piatti: 0 });
    const k = cat.get(p.categoria);
    k.piatti += 1;
    // Solo le vendite con un prezzo: costo e ricavo devono riguardare le stesse porzioni.
    k.costo += p.costoReale * p.vendutiConPrezzo;
    k.ricavo += p.ricavo;
  });
  const categorie = Array.from(cat.values()).map((k) => Object.assign(k, { fc: k.ricavo > 0 ? k.costo / k.ricavo : null }))
    .sort((a, b) => a.categoria.localeCompare(b.categoria, "it"));
  const costo = categorie.reduce((s, k) => s + k.costo, 0), ricavo = categorie.reduce((s, k) => s + k.ricavo, 0);
  return { piatti: piatti, categorie: categorie, senzaMerce: senzaMerce, incassoSenzaMerce: incassoSenzaMerce,
    totale: { costo: costo, ricavo: ricavo, fc: ricavo > 0 ? costo / ricavo : null } };
}

// ----- allerta: un fornitore ha alzato il prezzo fra le ultime due fatture -----
export function allertePrezzi(c) {
  const gruppi = new Map();
  c.prezzi.forEach((p) => {
    if (p.tipo === "preventivo" || p.annullato_il || !(Number(p.prezzo_udm) > 0) || !p.fornitore_id) return;
    const k = p.articolo_id + "|" + p.fornitore_id;
    if (!gruppi.has(k)) gruppi.set(k, []);
    gruppi.get(k).push(p);
  });
  const out = [];
  gruppi.forEach((lista) => {
    if (lista.length < 2) return;
    lista.sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const prima = lista[lista.length - 2], dopo = lista[lista.length - 1];
    if (scaduto(c, dopo)) return; // un aumento di mesi fa non è più una notizia
    const delta = (Number(dopo.prezzo_udm) - Number(prima.prezzo_udm)) / Number(prima.prezzo_udm);
    if (delta + 1e-12 < c.opz.sogliaAllerta) return;
    const a = c.articoli.get(dopo.articolo_id), f = c.fornitori.get(dopo.fornitore_id);
    out.push({ id: dopo.articolo_id, nome: a ? a.nome : "?", udm: a ? a.udm : "", fornitore: f ? f.nome : "",
      prima: Number(prima.prezzo_udm), dopo: Number(dopo.prezzo_udm),
      dataPrima: String(prima.data).slice(0, 10), dataDopo: String(dopo.data).slice(0, 10), delta: delta });
  });
  return out.sort((a, b) => b.delta - a.delta);
}

// ===== Numeri per i grafici =====

// Il lunedì (ora locale) della settimana in cui cade t.
export function lunedi(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

// Settimana per settimana: quanto si è incassato dai piatti, quanto è costata la merce
// di quei piatti (ricetta × sfrido, ai prezzi di oggi) e quanto si è comprato.
export function settimane(c) {
  const costoDi = new Map(foodCost(c).piatti.map((p) => [p.id, p.costoReale]));
  const per = new Map();
  const di = (t) => {
    const k = lunedi(t);
    if (!per.has(k)) per.set(k, { inizio: k, ricavo: 0, costo: 0, acquisti: 0, porzioni: 0 });
    return per.get(k);
  };
  c.venditePiatto.forEach((vendite, piattoId) => {
    const costo = costoDi.get(piattoId) || 0;
    vendite.forEach((v) => {
      if (v.prezzo == null || !(v.prezzo >= 0)) return; // costo e ricavo sulle stesse porzioni
      const s = di(v.t);
      s.ricavo += v.q * v.prezzo;
      s.costo += v.q * costo;
      s.porzioni += v.q;
    });
  });
  c.acquisti.forEach((a) => { di(a.t).acquisti += a.q; });
  return Array.from(per.values()).sort((a, b) => a.inizio - b.inizio)
    .map((s) => Object.assign(s, { fc: s.ricavo > 0 ? s.costo / s.ricavo : null }));
}

// Dove se ne va la merce oltre la ricetta, negli ultimi giorni di storico:
//  - sfrido: consumo teorico × (sfrido − 1), per gli articoli con sfrido misurato sopra 1;
//  - buttato: le correzioni in meno registrate a mano.
// Gli articoli con lo sfrido al limite (0,1 o 10) non entrano nella classifica: quasi
// sempre è un errore di conteggio o di unità, e vanno guardati a parte.
export function sprechi(c) {
  const fine = c.ultimaVendita == null ? c.adesso : Math.min(c.adesso, c.ultimaVendita);
  const inizio = fine - c.opz.giorniStorico * GIORNO;
  const righe = [], daControllare = [];
  c.articoli.forEach((a) => {
    if (a.prodotto_in_cucina || a.tipo === "tempo") return;
    const s = sfrido(c, a.id), m = c.mov(a.id), pr = prezzo(c, a.id);
    const euro = pr ? pr.prezzoUdm : 0;
    let buttato = 0;
    m.correzioni.eventi.forEach((e) => { if (e.q < 0 && e.t > inizio && e.t <= c.adesso) buttato += -e.q; });
    const teo = m.consumi.somma(inizio, fine);
    if (s.limite) { if (teo > EPS) daControllare.push({ id: a.id, nome: a.nome, coef: s.coef }); }
    const oltre = !s.limite && s.fonte === "inventari" && s.coef > 1 ? teo * (s.coef - 1) : 0;
    if (oltre + buttato <= EPS) return;
    righe.push({ id: a.id, nome: a.nome, udm: a.udm, coef: s.coef, oltreRicetta: oltre, buttato: buttato,
      quantita: oltre + buttato, euro: (oltre + buttato) * euro, senzaPrezzo: !pr });
  });
  righe.sort((x, y) => y.euro - x.euro);
  return { righe: righe, totale: round2(righe.reduce((t, r) => t + r.euro, 0)), daControllare: daControllare,
    giorni: c.opz.giorniStorico };
}

// Margine sulla merce per categoria di vendita: incassato meno costo, sulle porzioni con prezzo.
export function marginiCategoria(c) {
  return foodCost(c).categorie.map((k) => ({ categoria: k.categoria, ricavo: k.ricavo, costo: k.costo,
    margine: k.ricavo - k.costo, fc: k.fc })).filter((k) => k.ricavo > 0).sort((a, b) => b.margine - a.margine);
}
