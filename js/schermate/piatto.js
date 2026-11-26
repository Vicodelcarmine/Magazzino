// La scheda di un piatto con la sua distinta base.
// È la schermata che alla tappa 7 si aprirà da sola quando un piatto nasce dal menu.
import { h, modulo, vuoto, conConferma } from "../dom.js";
import { righeAperte } from "../convalida.js";
import { campiPiatto, STATI } from "./piatti.js";
import { distinta } from "./distinta.js";
import { codice as segnoCodice, categoria as segnoCategoria } from "./segni.js";

export async function scheda(ctx, id, ridisegna) {
  const [piatti, articoli, tutte] = await Promise.all([
    ctx.dati.piatti(), ctx.dati.articoli(), ctx.dati.righeDi({ piatto_id: id }),
  ]);
  let piatto = piatti.find((x) => x.id === id);
  if (!piatto) return vuoto("Piatto non trovato.");
  const righe = righeAperte(tutte);
  piatto = await ctx.dati.allineaStato(piatto, righe);
  const archiviato = piatto.stato === "archiviato";
  const avviso = h("p", { class: "errore", role: "alert" });
  async function cambiaArchivio() {
    avviso.textContent = "";
    try { await ctx.dati.archiviaPiatto(piatto, !archiviato); ridisegna(); } catch (e) { avviso.textContent = e.message; }
  }

  return h("section", { class: "tipo-piatto" },
    h("div", { class: "testata" },
      h("h2", {}, piatto.nome, " ", segnoCodice("piatto", piatto.codice), " ", segnoCategoria("piatto", piatto.categoria)),
      h("span", { class: "bollo " + piatto.stato }, piatto.senza_merce && !archiviato ? "senza merce" : STATI[piatto.stato])),

    piatto.senza_merce ? h("p", { class: "nota" }, "Voce senza merce: le sue vendite contano come incasso, ma non scalano niente dal magazzino. Non ha bisogno di distinta base. Si cambia qui sotto, in «Nome, categoria e prezzo».") : [
    h("h3", {}, "Distinta base", h("span", { class: "nota" }, " — gli articoli di magazzino che servono per una porzione")),
    distinta(ctx, {
      righe: righe, articoli: articoli, chiave: { piatto_id: id }, scala: 1,
      perCosa: "una porzione", modificabile: ctx.titolare && !archiviato, ridisegna: ridisegna,
    })],

    ctx.titolare ? h("details", { class: "tasto-scheda" },
      h("summary", {}, "Nome, categoria e prezzo"),
      modulo(campiPiatto(piatto, piatti), "Salva", async (d) => {
        if (!String(d.categoria || "").trim()) throw new Error("Scegli la categoria del piatto.");
        await ctx.dati.salvaPiatto(Object.assign({ id: piatto.id }, d));
        ridisegna();
      }, archiviato
        ? h("button", { type: "button", class: "leggero", onclick: cambiaArchivio }, "Riattiva il piatto")
        : conConferma("Archivia il piatto", "Sì, archivia " + piatto.nome, cambiaArchivio)), avviso) : null);
}
