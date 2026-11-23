import { h, campo, modulo, spunta, vuoto } from "../dom.js";

export async function elenco(ctx) {
  const fornitori = await ctx.dati.fornitori();
  return h("section", {},
    h("div", { class: "testata" },
      h("h2", {}, "Fornitori"),
      ctx.titolare ? h("a", { class: "pulsante primario", href: "#/fornitori/nuovo" }, "＋ Nuovo") : null),
    fornitori.length ? h("ul", { class: "lista" }, fornitori.map((f) =>
      h("li", {}, h("a", { class: "riga" + (f.attivo ? "" : " spento"), href: "#/fornitori/" + f.id },
        h("strong", {}, f.nome),
        f.attivo ? null : h("span", { class: "bollo" }, "non attivo"),
        f.note ? h("span", { class: "nota" }, f.note) : null))))
      : vuoto("Nessun fornitore. Aggiungi il primo con «＋ Nuovo»."));
}

export async function scheda(ctx, id) {
  const fornitori = await ctx.dati.fornitori();
  const f = id === "nuovo" ? { attivo: true } : fornitori.find((x) => x.id === id);
  if (!f) return vuoto("Fornitore non trovato.");
  return h("section", {},
    h("h2", {}, f.id ? f.nome : "Nuovo fornitore"),
    modulo([
      campo("Nome", h("input", { name: "nome", value: f.nome || "", required: true, autocomplete: "off" })),
      campo("Note", h("input", { name: "note", value: f.note || "", autocomplete: "off" }),
        "Per esempio: giorno di consegna, telefono dell'agente."),
      spunta("attivo", "Fornitore attivo", f.attivo),
    ], "Salva", async (d) => {
      await ctx.dati.salvaFornitore(Object.assign({ id: f.id }, d), fornitori);
      location.hash = "#/fornitori";
    }));
}
