// Due aiuti sulla scheda di un articolo, per le cose che si comprano e si rivendono
// (una lattina, un bicchiere di amaro):
//  - «Usato in»: i piatti e le preparazioni che lo contengono;
//  - «Vendilo così com'è»: crea il piatto già collegato all'articolo.
import { h, campo, modulo } from "../dom.js";
import { qta } from "../numeri.js";
import { comoda, piccolaDi } from "../unita.js";
import { campiPiatto } from "./piatti.js";
import { sceltaUnita } from "./distinta.js";
import { codice as segnoCodice } from "./segni.js";

export async function usatoIn(ctx, articolo, piatti, articoli) {
  const righe = await ctx.dati.usiDi(articolo.id);
  const voci = righe.map((r) => {
    if (r.piatto_id) {
      const p = piatti.find((x) => x.id === r.piatto_id);
      if (!p) return null;
      const m = comoda(Number(r.quantita), articolo.udm);
      return { nome: p.nome, nodo: h("a", { class: "riga tipo-piatto", href: "#/piatti/" + p.id },
        h("strong", {}, p.nome), segnoCodice("piatto", p.codice),
        h("span", { class: "nota" }, qta(m.valore) + " " + m.unita + " a porzione"
          + (p.stato === "archiviato" ? " · piatto archiviato" : ""))) };
    }
    const prep = articoli.find((x) => x.id === r.preparazione_id);
    if (!prep) return null;
    const lotto = Number(prep.lotto_abituale) > 0 ? Number(prep.lotto_abituale) : 1;
    const m = comoda(Number(r.quantita) * lotto, articolo.udm);
    return { nome: prep.nome, nodo: h("a", { class: "riga tipo-preparazione", href: "#/preparazioni/" + prep.id },
      h("strong", {}, prep.nome), segnoCodice("preparazione", prep.codice),
      h("span", { class: "nota" }, qta(m.valore) + " " + m.unita + " ogni " + qta(lotto) + " " + prep.udm)) };
  }).filter(Boolean).sort((x, y) => x.nome.localeCompare(y.nome, "it"));

  return h("div", { class: "usato-in" },
    h("h3", {}, "Usato in"),
    voci.length ? h("ul", { class: "lista" }, voci.map((v) => h("li", {}, v.nodo)))
      : h("p", { class: "nota" }, "In nessun piatto e in nessuna preparazione, per ora."));
}

export function vendiCosi(ctx, articolo, piatti, articoli) {
  const unita = sceltaUnita(articolo.udm, piccolaDi(articolo.udm));
  return h("details", { class: "tipo-piatto" },
    h("summary", {}, "Vendilo così com'è: crea il piatto"),
    h("p", { class: "nota" },
      "Per ciò che compri e rivendi uguale: una lattina, un bicchiere di amaro. Nasce un piatto in vendita, ",
      "già collegato a questo articolo."),
    modulo([
      campiPiatto({ nome: articolo.nome, categoria: articolo.categoria }, piatti),
      campo("Quanto ne va in una porzione", h("span", { class: "con-unita" },
        h("input", { name: "quantita", inputmode: "decimal", autocomplete: "off",
          value: articolo.udm === "pz" ? "1" : "" }), unita),
      articolo.udm === "pz" ? "Di solito 1: un pezzo comprato, un pezzo venduto."
        : "Per esempio 4 cl per un amaro."),
    ], "Crea il piatto", async (d) => {
      const p = await ctx.dati.vendiArticolo(articolo, d);
      location.hash = "#/piatti/" + p.id;
    }));
}
