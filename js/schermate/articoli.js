// Articoli di magazzino: ciò che si compra e si conta. Colore: blu.
import { h, campo, modulo, scelta, spunta, suggerimenti, vuoto } from "../dom.js";
import { qta, perCampo } from "../numeri.js";
import { categorie } from "../codici.js";
import { reparti } from "./reparti.js";
import { codice as segnoCodice, categoria as segnoCategoria } from "./segni.js";
import { usatoIn, vendiCosi } from "./rivendita.js";

const UNITA = [["kg", "chili (kg)"], ["L", "litri (L)"], ["pz", "pezzi (pz)"]];
const TIPI = [
  ["ricetta", "Si consuma con i piatti venduti (pelati, farina…)"],
  ["tempo", "Si consuma col tempo (detersivi, tovaglioli…)"],
];

export async function elenco(ctx) {
  const articoli = (await ctx.dati.articoli()).filter((a) => !a.prodotto_in_cucina);
  const riga = (a) => h("li", {}, h("a", { class: "riga tipo-articolo" + (a.attivo ? "" : " spento"), href: "#/articoli/" + a.id },
    h("strong", {}, a.nome),
    h("span", { class: "nota" }, [
      a.qta_confezione > 0 ? "confezione da " + qta(a.qta_confezione) + " " + a.udm : "si conta in " + a.udm,
      a.tipo === "tempo" ? "a tempo" : null,
      a.attivo ? null : "non attivo",
    ].filter(Boolean).join(" · "))));
  return h("section", { class: "tipo-articolo" },
    h("div", { class: "testata" },
      h("h2", {}, "Articoli di magazzino"),
      ctx.titolare ? h("a", { class: "pulsante primario", href: "#/articoli/nuovo" }, "＋ Nuovo") : null),
    h("p", { class: "nota" }, "Ciò che compri e conti. Quello che vendi sta in Piatti."),
    reparti({ voci: articoli, riga: riga, memoria: "articoli", unita: ["articolo", "articoli"],
      cerca: "Cerca un articolo in tutti i reparti", vuoto: "Nessun articolo. Aggiungi il primo con «＋ Nuovo»." }));
}

// I campi dell'articolo, usati anche dalla distinta base per «articolo nuovo sul momento».
// Il codice non è fra i campi: lo assegna il sistema quando l'articolo nasce.
export function campiArticolo(a, articoli, corto, fornitori) {
  return [
    campo("Nome", h("input", { name: "nome", value: a.nome || "", required: true, autocomplete: "off" })),
    campo("Categoria di magazzino", h("input", {
      name: "categoria", value: a.categoria || "", list: "categorie-articoli", autocomplete: "off",
    }), "Per esempio Dispensa, Latticini, Liquori. Serve a ritrovarlo in fretta fra tanti."),
    suggerimenti("categorie-articoli", categorie(articoli.filter((x) => !x.prodotto_in_cucina))),
    campo("Unità di misura", scelta("udm", UNITA, a.udm || "kg"),
      "È l'unità in cui lo conti in magazzino. Nelle ricette potrai scrivere anche grammi e centilitri."),
    campo("Contenuto di una confezione", h("input", {
      name: "qta_confezione", inputmode: "decimal", value: a.qta_confezione ? perCampo(a.qta_confezione) : "",
      autocomplete: "off",
    }), "Per esempio 15 se il collo è da 15 kg, 1 se la bottiglia è da 1 litro. Vuoto se non lo sai."),
    corto ? null : campo("Come si consuma", scelta("tipo", TIPI, a.tipo || "ricetta")),
    corto ? null : spunta("acquisto_sfuso", "Si compra sfuso (a peso, non a confezioni)", a.acquisto_sfuso),
    corto || !fornitori ? null : campo("Fornitore fisso", scelta("fornitore_fisso_id",
      [["", "— nessuno: vince il prezzo migliore —"]].concat(fornitori.filter((f) => f.attivo !== false || f.id === a.fornitore_fisso_id).map((f) => [f.id, f.nome])),
      a.fornitore_fisso_id || ""), "Se lo scegli, la Spesa mette questo articolo sempre nel suo ordine, anche quando un altro costa meno."),
    corto ? null : spunta("attivo", "Articolo attivo", a.attivo !== false),
  ];
}

export async function scheda(ctx, id) {
  const [articoli, piatti, fornitori] = await Promise.all([ctx.dati.articoli(), ctx.dati.piatti(), ctx.dati.fornitori()]);
  const a = id === "nuovo" ? {} : articoli.find((x) => x.id === id);
  if (!a) return vuoto("Articolo non trovato.");
  return h("section", { class: "tipo-articolo" },
    h("h2", {}, a.id ? [a.nome, " ", segnoCodice("articolo", a.codice)] : "Nuovo articolo di magazzino"),
    a.id ? await usatoIn(ctx, a, piatti, articoli) : null,
    a.id ? h("h3", {}, "Dati dell'articolo") : null,
    modulo(campiArticolo(a, articoli, false, fornitori), "Salva", async (d) => {
      await ctx.dati.salvaArticolo(Object.assign({ id: a.id }, d));
      location.hash = "#/articoli";
    }),
    a.id && ctx.titolare && a.attivo && a.tipo !== "tempo" ? vendiCosi(ctx, a, piatti, articoli) : null);
}
