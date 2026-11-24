// Cassa: le chiusure arrivate dalla cassa, le vendite che ne sono nate e le voci ancora da sistemare.
import { h, vuoto, conConferma } from "../dom.js";
import { qta, euro } from "../numeri.js";
import * as regole from "../cassa.js";
import { filtra } from "../cerca.js";

const giorno = (iso) => (iso ? new Date(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" }) : "—");

// Registra le chiusure nuove (e, se chiesto, ripassa quelle già registrate: serve dopo aver collegato una voce).
let inCorso = null;
export function guardaCassa(ctx, anche) {
  if (!inCorso) inCorso = giro(ctx, anche).finally(() => { inCorso = null; });
  return inCorso;
}
async function giro(ctx, ancheRegistrate) {
  const esito = { chiusure: 0, vendite: 0, scartate: 0 };
  if (!ctx.titolare) return esito;
  const tutte = await ctx.dati.chiusure();
  for (const c of tutte) {
    if (c.stato === "scartata" || (c.stato === "registrata" && !ancheRegistrate)) continue;
    try {
      const r = await ctx.dati.registraChiusura(c);
      if (r.scartata) esito.scartate += 1;
      else { esito.vendite += r.vendite; if (c.stato === "nuova") esito.chiusure += 1; }
    } catch (e) { if (e.tipo === "rete" || e.tipo === "sessione") break; throw e; }
  }
  return esito;
}

export async function pagina(ctx, ridisegna) {
  if (!ctx.titolare) return vuoto("Solo il titolare vede le chiusure di cassa.");
  let fatto = { chiusure: 0, vendite: 0, scartate: 0 }, guasto = "";
  try { fatto = await guardaCassa(ctx); } catch (e) { guasto = e.message || ""; }
  const [chiusure, collegamenti, piatti] = await Promise.all([ctx.dati.chiusure(), ctx.dati.collegamentiCassa(), ctx.dati.piatti()]);
  const daSistemare = regole.vociDaSistemare(chiusure, collegamenti);
  const buone = chiusure.filter((c) => c.stato !== "scartata");
  const ultima = buone.length ? regole.quandoChiusura(buone[buone.length - 1].nome_file) : null;
  const errore = h("p", { class: "errore", role: "alert" });
  const vivi = piatti.filter((p) => p.stato !== "archiviato");
  // Dopo ogni scelta si recuperano le vendite delle chiusure già arrivate e si ridisegna.
  const prova = async (azione) => {
    errore.textContent = "";
    try { await azione(); await guardaCassa(ctx, true); ridisegna(); } catch (e) { errore.textContent = e.message || "Non riuscito."; }
  };

  function voce(v) {
    const guscio = h("div", { class: "scelta-in-riga" });
    const scegli = h("button", { type: "button", class: "primario", onclick: () => {
      const cerca = h("input", { type: "search", placeholder: "Scrivi il nome del piatto", "aria-label": "Cerca il piatto", autocomplete: "off" });
      const lista = h("ul", { class: "lista risultati" });
      const disegna = () => {
        const trovati = filtra(vivi, cerca.value, "").slice(0, 8);
        lista.replaceChildren(...trovati.map((p) => h("li", {}, h("button", { type: "button", class: "riga tipo-piatto",
          onclick: () => prova(() => ctx.dati.collegaVoceCassa(v.codice, p.id)) }, h("strong", {}, p.nome), h("span", { class: "nota" }, p.categoria || "")))));
        if (!trovati.length) lista.append(h("li", { class: "nota" }, "Nessun piatto così: crealo col tasto qui sotto."));
      };
      cerca.addEventListener("input", disegna);
      cerca.value = (v.descrizione || "").split(/\s+/)[0] || "";
      disegna();
      guscio.replaceChildren(cerca, lista);
      cerca.focus();
    } }, "È un piatto che ho già");
    guscio.append(scegli);
    return h("li", { class: "riga allarme" },
      h("strong", {}, v.descrizione || "Voce " + v.codice), h("span", { class: "numero" }, qta(v.quantita) + " venduti · " + euro(v.importo)),
      h("span", { class: "nota" }, "in " + v.chiusure + (v.chiusure === 1 ? " chiusura" : " chiusure") + ": finché non la sistemi, queste vendite non contano"),
      guscio,
      h("span", { class: "dose" },
        h("button", { type: "button", onclick: () => prova(() => ctx.dati.creaPiattoDaVoce(v, false)) }, "＋ Piatto nuovo (poi faccio la distinta)"),
        conConferma("Non è merce (coperto, acqua alla spina…)", "Sì, solo incasso", () => prova(() => ctx.dati.creaPiattoDaVoce(v, true)), "")));
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
    errore,
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
