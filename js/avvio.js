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
    const ristoranti = await archivio.leggi("ristoranti", {}, "nome.asc");
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
    const mie = await archivio.leggi("appartenenze",
      { ristorante_id: scelto.id, utente_id: archivio.utente().id });
    ctx = {
      // Passa a un altro ristorante e riparte dalla prima pagina.
      cambiaRistorante: (id) => { ricordaPreferito(id); location.hash = CASA; location.reload(); },
      ristorante: scelto,
      piuRistoranti: ristoranti.length > 1,
      titolare: mie.length > 0 && mie[0].ruolo === "titolare",
      dati: creaDati(archivio, scelto.id, await copiaLocale(), spazioDi(scelto.id)),
    };
    await naviga();
  } catch (e) { guasto(e); }
}

// Il menu principale ha quattro voci; «Anagrafica» ne apre altre quattro.
const CASA = "#/magazzino";
const VOCI = [["magazzino", "Magazzino"], ["spesa", "Spesa"], ["costi", "Costi"], ["andamento", "Andamento"], ["piatti", "Anagrafica"]];
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
        onclick: () => { const dove = storia.indietro(qui); if (dove) location.hash = dove; } }, "‹ Indietro")),
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
        h("span", { class: "nota" }, archivio.utente().email),
        h("button", { class: "leggero", onclick: () => { ricordaPreferito(null); ctx = null; storia.azzera(); parti(); } },
          "Cambia ristorante"),
        h("button", { class: "leggero", onclick: async () => {
          // Uscendo, i dati di questo utente spariscono dal dispositivo: chi entra dopo non li trova.
          try { (await copiaLocale()).svuota(nomeArchivio + "|" + archivio.utente().id + "|"); } catch (e) { /* si esce lo stesso */ }
          await archivio.esci(); ctx = null; storia.azzera(); parti();
        } }, "Esci"))),
    h("nav", { class: "principale" }, VOCI.map((v) => {
      const qui = v[0] === sezione || (v[0] === "piatti" && inAnagrafica(sezione));
      return h("a", { href: "#/" + v[0], class: "voce-menu" + (qui ? " qui" : "") }, v[1]);
    })),
    inAnagrafica(sezione) ? h("nav", { class: "secondario" }, ANAGRAFICA.map((v) =>
      h("a", { href: "#/" + v[0], class: "voce-" + v[0] + (v[0] === sezione ? " qui" : "") }, v[1]))) : null,
    h("main", {}, contenuto),
    h("footer", {}, "Versione " + VERSIONE));
}

async function naviga() {
  if (!ctx) return;
  const mio = ++giro;
  const cambiata = mostrata !== (location.hash || CASA);
  storia.visita(location.hash || CASA);
  const [, sezione, id] = (location.hash || CASA).split("/");
  try {
    let vista;
    if (sezione === "magazzino") vista = id ? await conti.articolo(ctx, id, naviga) : await conti.magazzino(ctx);
    else if (sezione === "spesa") vista = await conti.spesa(ctx);
    else if (sezione === "costi") vista = await conti.costi(ctx);
    else if (sezione === "andamento") vista = await andamento.pagina(ctx);
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
      // Una pagina nuova si apre dall'inizio; una pagina solo ridisegnata resta dov'era.
      if (cambiata) window.scrollTo(0, 0);
      mostrata = location.hash || CASA;
    }
  } catch (e) { if (mio === giro) guasto(e); }
}

sovrascriviAlTocco(document);
// Fa funzionare l'app anche aperta senza rete e la rende installabile sul telefono.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* senza, l'app funziona lo stesso con la rete */ });
}
window.addEventListener("hashchange", naviga);
parti();
