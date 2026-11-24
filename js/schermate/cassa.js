// Cassa: le chiusure arrivate dalla cassa, le vendite che ne sono nate e le voci ancora da sistemare.
import { h, vuoto, conConferma } from "../dom.js";
import { qta, euro } from "../numeri.js";
import * as regole from "../cassa.js";
import { filtra } from "../cerca.js";

const giorno = (iso) => (iso ? new Date(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" }) : "—");

// Le chiusure arrivate si tengono in memoria per qualche minuto: sono pesanti da riscaricare a ogni tocco.
let memoria = null; // { chi, quando, chiusure }
async function leggiChiusure(ctx, fresche) {
  const chi = ctx.ristorante.id;
  if (!fresche && memoria && memoria.chi === chi && Date.now() - memoria.quando < 120000) return memoria.chiusure;
  const chiusure = await ctx.dati.chiusure();
  memoria = { chi: chi, quando: Date.now(), chiusure: chiusure };
  return chiusure;
}

// Registra le chiusure nuove. Un solo giro per volta.
let inCorso = null;
// fresche: riscarica l'elenco dall'archivio (lo fa il controllo periodico); senza, usa quello in memoria se è recente.
export function guardaCassa(ctx, fresche) {
  if (!inCorso) inCorso = giro(ctx, fresche).finally(() => { inCorso = null; });
  return inCorso;
}
export const chiusureNote = (ctx) => leggiChiusure(ctx, false);
async function giro(ctx, fresche) {
  if (!ctx.titolare) return { chiusure: 0, vendite: 0, scartate: 0 };
  const nuove = (await leggiChiusure(ctx, fresche)).filter((c) => c.stato === "nuova");
  const r = await ctx.dati.registraChiusure(nuove);
  return { chiusure: r.nuove, vendite: r.vendite, scartate: r.scartate };
}
// Le chiusure (già scaricate) in cui compare una voce: solo quelle si ripassano quando la voce viene sistemata.
function chiusureCon(chiusure, codice) {
  return chiusure.filter((c) => {
    if (c.stato === "scartata") return false;
    try { return regole.leggiChiusura(JSON.parse(c.valori || "[]")).some((v) => v.codice === codice); } catch (e) { return false; }
  });
}

let fattoOra = ""; // l'esito dell'ultima voce sistemata, da mostrare una volta
export async function pagina(ctx, ridisegna) {
  if (!ctx.titolare) return vuoto("Solo il titolare vede le chiusure di cassa.");
  const messaggio = fattoOra;
  fattoOra = "";
  let fatto = { chiusure: 0, vendite: 0, scartate: 0 }, guasto = "";
  try { fatto = await guardaCassa(ctx); } catch (e) { guasto = e.message || ""; }
  const [chiusure, collegamenti, piatti] = await Promise.all([leggiChiusure(ctx), ctx.dati.collegamentiCassa(), ctx.dati.piatti()]);
  const daSistemare = regole.vociDaSistemare(chiusure, collegamenti);
  const buone = chiusure.filter((c) => c.stato !== "scartata");
  const ultima = buone.length ? regole.quandoChiusura(buone[buone.length - 1].nome_file) : null;
  const errore = h("p", { class: "errore", role: "alert" });
  const vivi = piatti.filter((p) => p.stato !== "archiviato");
  const lavoro = h("p", { class: "nota avviso", role: "status" });
  let occupato = false;
  // Alla scelta la voce sparisce SUBITO dallo schermo; intanto si collega e si recuperano le sue vendite nelle
  // chiusure dove compare (una lettura sola, un invio solo). Se qualcosa va storto la voce ricompare, con l'errore.
  const sistema = async (v, riga, azione) => {
    if (occupato) return;
    occupato = true;
    errore.textContent = "";
    riga.hidden = true;
    lavoro.textContent = "Sistemo «" + (v.descrizione || v.codice) + "» e recupero le sue vendite…";
    try {
      await azione();
      const r = await ctx.dati.registraChiusure(chiusureCon(chiusure, v.codice));
      lavoro.textContent = "";
      fattoOra = "«" + (v.descrizione || v.codice) + "» sistemata: recuperate " + r.vendite + (r.vendite === 1 ? " vendita." : " vendite.");
      ridisegna();
    } catch (e) {
      riga.hidden = false;
      lavoro.textContent = "";
      errore.textContent = e.message || "Non riuscito.";
    } finally { occupato = false; }
  };

  function voce(v) {
    const guscio = h("div", { class: "scelta-in-riga" });
    const scegli = h("button", { type: "button", class: "primario", onclick: () => {
      const cerca = h("input", { type: "search", placeholder: "Scrivi il nome del piatto", "aria-label": "Cerca il piatto", autocomplete: "off" });
      const lista = h("ul", { class: "lista risultati" });
      const disegna = () => {
        const trovati = filtra(vivi, cerca.value, "").slice(0, 8);
        lista.replaceChildren(...trovati.map((p) => h("li", {}, h("button", { type: "button", class: "riga tipo-piatto",
          onclick: () => sistema(v, riga, () => ctx.dati.collegaVoceCassa(v.codice, p.id)) }, h("strong", {}, p.nome), h("span", { class: "nota" }, p.categoria || "")))));
        if (!trovati.length) lista.append(h("li", { class: "nota" }, "Nessun piatto così: crealo col tasto qui sotto."));
      };
      cerca.addEventListener("input", disegna);
      cerca.value = (v.descrizione || "").split(/\s+/)[0] || "";
      disegna();
      guscio.replaceChildren(cerca, lista);
      cerca.focus();
    } }, "È un piatto che ho già");
    guscio.append(scegli);
    const riga = h("li", { class: "riga allarme" },
      h("strong", {}, v.descrizione || "Voce " + v.codice), h("span", { class: "numero" }, qta(v.quantita) + " venduti · " + euro(v.importo)),
      h("span", { class: "nota" }, "in " + v.chiusure + (v.chiusure === 1 ? " chiusura" : " chiusure") + ": finché non la sistemi, queste vendite non contano"),
      guscio,
      h("span", { class: "dose" },
        h("button", { type: "button", onclick: () => sistema(v, riga, () => ctx.dati.creaPiattoDaVoce(v, false)) }, "＋ Piatto nuovo (poi faccio la distinta)"),
        conConferma("Non è merce (coperto, acqua alla spina…)", "Sì, solo incasso", () => sistema(v, riga, () => ctx.dati.creaPiattoDaVoce(v, true)), "")));
    return riga;
  }

  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "Cassa")),
    h("p", { class: "nota" }, "Ogni notte la cassa mette su Drive l'elenco di ciò che ha venduto; il raccoglitore lo consegna qui e le vendite scalano il magazzino secondo le ricette. ",
      h("a", { href: "#/posta" }, "Collegamento del raccoglitore")),
    h("ul", { class: "voci" },
      h("li", { class: "voce" }, h("span", {}, "Ultima chiusura arrivata"), h("strong", {}, ultima ? giorno(ultima) : "nessuna")),
      h("li", { class: "voce" }, h("span", {}, "Chiusure arrivate"), h("strong", {}, String(buone.length))),
      h("li", { class: "voce" }, h("span", {}, "Voci di cassa senza piatto"), h("strong", { class: daSistemare.length ? "rosso" : "" }, String(daSistemare.length)))),
    fatto.chiusure ? h("p", { class: "nota avviso" }, "Registrate adesso " + fatto.chiusure + (fatto.chiusure === 1 ? " chiusura nuova" : " chiusure nuove") + " (" + fatto.vendite + " voci vendute).") : null,
    guasto ? h("p", { class: "nota avviso" }, "Le chiusure non si sono potute guardare (" + guasto + ").") : null,
    messaggio ? h("p", { class: "nota" }, "✓ " + messaggio) : null,
    lavoro, errore,
    h("h3", {}, "Voci da sistemare (" + daSistemare.length + ")"),
    daSistemare.length ? h("ul", { class: "lista" }, daSistemare.map(voce))
      : h("p", { class: "nota" }, buone.length ? "✓ Ogni voce venduta ha il suo piatto." : "Ancora nessuna chiusura arrivata."),
    h("h3", {}, "Chiusure arrivate"),
    chiusure.length ? h("details", { class: "tendina" }, h("summary", {}, h("strong", {}, "Elenco"), h("span", { class: "nota" }, String(chiusure.length))),
      h("ul", { class: "lista" }, chiusure.slice().reverse().slice(0, 40).map((c) => h("li", { class: "riga" + (c.stato === "scartata" ? " spento" : "") },
        h("strong", {}, c.stato === "scartata" ? c.nome_file : giorno(regole.quandoChiusura(c.nome_file))),
        h("span", { class: "bollo " + (c.stato === "registrata" ? "attivo" : c.stato === "nuova" ? "da_completare" : "") }, c.stato),
        h("span", { class: "nota" }, c.stato === "scartata" ? c.nota : c.nome_file))))) : vuoto("Ancora niente."));
}
