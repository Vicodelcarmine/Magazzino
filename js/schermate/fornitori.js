import { h, campo, modulo, spunta, vuoto } from "../dom.js";

export async function elenco(ctx) {
  const fornitori = await ctx.dati.fornitori();
  let daControllare = 0;
  if (ctx.titolare) { try { daControllare = (await ctx.dati.preventivi()).filter((p) => p.stato === "inviato").length; } catch (e) { daControllare = 0; } }
  return h("section", {},
    h("div", { class: "testata" },
      h("h2", {}, "Fornitori"),
      ctx.titolare ? h("a", { class: "pulsante primario", href: "#/fornitori/nuovo" }, "＋ Nuovo") : null),
    ctx.titolare ? h("p", {}, h("a", { class: "pulsante" + (daControllare ? " lampeggia" : ""), href: "#/preventivi" },
      "🤝 Preventivi", daControllare ? h("span", { class: "contatore" }, String(daControllare)) : null),
      h("span", { class: "nota" }, "  chiedi i prezzi a un fornitore con un link, e controlla quelli arrivati")) : null,
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
    h("div", { class: "testata" }, h("h2", {}, f.id ? f.nome : "Nuovo fornitore"),
      f.id && ctx.titolare ? h("a", { class: "pulsante", href: "#/preventivi", onclick: () => { try { sessionStorage.setItem("erp.preventivo.per", f.nome); } catch (e) { /* si scrive il nome a mano */ } } },
        "🤝 Chiedi un preventivo") : null),
    modulo([
      campo("Nome", h("input", { name: "nome", value: f.nome || "", required: true, autocomplete: "off" })),
      campo("Note", h("input", { name: "note", value: f.note || "", autocomplete: "off" }),
        "Per esempio: giorno di consegna, telefono dell'agente."),
      campo("Dopo un ordine, la fattura arriva entro (giorni lavorativi)", h("input", { name: "giorni_fattura", inputmode: "numeric", autocomplete: "off",
        value: f.giorni_fattura == null ? "" : String(f.giorni_fattura), placeholder: "2" }),
        "Vuoto = 2 giorni (ordine di giovedì, fattura entro lunedì). 0 = non aspettarla: per chi la manda subito, come Metro, o fattura a fine mese."),
      spunta("attivo", "Fornitore attivo", f.attivo),
    ], "Salva", async (d) => {
      await ctx.dati.salvaFornitore(Object.assign({ id: f.id }, d), fornitori);
      location.hash = "#/fornitori";
    }));
}
