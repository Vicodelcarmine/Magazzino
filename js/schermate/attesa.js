// Le operazioni fatte senza rete: quelle che aspettano di partire e quelle che l'archivio ha rifiutato.
import { h, conConferma } from "../dom.js";
import { descrivi } from "../coda.js";

const quando = (iso) => new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export async function pagina(ctx, ridisegna) {
  const coda = await ctx.dati.coda();
  const avviso = h("p", { class: "errore", role: "alert" });
  async function prova(azione) {
    avviso.textContent = "";
    try { await azione(); ridisegna(); } catch (e) { avviso.textContent = e.message; }
  }
  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "In attesa di rete")),
    h("p", { class: "nota" }, "Quello che registri senza segnale resta su questo dispositivo e parte da solo appena torna la rete, nello stesso ordine in cui l'hai fatto."),
    avviso,

    h("h3", {}, "Da spedire (" + coda.attesa.length + ")"),
    coda.attesa.length ? h("ul", { class: "voci" }, coda.attesa.map((op) =>
      h("li", { class: "voce" }, h("span", {}, descrivi(op)), h("strong", {}, quando(op.quando)))))
      : h("p", { class: "nota" }, "Niente in attesa: tutto quello che hai registrato è nell'archivio."),
    coda.attesa.length ? h("button", { type: "button", class: "primario", onclick: () => prova(async () => {
      const s = await ctx.dati.spedisciOra();
      if (s.inAttesa) throw new Error("La rete non c'è ancora: restano " + s.inAttesa + " operazioni in attesa.");
    }) }, "Prova a spedire adesso") : null,

    coda.rifiutate.length ? h("div", {},
      h("h3", {}, "Rifiutate dall'archivio (" + coda.rifiutate.length + ")"),
      h("p", { class: "nota avviso" }, "Queste operazioni sono arrivate all'archivio, che non le ha accettate. Non sono state registrate. "
        + "Puoi riprovarle oppure scartarle."),
      h("ul", { class: "lista" }, coda.rifiutate.map((op) =>
        h("li", { class: "riga allarme" },
          h("strong", {}, descrivi(op)), h("span", { class: "nota" }, quando(op.quando) + " — " + (op.motivo || "")),
          h("span", { class: "dose" },
            h("button", { type: "button", onclick: () => prova(() => ctx.dati.riprovaRifiutata(op.n)) }, "Riprova"),
            conConferma("Scarta", "Sì, scarta", () => prova(() => ctx.dati.scartaRifiutata(op.n)))))))) : null);
}
