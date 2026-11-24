// Piatti: ciò che si vende (anche un bicchiere di amaro o una lattina). Colore: terracotta.
import { h, campo, modulo, suggerimenti, vuoto } from "../dom.js";
import { euro, perCampo } from "../numeri.js";
import { categorie } from "../codici.js";
import { reparti } from "./reparti.js";
import { codice as segnoCodice, categoria as segnoCategoria } from "./segni.js";

export const STATI = {
  da_completare: "manca la distinta",
  attivo: "attivo",
  archiviato: "archiviato",
};

export async function elenco(ctx) {
  const piatti = await ctx.dati.piatti();
  const riga = (p) => h("li", {}, h("a", { class: "riga tipo-piatto" + (p.stato === "archiviato" ? " spento" : ""), href: "#/piatti/" + p.id },
    h("strong", {}, p.nome),
    h("span", { class: "bollo " + p.stato }, STATI[p.stato]),
    h("span", { class: "nota" }, p.prezzo_listino != null ? euro(p.prezzo_listino) : "senza prezzo")));
  return h("section", { class: "tipo-piatto" },
    h("div", { class: "testata" },
      h("h2", {}, "Piatti in vendita"),
      ctx.titolare ? h("a", { class: "pulsante primario", href: "#/piatti/nuovo" }, "＋ Nuovo") : null),
    h("p", { class: "nota" }, "Ciò che vendi. Quello che compri sta in Articoli."),
    reparti({ voci: piatti, riga: riga, memoria: "piatti", unita: ["piatto", "piatti"],
      allarme: (p) => p.stato === "da_completare", etichettaAllarme: (n) => n + (n === 1 ? " senza distinta" : " senza distinta"),
      cerca: "Cerca un piatto in tutti i reparti",
      vuoto: "Nessun piatto. Aggiungi il primo con «＋ Nuovo»: subito dopo ti chiedo la distinta base." }));
}

// Il codice non è fra i campi: lo assegna il sistema quando il piatto nasce.
export function campiPiatto(p, piatti) {
  return [
    campo("Nome", h("input", { name: "nome", value: p.nome || "", required: true, autocomplete: "off" })),
    campo("Categoria di vendita", h("input", {
      name: "categoria", value: p.categoria || "", list: "categorie-piatti", autocomplete: "off",
    }), "Per esempio Pizza, Primi, Amari, Bibite."),
    suggerimenti("categorie-piatti", categorie(piatti)),
    campo("Prezzo di listino (€)", h("input", {
      name: "prezzo_listino", inputmode: "decimal", value: perCampo(p.prezzo_listino), autocomplete: "off",
    })),
  ];
}

export async function nuovo(ctx) {
  const piatti = await ctx.dati.piatti();
  return h("section", { class: "tipo-piatto" },
    h("h2", {}, "Nuovo piatto in vendita"),
    modulo(campiPiatto({}, piatti), "Crea e passa alla distinta base", async (d) => {
      const p = await ctx.dati.salvaPiatto(d);
      location.hash = "#/piatti/" + p.id;
    }));
}
