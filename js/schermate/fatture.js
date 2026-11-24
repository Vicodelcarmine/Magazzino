// Fatture dei fornitori: caricare un PDF, rivedere le righe, farle entrare in magazzino.
// Per ora si legge il PDF di Metro; il resto (rivedere, abbinare, caricare, annullare) è uguale
// per qualunque fornitore e qualunque strada da cui arriverà la fattura.
import { h, vuoto, conConferma } from "../dom.js";
import { qta, euro, perCampo, parseNumero } from "../numeri.js";
import * as metro from "../fatture/metro.js";
import { leggiTesto } from "../fatture/pdf.js";
import * as xml from "../fatture/xml.js";
import * as carico from "../fatture/carico.js";
import { daBase64, mittenteBreve } from "../posta.js";
import { inRitardo } from "../ordini.js";
import * as regoleOrdini from "../ordini.js";
import { sceltaArticolo } from "./scegli.js";
import { tipoDi, etichettaArticolo } from "./segni.js";

const giorno = (d) => { const p = String(d || "").slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : "—"; };
const STATI = { caricata: ["caricata", "attivo"], da_caricare: ["da caricare", "da_completare"], annullata: ["annullata", "rifiutato"] };
const bolloStato = (f) => h("span", { class: "bollo " + STATI[f.stato][1] }, STATI[f.stato][0]);

// La fattura che si sta rivedendo. Resta finché non la si carica o non se ne apre un'altra:
// così si può uscire un attimo (per creare un articolo che manca) e tornare senza rifare tutto.
let bozza = null;

async function fornitoreMetro(ctx) {
  const tutti = await ctx.dati.fornitori();
  const c = tutti.find((f) => String(f.nome).trim().toLowerCase().startsWith("metro"));
  return c || ctx.dati.salvaFornitore({ nome: "Metro" }, tutti);
}

// Il fornitore scritto nella fattura XML, fra quelli che ci sono: stesso nome (senza «S.r.l.» e simili),
// oppure stessa prima parola quando un solo fornitore comincia così. Se non c'è, nasce adesso.
async function fornitoreDaNome(ctx, nome) {
  const tutti = await ctx.dati.fornitori();
  const pulito = (s) => carico.nomeFornitore(s);
  const voluto = pulito(nome);
  if (!voluto) throw new Error("Nella fattura non trovo il nome del fornitore.");
  const uguale = tutti.find((f) => pulito(f.nome) === voluto);
  if (uguale) return uguale;
  const prima = voluto.split(" ")[0];
  const simili = tutti.filter((f) => pulito(f.nome).split(" ")[0] === prima);
  if (prima.length >= 4 && simili.length === 1) return simili[0];
  return ctx.dati.salvaFornitore({ nome: nome.trim() }, tutti);
}

// Legge un file (PDF Metro o XML) e dice di che fornitore è. nome serve solo a riconoscere i .p7m.
async function leggiFile(ctx, bytes, nome) {
  if (/\.p7m$/i.test(nome || "")) {
    throw new Error("Questo è un file firmato (.p7m): per ora non lo so aprire. Dal cassetto fiscale scarica la versione «file fattura» in XML.");
  }
  const ePdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // «%PDF»
  let lettura, fornitore, origine;
  if (ePdf) {
    let testo;
    try { testo = await leggiTesto(bytes.slice().buffer); }
    catch (e) { throw new Error("Non riesco ad aprire questo PDF: è rovinato o non è un vero PDF."); }
    if (!metro.eMetro(testo)) {
      throw new Error("Questo PDF non mi sembra una fattura Metro. In PDF leggo solo quelle; per gli altri fornitori serve il file XML.");
    }
    lettura = metro.leggi(testo);
    if (lettura.ok) fornitore = await fornitoreMetro(ctx);
    origine = "pdf";
  } else {
    const testo = new TextDecoder("utf-8").decode(bytes);
    if (!xml.eFatturaXml(testo)) throw new Error("Non riconosco questo file: non è una fattura Metro in PDF né una fattura elettronica in XML.");
    lettura = xml.leggi(testo);
    if (lettura.ok) fornitore = await fornitoreDaNome(ctx, lettura.fornitore);
    origine = "xml";
  }
  if (!lettura.ok) throw new Error(lettura.errore || "Non sono riuscito a leggere le righe di questa fattura.");
  return { lettura: lettura, fornitore: fornitore, origine: origine, impronta: metro.impronta(bytes) };
}

async function preparaBozza(ctx, letto, nomeFile, origine) {
  const [abbinamenti, articoli, fatture] = await Promise.all([ctx.dati.abbinamenti(), ctx.dati.articoli(), ctx.dati.fatture()]);
  bozza = {
    file: nomeFile, lettura: letto.lettura,
    testata: { fornitore_id: letto.fornitore.id, fornitoreNome: letto.fornitore.nome, numero: letto.lettura.numero, data: letto.lettura.data,
      imponibile: letto.lettura.imponibile, impronta: letto.impronta, origine: origine || letto.origine },
    righe: carico.prepara(letto.lettura, abbinamenti, articoli, letto.fornitore.id),
    gia: carico.trovaFattura(fatture, letto.fornitore.id, letto.lettura.numero, letto.lettura.data),
  };
}

async function apri(ctx, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await preparaBozza(ctx, await leggiFile(ctx, bytes, file.name), file.name);
}

// Guarda gli allegati nuovi arrivati per posta: quelli che sono fatture entrano in elenco come «da caricare»,
// gli altri vengono scartati col motivo. Pochi per volta, per non far aspettare chi apre la pagina.
const PER_VOLTA = 8;
export async function guardaPosta(ctx) {
  const esito = { fatture: 0, scartate: 0, restano: 0 };
  if (!ctx.titolare) return esito;
  const nuove = (await ctx.dati.posta()).filter((p) => p.stato === "nuova").reverse(); // dalla più vecchia
  esito.restano = Math.max(0, nuove.length - PER_VOLTA);
  for (const p of nuove.slice(0, PER_VOLTA)) {
    try {
      const letto = await leggiFile(ctx, daBase64(await ctx.dati.filePosta(p.id)), p.nome_file);
      const f = await ctx.dati.registraArrivata({ fornitore_id: letto.fornitore.id, numero: letto.lettura.numero, data: letto.lettura.data,
        imponibile: letto.lettura.imponibile, impronta: letto.impronta });
      await ctx.dati.segnaPosta(p.id, { stato: "fattura", fattura_id: f.id, nota: "" });
      esito.fatture += 1;
    } catch (e) {
      if (e.tipo === "rete" || e.tipo === "sessione") break; // non è colpa del file: si riprova la prossima volta
      await ctx.dati.segnaPosta(p.id, { stato: "scartata", nota: String(e.message || "Non letto").slice(0, 300) });
      // Non è una fattura: il documento non deve restare nel magazzino (può essere una busta paga, un atto…).
      try { await ctx.dati.svuotaFilePosta(p.id); } catch (x) { /* resta la riga scartata; si riprova dalla pagina della posta */ }
      esito.scartate += 1;
    }
  }
  return esito;
}

// ---------- elenco ----------
export async function elenco(ctx) {
  // Prima di mostrare l'elenco si guarda se è arrivato qualcosa per posta.
  let posta = { fatture: 0, scartate: 0, restano: 0 }, erroreposta = "";
  try { posta = await guardaPosta(ctx); } catch (e) { erroreposta = e.message || ""; }
  const [fatture, fornitori, ordini] = await Promise.all([ctx.dati.fatture(), ctx.dati.fornitori(), ctx.dati.ordini()]);
  const nomi = new Map(fornitori.map((f) => [f.id, f.nome]));
  const inRitardoOra = ordini.filter((o) => inRitardo(o, Date.now()));
  const stato = h("p", { class: "nota", role: "status" });
  const errore = h("p", { class: "errore", role: "alert" });
  const scegliFile = h("input", { type: "file", accept: "application/pdf,.pdf,.xml,text/xml,application/xml", hidden: true, onchange: async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    errore.textContent = "";
    stato.textContent = "Leggo «" + file.name + "»…";
    try {
      await apri(ctx, file);
      location.hash = "#/fatture/rivedi";
    } catch (e) {
      stato.textContent = "";
      errore.textContent = e.message || "Non sono riuscito a leggere il file.";
    }
  } });
  const daCaricare = fatture.filter((f) => f.stato === "da_caricare");
  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "Fatture"),
      ctx.titolare ? h("button", { type: "button", class: "primario", onclick: () => scegliFile.click() }, "＋ Carica una fattura") : null),
    ctx.titolare ? h("p", { class: "nota" }, h("a", { href: "#/posta" }, "Fatture dalla posta"),
      posta.fatture ? " · " + posta.fatture + (posta.fatture === 1 ? " nuova fattura arrivata per posta" : " nuove fatture arrivate per posta") : "",
      posta.scartate ? " · " + posta.scartate + (posta.scartate === 1 ? " allegato scartato" : " allegati scartati") : "",
      posta.restano ? " · altri " + posta.restano + " da guardare: riapri questa pagina" : "",
      erroreposta ? " · la posta non si è potuta guardare (" + erroreposta + ")" : "") : null,
    scegliFile, stato, errore,
    ctx.titolare ? h("p", { class: "nota" }, "Metro: il PDF della fattura. Tutti gli altri fornitori: il file XML della fattura elettronica.") : null,
    bozza ? h("p", { class: "nota avviso" }, "Stavi rivedendo la fattura " + bozza.testata.numero + ": ",
      h("a", { href: "#/fatture/rivedi" }, "riprendila da dove eri")) : null,
    inRitardoOra.length ? h("p", { class: "errore" }, "Fatture attese e non arrivate: ",
      inRitardoOra.map((o, i) => [i ? ", " : "", h("a", { href: "#/ordini/" + o.id }, nomi.get(o.fornitore_id) || "fornitore")]),
      ". Avevi fatto l'ordine e il termine è passato.") : null,
    daCaricare.length ? h("p", { class: "nota avviso" }, daCaricare.length === 1 ? "C'è una fattura arrivata e non ancora caricata."
      : "Ci sono " + daCaricare.length + " fatture arrivate e non ancora caricate.") : null,
    fatture.length ? perAnni(fatture, nomi) : vuoto("Ancora nessuna fattura. Carica la prima col tasto qui sopra."));
}

// Le fatture raccolte in tendine: un anno, e dentro i suoi mesi. Di ogni tendina si vede subito quante
// fatture contiene e quanto valgono. All'inizio è aperto solo il mese più recente; le tendine con una
// fattura ancora da caricare restano aperte, perché non devono sfuggire. Quelle che apri o chiudi tu
// restano così finché non chiudi l'app.
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const scelte = new Map(); // "2026" o "2026-11" → aperta (vero/falso), come l'ha lasciata chi usa l'app

function tendina(chiave, apertaDiSuo, classe, titolo, fatture, contenuto) {
  const totale = fatture.reduce((s, f) => s + (f.stato === "annullata" ? 0 : Number(f.imponibile || 0)), 0);
  const attesa = fatture.filter((f) => f.stato === "da_caricare").length;
  const d = h("details", { class: "tendina " + classe, open: scelte.has(chiave) ? scelte.get(chiave) : apertaDiSuo || attesa > 0 },
    h("summary", {}, h("strong", {}, titolo),
      attesa ? h("span", { class: "bollo da_completare" }, attesa + " da caricare") : null,
      h("span", { class: "nota" }, fatture.length + (fatture.length === 1 ? " fattura" : " fatture")),
      h("span", { class: "numero" }, euro(totale))),
    contenuto);
  d.addEventListener("toggle", () => scelte.set(chiave, d.open));
  return d;
}

function perAnni(fatture, nomi) {
  const anni = new Map();
  fatture.forEach((f) => {
    const anno = String(f.data).slice(0, 4), mese = String(f.data).slice(0, 7);
    if (!anni.has(anno)) anni.set(anno, new Map());
    if (!anni.get(anno).has(mese)) anni.get(anno).set(mese, []);
    anni.get(anno).get(mese).push(f);
  });
  const riga = (f) => h("li", {}, h("a", { class: "riga" + (f.stato === "da_caricare" ? " allarme" : ""), href: "#/fatture/" + f.id },
    h("strong", {}, (nomi.get(f.fornitore_id) || "Fornitore") + " " + f.numero),
    bolloStato(f),
    h("span", { class: "numero" }, f.imponibile == null ? "" : euro(f.imponibile)),
    h("span", { class: "nota" }, "del " + giorno(f.data) + (f.origine === "importazione" ? " · caricata nel vecchio gestionale" : "")
      + (f.origine === "posta" && f.stato === "da_caricare" ? " · arrivata per posta: aprila per caricarla" : ""))));
  // Le fatture arrivano già dalla più recente: anni e mesi restano in quell'ordine.
  return h("div", { class: "tendine" }, Array.from(anni.entries()).map(([anno, mesi], ia) =>
    tendina(anno, ia === 0, "anno", anno, Array.from(mesi.values()).flat(),
      Array.from(mesi.entries()).map(([mese, lista], im) =>
        tendina(mese, ia === 0 && im === 0, "mese", MESI[Number(mese.slice(5, 7)) - 1] || mese, lista,
          h("ul", { class: "lista" }, lista.map(riga)))))));
}

// Il riquadro del confronto fra ordine e fattura: usato qui e nella pagina dell'ordine.
export function blocchiConfronto(c, titolo, nota) {
  const voce = (x, testo, classe) => h("li", { class: "voce" }, h("span", {}, x.nome), h("strong", { class: classe || "" }, testo));
  const q = (n, udm) => qta(n) + " " + udm;
  return h("div", { class: "scheda-confronto" + (c.tuttoTorna ? "" : " allarme") }, h("h3", {}, titolo),
    c.tuttoTorna ? h("p", { class: "nota" }, "✓ Tutto come ordinato (" + c.uguali.length + (c.uguali.length === 1 ? " articolo" : " articoli") + ").") : null,
    c.mancanti.length ? [h("p", { class: "errore" }, "Ordinato e non in fattura"), h("ul", { class: "voci" }, c.mancanti.map((x) => voce(x, "ordinati " + q(x.ordinata, x.udm), "rosso")))] : null,
    c.diverse.length ? [h("p", { class: "nota avviso" }, "Quantità diversa da quella ordinata"), h("ul", { class: "voci" }, c.diverse.map((x) =>
      voce(x, "ordinati " + q(x.ordinata, x.udm) + ", in fattura " + q(x.arrivata, x.udm))))] : null,
    c.inPiu.length ? [h("p", { class: "nota avviso" }, "In fattura ma non ordinato"), h("ul", { class: "voci" }, c.inPiu.map((x) => voce(x, q(x.arrivata, x.udm))))] : null,
    !c.tuttoTorna && c.uguali.length ? h("p", { class: "nota" }, "Il resto (" + c.uguali.length + (c.uguali.length === 1 ? " articolo" : " articoli") + ") è come ordinato.") : null,
    nota ? h("p", { class: "nota" }, nota) : null);
}

// ---------- revisione della fattura appena letta ----------
export async function rivedi(ctx) {
  if (!bozza) return vuoto("Non c'è nessuna fattura in revisione: torna a Fatture e caricane una.");
  const b = bozza;
  const articoli = (await ctx.dati.articoli()).filter((a) => a.attivo !== false && !a.prodotto_in_cucina);
  // L'ordine che aspettava questa fattura (se c'è) e i prezzi pagati finora: per il confronto qui sotto.
  const ordine = regoleOrdini.ordinePerFattura(await ctx.dati.ordini(), b.testata.fornitore_id, b.testata.data);
  const prezzi = (await ctx.dati.perIConti(ctx.ristorante)).prezzi;
  const riquadroConfronto = h("div", { class: "confronto" });
  const perId = new Map(articoli.map((a) => [a.id, a]));
  const abbinamenti = carico.indice(await ctx.dati.abbinamenti(), b.testata.fornitore_id);
  const giaCaricata = b.gia && b.gia.stato === "caricata";
  const errore = h("p", { class: "errore", role: "alert" });
  const conto = h("p", { class: "nota", role: "status" });
  const conferma = h("button", { type: "button", class: "primario" }, "Carica in magazzino");

  function aggiornaConto() {
    const r = carico.riepilogo(b.righe);
    conto.textContent = [
      r.carica + (r.carica === 1 ? " riga entra" : " righe entrano") + " in magazzino (" + euro(r.valore) + ")",
      r.salta ? r.salta + (r.salta === 1 ? " saltata" : " saltate") + " (" + euro(r.saltato) + ")" : null,
      r.daDecidere ? r.daDecidere + " ancora da decidere" : null,
    ].filter(Boolean).join(" · ");
    conto.className = "nota" + (r.daDecidere ? " avviso" : "");
    conferma.disabled = giaCaricata || r.daDecidere > 0 || !ctx.titolare;
    disegnaConfronto();
  }

  // Si aggiorna a ogni scelta: dice subito cosa non torna con l'ordine e quali prezzi sono saliti.
  function disegnaConfronto() {
    const entrano = b.righe.filter((r) => r.azione === "carica" && r.articolo_id && Number(r.quantita) > 0);
    const pezzi = [];
    const su = regoleOrdini.aumenti(entrano, prezzi, b.testata.fornitore_id, ctx.ristorante.soglia_allerta, perId);
    if (su.length) pezzi.push(h("div", { class: "scheda-confronto allarme" }, h("h3", {}, "Prezzi saliti rispetto all'ultima fattura"),
      h("ul", { class: "voci" }, su.map((x) => h("li", { class: "voce" }, h("span", {}, x.nome),
        h("strong", { class: "rosso" }, euro(x.prima) + " → " + euro(x.ora) + " al " + x.udm + " (+" + Math.round(x.delta * 100) + "%)"))))));
    if (ordine) {
      const c = regoleOrdini.confronta(regoleOrdini.righeDi(ordine), entrano, perId);
      const quando = new Date(ordine.inviato_il).toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "2-digit" });
      pezzi.push(blocchiConfronto(c, "Confronto con l'ordine di " + quando, giaCaricata ? "" : "Si aggiorna mentre scegli gli articoli qui sopra."));
    }
    riquadroConfronto.replaceChildren(...pezzi);
  }

  function disegnaRiga(r, li) {
    const quanti = r.leggibile ? qta(r.qtaFattura) + " " + (r.udmFattura || "") + " · " + euro(r.importo)
      + (r.sconto ? " (tolto lo sconto di fine fattura: " + euro(r.sconto) + ")" : "") : "";
    const ridisegna = () => { disegnaRiga(r, li); aggiornaConto(); };
    const testa = [h("strong", {}, r.descrizione || "Riga " + r.n), h("span", { class: "numero" }, quanti)];
    if (!r.leggibile) {
      li.className = "riga allarme";
      li.replaceChildren(...testa, h("span", { class: "nota avviso" }, "Non sono riuscito a leggere questa riga (" + r.errore
        + "). Guarda la fattura: se è merce di magazzino, caricala a mano dalla pagina dell'articolo."),
        r.azione === "salta" ? h("span", { class: "nota" }, "Presa visione: la fattura si carica senza questa riga.")
          : h("button", { type: "button", onclick: () => { r.azione = "salta"; ridisegna(); } }, "Ho capito, vai avanti senza"));
      return;
    }
    if (r.azione === "salta") {
      li.className = "riga spento";
      li.replaceChildren(...testa,
        h("span", { class: "nota" }, r.saltaSempre ? "Non è merce di magazzino: non viene caricata, né ora né le prossime volte." : "Questa volta non viene caricata."),
        h("button", { type: "button", class: "leggero", onclick: () => { r.azione = "decidi"; r.saltaSempre = false;
          if (r.articolo_id && Number(r.quantita) > 0) r.azione = "carica"; ridisegna(); } }, "Caricala invece"));
      return;
    }
    const articolo = r.articolo_id ? perId.get(r.articolo_id) : null;
    const pronta = carico.decisa(r);
    li.className = "riga tipo-articolo" + (pronta ? "" : " allarme");
    const salti = h("span", { class: "dose" },
      h("button", { type: "button", class: "leggero", onclick: () => { r.azione = "salta"; r.saltaSempre = false; ridisegna(); } }, "Salta questa volta"),
      h("button", { type: "button", class: "leggero", onclick: () => { r.azione = "salta"; r.saltaSempre = true; ridisegna(); } }, "Non è merce di magazzino"));
    if (!articolo) {
      const guscio = h("div", { class: "scelta-in-riga" });
      const apriScelta = h("button", { type: "button", class: "primario", onclick: () => {
        guscio.replaceChildren(sceltaArticolo(articoli, (a) => {
          if (!a) return;
          r.articolo_id = a.id;
          Object.assign(r, carico.proponi(r, a, abbinamenti.get(carico.chiaveCodice(r.codice))));
          r.azione = "carica";
          ridisegna();
        }));
        const cerca = guscio.querySelector("input[type=search]");
        if (cerca) cerca.focus();
      } }, "Scegli l'articolo di magazzino");
      guscio.append(apriScelta);
      li.replaceChildren(...testa, h("span", { class: "nota avviso" }, "Codice mai visto: dimmi a quale articolo corrisponde. Lo ricorderò."), guscio, salti);
      return;
    }
    const prezzo = h("span", { class: "nota" });
    const aggiornaPrezzo = () => {
      const n = Number(r.quantita);
      prezzo.textContent = n > 0 ? "= " + euro(r.importo / n) + " al " + articolo.udm : "";
    };
    const campo = h("input", { class: "stretto", inputmode: "decimal", autocomplete: "off", value: perCampo(r.quantita, 4),
      "aria-label": "Quanta merce entra, in " + articolo.udm, oninput: (ev) => {
        const n = parseNumero(ev.target.value);
        r.quantita = n != null && n > 0 ? n : null;
        r.fonte = "scritta";
        r.azione = "carica";
        li.classList.toggle("allarme", !carico.decisa(r));
        aggiornaPrezzo(); aggiornaConto();
      } });
    const spiega = { fattura: "peso scritto in fattura", ricordata: "come l'ultima volta", scritta: "",
      proposta: "letto dalla descrizione: controlla che sia giusto, poi lo ricordo", "": r.pesoVariabile ? "la fattura dà il peso, l'articolo si conta a " + articolo.udm + ": scrivi quanti ne sono arrivati"
        : "scrivi quanta merce entra: poi lo ricordo" }[r.fonte];
    aggiornaPrezzo();
    li.replaceChildren(...testa,
      h("span", { class: "scelto" }, h("span", { class: "riga-distinta tipo-" + tipoDi(articolo) }, etichettaArticolo(articolo)),
        h("button", { type: "button", class: "leggero", onclick: () => { r.articolo_id = null; r.quantita = null; r.fonte = ""; r.azione = "decidi"; ridisegna(); } }, "Cambia")),
      h("span", { class: "dose" }, "entrano", campo, h("strong", {}, articolo.udm), prezzo),
      spiega ? h("span", { class: "nota" + (r.fonte === "proposta" || r.fonte === "" ? " avviso" : "") }, spiega) : null,
      salti);
  }

  const lista = h("ul", { class: "lista" }, b.righe.map((r) => { const li = h("li", {}); disegnaRiga(r, li); return li; }));
  conferma.addEventListener("click", async () => {
    errore.textContent = "";
    conferma.disabled = true;
    try {
      const esito = await ctx.dati.caricaFattura(b.testata, b.righe);
      bozza = null;
      location.hash = "#/fatture/" + esito.id;
    } catch (e) {
      errore.textContent = e.message || "Il carico non è riuscito.";
      aggiornaConto();
    }
  });
  aggiornaConto();

  const l = b.lettura;
  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "Fattura " + b.testata.fornitoreNome + " " + (b.testata.numero || "senza numero"))),
    h("ul", { class: "voci" },
      h("li", { class: "voce" }, h("span", {}, "Data"), h("strong", {}, giorno(b.testata.data))),
      h("li", { class: "voce" }, h("span", {}, "Imponibile scritto in fattura"), h("strong", {}, euro(l.imponibile))),
      h("li", { class: "voce" }, h("span", {}, "Somma delle righe lette" + (l.totaleSconti ? " (tolti " + euro(l.totaleSconti) + " di sconti)" : "")),
        h("strong", { class: l.quadra || l.imponibile == null ? "" : "rosso" }, euro(l.nettoRighe) + (l.quadra ? " ✓ torna" : l.imponibile == null ? "" : " ✗ non torna")))),
    l.quadra || l.imponibile == null ? null : h("p", { class: "nota avviso" }, "La somma delle righe non torna con l'imponibile: può mancare una riga. Controlla la fattura prima di caricare."),
    (l.avvisi || []).filter((a) => !/non torna con l'imponibile/.test(a)).map((a) => h("p", { class: "nota avviso" }, a)),
    giaCaricata ? h("p", { class: "errore" }, "Questa fattura risulta già caricata"
      + (b.gia.origine === "importazione" ? " nel vecchio gestionale" : "") + ": non la carico due volte. ",
      h("a", { href: "#/fatture/" + b.gia.id }, "Aprila")) : null,
    ctx.titolare ? null : h("p", { class: "nota avviso" }, "Solo il titolare può caricare le fatture."),
    h("h3", {}, "Righe (" + b.righe.length + ")"),
    lista, riquadroConfronto, conto, errore,
    h("div", { class: "azioni" }, conferma,
      conConferma("Lascia perdere", "Sì, chiudi senza caricare", () => { bozza = null; location.hash = "#/fatture"; })));
}

// ---------- una fattura già conosciuta ----------
export async function scheda(ctx, id, ridisegna) {
  const [fatture, fornitori, articoli] = await Promise.all([ctx.dati.fatture(), ctx.dati.fornitori(), ctx.dati.articoli()]);
  const f = fatture.find((x) => x.id === id);
  if (!f) return vuoto("Fattura non trovata.");
  const fornitore = fornitori.find((x) => x.id === f.fornitore_id);
  const perId = new Map(articoli.map((a) => [a.id, a]));
  let righe = [];
  try { righe = JSON.parse(f.righe || "[]"); } catch (e) { righe = []; }
  const vivi = await ctx.dati.carichiDiFattura(f.id);
  const errore = h("p", { class: "errore", role: "alert" });
  // Se la fattura è arrivata per posta, il suo file è nella cassetta: la si rivede e carica da qui, senza cercarlo.
  const arrivo = f.stato !== "caricata" && ctx.titolare ? (await ctx.dati.posta()).find((p) => p.fattura_id === f.id) : null;
  const rivediDallaPosta = arrivo ? h("button", { type: "button", class: "primario", onclick: async (ev) => {
    errore.textContent = "";
    ev.target.disabled = true;
    try {
      const letto = await leggiFile(ctx, daBase64(await ctx.dati.filePosta(arrivo.id)), arrivo.nome_file);
      await preparaBozza(ctx, letto, arrivo.nome_file, "posta");
      location.hash = "#/fatture/rivedi";
    } catch (e) { errore.textContent = e.message || "Non riesco ad aprire il file arrivato per posta."; ev.target.disabled = false; }
  } }, "Rivedi e carica") : null;
  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "Fattura " + (fornitore ? fornitore.nome : "") + " " + f.numero), bolloStato(f)),
    h("ul", { class: "voci" },
      h("li", { class: "voce" }, h("span", {}, "Data"), h("strong", {}, giorno(f.data))),
      h("li", { class: "voce" }, h("span", {}, "Imponibile"), h("strong", {}, euro(f.imponibile))),
      h("li", { class: "voce" }, h("span", {}, "Righe entrate in magazzino"), h("strong", {}, f.origine === "importazione" ? "nel vecchio gestionale" : String(vivi.length)))),
    f.origine === "importazione" ? h("p", { class: "nota" }, "Questa fattura è stata caricata nel vecchio gestionale: i suoi arrivi sono già nei movimenti di ogni articolo. È qui perché non venga caricata una seconda volta.") : null,
    f.stato === "da_caricare" ? h("p", { class: "nota avviso" }, arrivo
      ? "Arrivata per posta" + (arrivo.mittente ? " da " + mittenteBreve(arrivo.mittente) : "") + " e non ancora entrata in magazzino."
      : "Questa fattura non è ancora entrata in magazzino. Per caricarla, torna a Fatture e carica il suo file.") : null,
    rivediDallaPosta ? h("div", { class: "azioni" }, rivediDallaPosta) : null,
    f.stato === "annullata" ? h("p", { class: "nota avviso" }, "Il carico di questa fattura è stato annullato: la merce non conta in magazzino. Per rifarlo, carica di nuovo il file.") : null,
    righe.length ? h("ul", { class: "lista" }, righe.map((r) => {
      const a = r.articolo_id ? perId.get(r.articolo_id) : null;
      return h("li", { class: "riga" + (r.azione === "carica" ? " tipo-articolo" : " spento") },
        h("strong", {}, r.descrizione), h("span", { class: "numero" }, r.importo == null ? "" : euro(r.importo)),
        h("span", { class: "nota" }, r.azione === "carica"
          ? "→ " + (a ? a.nome : "articolo") + ": " + qta(r.quantita) + " " + (a ? a.udm : "")
          : "non caricata"));
    })) : null,
    errore,
    ctx.titolare && f.stato === "caricata" && f.origine !== "importazione" ? h("div", { class: "azioni" },
      conConferma("Annulla il carico di questa fattura", "Sì, annulla tutto il carico", async () => {
        try { await ctx.dati.annullaFattura(f); ridisegna(); } catch (e) { errore.textContent = e.message; }
      })) : null);
}
