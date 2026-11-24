// Avvio dell'app: accesso, scelta del ristorante, navigazione fra le schermate.
import { CONFIG } from "./config.js";
import { VERSIONE } from "./versione.js";
import { creaArchivio } from "./archivio.js";
import { creaDati } from "./dati.js";
import { creaStoria } from "./storia.js";
import { apriCopia } from "./copia.js";
import { h, vuoto, sovrascriviAlTocco } from "./dom.js";
import { schermataAccesso, schermataNuovoRistorante, schermataScegliRistorante } from "./schermate/accesso.js";
import * as articoli from "./schermate/articoli.js";
import * as fornitori from "./schermate/fornitori.js";
import * as piatti from "./schermate/piatti.js";
import * as piatto from "./schermate/piatto.js";
import * as preparazioni from "./schermate/preparazioni.js";
import * as conti from "./schermate/conti.js";
import * as andamento from "./schermate/andamento.js";
import * as trasloco from "./schermate/trasloco.js";
import * as attesa from "./schermate/attesa.js";
import * as fatture from "./schermate/fatture.js";
import * as casa from "./schermate/casa.js";
import * as ordini from "./schermate/ordini.js";
import * as posta from "./schermate/posta.js";
import { preparaSuono, suona, mostraAvviso } from "./avviso.js";

const radice = document.getElementById("app");
// Quale archivio: quello scelto alla schermata di accesso, altrimenti il predefinito.
function archivioScelto() {
  let nome = null;
  try { nome = localStorage.getItem("erp.archivio"); } catch (e) { nome = null; }
  return CONFIG.archivi[nome] ? nome : CONFIG.predefinito;
}
const nomeArchivio = archivioScelto();
// Fino alla 0.12.1 la sessione veniva salvata sotto il nome lungo dell'archivio: la si porta
// sotto quello giusto, così chi è già entrato non deve rifare l'accesso.
try {
  Object.keys(CONFIG.archivi).forEach((k) => {
    const vecchia = "erp.sessione." + CONFIG.archivi[k].nome;
    const giusta = k === "prova" ? "erp.sessione" : "erp.sessione." + k;
    const valore = localStorage.getItem(vecchia);
    if (valore && k === nomeArchivio) localStorage.setItem(giusta, valore);
    if (valore) localStorage.removeItem(vecchia);
  });
} catch (e) { /* al peggio si rifà l'accesso */ }
const archivio = creaArchivio({ nome: nomeArchivio, deposito: localStorage,
  url: CONFIG.archivi[nomeArchivio].url, chiave: CONFIG.archivi[nomeArchivio].chiave });
function cambiaArchivio(nome) {
  try { localStorage.setItem("erp.archivio", nome); } catch (e) { /* resta quello di adesso */ }
  location.hash = "";
  location.reload();
}
let ctx = null; // { ristorante, titolare, dati }
const storia = creaStoria();
let mostrata = "";  // l'ultima pagina messa a schermo
let giro = 0;   // per ignorare una schermata arrivata tardi dopo un cambio di pagina

// Il ristorante preferito è ricordato PER UTENTE: cambiare account non mescola niente.
function chiavePreferito() { return "erp.ristorante." + archivio.utente().id; }
function preferito() { try { return localStorage.getItem(chiavePreferito()); } catch (e) { return null; } }
function ricordaPreferito(id) {
  try {
    if (id) localStorage.setItem(chiavePreferito(), id);
    else localStorage.removeItem(chiavePreferito());
  } catch (e) { /* si richiederà la prossima volta */ }
}

function mostra(nodo) { radice.replaceChildren(nodo); }
function chiaveInizio() { return "erp.inizio." + nomeArchivio + "." + archivio.utente().id; }

// La copia dei dati sul dispositivo: una sola per tutta l'app, divisa in spazi per archivio, utente e ristorante.
let copiaAperta = null;
function copiaLocale() { if (!copiaAperta) copiaAperta = apriCopia(); return copiaAperta; }
function spazioDi(ristoranteId) { return nomeArchivio + "|" + archivio.utente().id + "|" + ristoranteId; }

function guasto(e) {
  if (e && e.tipo === "sessione") { ctx = null; return parti(); }
  mostra(h("main", { class: "centro" },
    h("p", { class: "errore", role: "alert" }, (e && e.message) || "Qualcosa non ha funzionato."),
    h("button", { onclick: parti }, "Riprova")));
}

async function parti() {
  try {
    if (!archivio.utente()) {
      // La scelta dell'archivio compare solo se ce n'è più d'uno, cioè sul Mac di sviluppo.
      const piu = Object.keys(CONFIG.archivi).length > 1;
      return mostra(schermataAccesso(archivio, parti, piu ? { archivi: CONFIG.archivi, scelto: nomeArchivio, cambia: cambiaArchivio } : null));
    }
    // Ristoranti e ruolo si ricordano dall'ultima volta: senza rete l'app deve aprirsi lo stesso.
    let ricordo = null;
    try { ricordo = JSON.parse(localStorage.getItem(chiaveInizio()) || "null"); } catch (e) { ricordo = null; }
    let ristoranti, ruoli = (ricordo && ricordo.ruoli) || {}, senzaRete = false;
    try {
      ristoranti = await archivio.leggi("ristoranti", {}, "nome.asc");
    } catch (e) {
      if (e.tipo !== "rete" || !ricordo) throw e;
      ristoranti = ricordo.ristoranti;
      senzaRete = true;
    }
    const nuovo = (annulla) => mostra(schermataNuovoRistorante(archivio, (r) => {
      ricordaPreferito(r.id);
      location.hash = CASA;
      parti();
    }, annulla));
    if (!ristoranti.length) return nuovo(null);
    const scelto = ristoranti.find((r) => r.id === preferito())
      || (ristoranti.length === 1 ? ristoranti[0] : null);
    if (!scelto) {
      return mostra(schermataScegliRistorante(ristoranti,
        (r) => { ricordaPreferito(r.id); parti(); }, () => nuovo(parti)));
    }
    ricordaPreferito(scelto.id);
    if (!senzaRete) {
      try {
        const mie = await archivio.leggi("appartenenze", { ristorante_id: scelto.id, utente_id: archivio.utente().id });
        ruoli = Object.assign({}, ruoli, { [scelto.id]: mie.length ? mie[0].ruolo : "" });
        localStorage.setItem(chiaveInizio(), JSON.stringify({ ristoranti: ristoranti, ruoli: ruoli }));
      } catch (e) { if (e.tipo !== "rete") throw e; }
    }
    ctx = {
      // Passa a un altro ristorante e riparte dalla prima pagina.
      cambiaRistorante: (id) => { ricordaPreferito(id); location.hash = CASA; location.reload(); },
      ristorante: scelto,
      piuRistoranti: ristoranti.length > 1,
      titolare: ruoli[scelto.id] === "titolare",
      dati: creaDati(archivio, scelto.id, await copiaLocale(), spazioDi(scelto.id)),
    };
    await naviga();
    controllaPosta(); // subito all'apertura, poi ogni tre minuti
  } catch (e) { guasto(e); }
}

// Il menu principale; «Anagrafica» apre altre quattro voci.
const CASA = "#/casa";
const VOCI = [["magazzino", "Magazzino"], ["fatture", "Fatture"], ["spesa", "Spesa"], ["costi", "Costi"], ["andamento", "Andamento"], ["piatti", "Anagrafica"]];
const ANAGRAFICA = [["piatti", "Piatti"], ["preparazioni", "Preparazioni"], ["articoli", "Articoli"], ["fornitori", "Fornitori"]];
const inAnagrafica = (sezione) => ANAGRAFICA.some((v) => v[0] === sezione);

function cornice(sezione, contenuto) {
  const qui = location.hash || CASA;
  const dietro = storia.precedente(qui);
  return h("div", { class: "cornice" + (sezione === "andamento" ? " larga" : ""), "data-sezione": sezione },
    // Sempre nello stesso punto e sempre a vista, anche scorrendo una pagina lunga.
    // Spento solo se non c'è dove tornare.
    h("div", { class: "barra-indietro" },
      h("button", { class: "indietro", disabled: dietro == null, "aria-label": "Torna alla pagina precedente",
        onclick: () => { const dove = storia.indietro(qui); if (dove) location.hash = dove; } }, "‹ Indietro"),
      // La casina: da qualunque pagina, dritti alla Home.
      h("a", { class: "pulsante casina" + (sezione === "casa" ? " qui" : ""), href: CASA, "aria-label": "Vai alla Home", title: "Home" }, "🏠")),
    h("header", {},
      h("div", { class: "locale" },
        h("strong", {}, ctx.ristorante.nome),
        ctx.ristorante.demo ? h("span", { class: "bollo" }, "esempio") : null,
        ctx.titolare ? null : h("span", { class: "bollo" }, "dipendente")),
      h("div", { class: "conto" },
        h("span", { class: "bollo" + (nomeArchivio === "prova" ? "" : " attivo") }, nomeArchivio === "prova" ? "archivio di prova" : "archivio online"),
        ctx.dati.stato().fuoriLinea ? h("span", { class: "bollo da_completare" }, "senza rete" + (ctx.dati.stato().quando
          ? ": dati delle " + new Date(ctx.dati.stato().quando).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
          : ": dati dell'ultima volta")) : null,
        ctx.dati.stato().inAttesa ? h("a", { class: "bollo da_completare", href: "#/attesa" },
          ctx.dati.stato().inAttesa + (ctx.dati.stato().inAttesa === 1 ? " operazione in attesa" : " operazioni in attesa") + " di rete") : null,
        ctx.dati.stato().rifiutate ? h("a", { class: "bollo rifiutato", href: "#/attesa" },
          ctx.dati.stato().rifiutate + (ctx.dati.stato().rifiutate === 1 ? " operazione rifiutata" : " operazioni rifiutate")) : null,
        h("span", { class: "nota" }, archivio.utente().email),
        h("button", { class: "leggero", onclick: () => { ricordaPreferito(null); ctx = null; storia.azzera(); parti(); } },
          "Cambia ristorante"),
        tastoEsci())),
    // Nella Home il menu in basso non serve (i riquadri portano già ovunque); nelle altre pagine resta, per muoversi senza tornare alla Home.
    sezione === "casa" ? null : h("nav", { class: "principale" }, VOCI.map((v) => {
      const qui = v[0] === sezione || (v[0] === "piatti" && inAnagrafica(sezione)) || (v[0] === "spesa" && (sezione === "ordini" || sezione === "ordine-nuovo")) || (v[0] === "fatture" && sezione === "posta");
      return h("a", { href: "#/" + v[0], class: "voce-menu" + (qui ? " qui" : "") }, v[1]);
    })),
    inAnagrafica(sezione) ? h("nav", { class: "secondario" }, ANAGRAFICA.map((v) =>
      h("a", { href: "#/" + v[0], class: "voce-" + v[0] + (v[0] === sezione ? " qui" : "") }, v[1]))) : null,
    h("main", {}, contenuto),
    h("footer", {}, "Versione " + VERSIONE));
}

// Uscendo, i dati di questo utente spariscono dal dispositivo: chi entra dopo non li trova.
// Ma se ci sono operazioni non ancora spedite, uscire le farebbe perdere: prima lo si dice.
function tastoEsci() {
  async function esci() {
    try { (await copiaLocale()).svuota(nomeArchivio + "|" + archivio.utente().id + "|"); } catch (e) { /* si esce lo stesso */ }
    try { localStorage.removeItem(chiaveInizio()); } catch (e) { /* niente da togliere */ }
    await archivio.esci(); ctx = null; storia.azzera(); parti();
  }
  const guscio = h("span", { class: "conferma" });
  const normale = h("button", { class: "leggero", onclick: async () => {
    let inAttesa = 0;
    try { inAttesa = (await ctx.dati.coda()).attesa.length; } catch (e) { inAttesa = 0; }
    if (!inAttesa) return esci();
    guscio.replaceChildren(
      h("span", { class: "errore" }, "Hai " + inAttesa + " operazioni non ancora spedite: se esci adesso vanno perse."),
      h("button", { onclick: () => guscio.replaceChildren(normale) }, "Resto"),
      h("button", { class: "pericolo", onclick: esci }, "Esco lo stesso"));
  } }, "Esci");
  guscio.append(normale);
  return guscio;
}

async function naviga() {
  if (!ctx) return;
  const mio = ++giro;
  const cambiata = mostrata !== (location.hash || CASA);
  storia.visita(location.hash || CASA);
  const [, sezione, id] = (location.hash || CASA).split("/");
  try {
    let vista;
    if (sezione === "casa") vista = await casa.pagina(ctx);
    else if (sezione === "magazzino") vista = id ? await conti.articolo(ctx, id, naviga) : await conti.magazzino(ctx);
    else if (sezione === "spesa") vista = id === "unica" ? await conti.spesaUnica(ctx, naviga) : await conti.spesa(ctx);
    else if (sezione === "costi") vista = await conti.costi(ctx);
    else if (sezione === "andamento") vista = await andamento.pagina(ctx);
    else if (sezione === "fatture" && id === "rivedi") vista = await fatture.rivedi(ctx);
    else if (sezione === "fatture") vista = id ? await fatture.scheda(ctx, id, naviga) : await fatture.elenco(ctx);
    else if (sezione === "ordine-nuovo") vista = await ordini.nuovo(ctx, id);
    else if (sezione === "ordini") vista = id ? await ordini.scheda(ctx, id, naviga) : await ordini.elenco(ctx);
    else if (sezione === "posta") vista = await posta.pagina(ctx, nomeArchivio, naviga);
    else if (sezione === "attesa") vista = await attesa.pagina(ctx, naviga);
    else if (sezione === "trasloco") vista = await trasloco.pagina(ctx, archivio, nomeArchivio);
    else if (sezione === "articoli") vista = id ? await articoli.scheda(ctx, id) : await articoli.elenco(ctx);
    else if (sezione === "preparazioni") vista = id ? await preparazioni.scheda(ctx, id, naviga) : await preparazioni.elenco(ctx);
    else if (sezione === "fornitori") vista = id ? await fornitori.scheda(ctx, id) : await fornitori.elenco(ctx);
    else if (sezione === "piatti" && id === "nuovo") vista = await piatti.nuovo(ctx);
    else if (sezione === "piatti" && id) vista = await piatto.scheda(ctx, id, naviga);
    else if (sezione === "piatti") vista = await piatti.elenco(ctx);
    else vista = vuoto("Pagina non trovata.");
    if (mio === giro) {
      mostra(cornice(sezione, vista));
      if (sezione === "fatture" || sezione === "posta") nuoveFatture = 0; // viste: il tasto smette di lampeggiare
      segnaFatture();
      // Una pagina nuova si apre dall'inizio; una pagina solo ridisegnata resta dov'era.
      if (cambiata) window.scrollTo(0, 0);
      mostrata = location.hash || CASA;
    }
  } catch (e) { if (mio === giro) guasto(e); }
}

// ----- fatture arrivate per posta: controllo ogni pochi minuti, suono, avviso, tasto che lampeggia -----
let nuoveFatture = 0;  // arrivate da quando non si guarda la pagina Fatture
let daCaricare = 0;    // in tutto, arrivate e non ancora caricate
function segnaFatture() {
  document.querySelectorAll('nav.principale a[href="#/fatture"], a.pagina-fatture').forEach((el) => {
    el.classList.toggle("lampeggia", nuoveFatture > 0);
    let segno = el.querySelector(".contatore");
    if (!daCaricare) { if (segno) segno.remove(); return; }
    if (!segno) { segno = h("span", { class: "contatore" }); el.append(segno); }
    segno.textContent = String(daCaricare);
  });
}
let controlloInCorso = false;
async function controllaPosta() {
  if (!ctx || !ctx.titolare || controlloInCorso || document.hidden) return;
  controlloInCorso = true;
  try {
    const esito = await fatture.guardaPosta(ctx);
    daCaricare = (await ctx.dati.fatture()).filter((f) => f.stato === "da_caricare").length;
    if (esito.fatture > 0) {
      nuoveFatture += esito.fatture;
      suona();
      mostraAvviso(esito.fatture === 1 ? "È arrivata una fattura per posta" : "Sono arrivate " + esito.fatture + " fatture per posta",
        "Apri Fatture", () => { location.hash = "#/fatture"; });
    }
    segnaFatture();
  } catch (e) { /* senza rete o altro: si riprova al prossimo giro */ } finally { controlloInCorso = false; }
}
setInterval(controllaPosta, 3 * 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) controllaPosta(); });
preparaSuono(document);

sovrascriviAlTocco(document);
// Fa funzionare l'app anche aperta senza rete e la rende installabile sul telefono.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* senza, l'app funziona lo stesso con la rete */ });
}
window.addEventListener("hashchange", naviga);
// Quando il telefono ritrova la rete, le operazioni in attesa partono subito e la pagina si aggiorna.
window.addEventListener("online", async () => {
  if (!ctx) return;
  try { await ctx.dati.spedisciOra(); } catch (e) { /* si riproverà alla prossima pagina */ }
  naviga();
});
parti();
