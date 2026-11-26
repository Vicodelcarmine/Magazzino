// Piatti: ciò che si vende (anche un bicchiere di amaro o una lattina). Colore: terracotta.
import { h, campo, modulo, spunta, sceltaCategoria, vuoto } from "../dom.js";
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
    h("span", { class: "bollo " + p.stato }, p.senza_merce && p.stato !== "archiviato" ? "senza merce" : STATI[p.stato]),
    h("span", { class: "nota" }, p.prezzo_listino != null ? euro(p.prezzo_listino) : "senza prezzo")));
  return h("section", { class: "tipo-piatto" },
    h("div", { class: "testata" },
      h("h2", {}, "Piatti in vendita"),
      ctx.titolare ? h("a", { class: "pulsante primario", href: "#/piatti/nuovo" }, "＋ Nuovo") : null),
    h("p", { class: "nota" }, "Ciò che vendi. Quello che compri sta in Articoli."),
    reparti({ voci: piatti, riga: riga, memoria: "piatti", unita: ["piatto", "piatti"],
      allarme: (p) => p.stato === "da_completare" && !p.senza_merce, etichettaAllarme: (n) => n + (n === 1 ? " senza distinta" : " senza distinta"),
      cerca: "Cerca un piatto in tutti i reparti",
      vuoto: "Nessun piatto. Aggiungi il primo con «＋ Nuovo»: subito dopo ti chiedo la distinta base." }));
}

// Il codice non è fra i campi: lo assegna il sistema quando il piatto nasce.
export function campiPiatto(p, piatti) {
  return [
    campo("Nome", h("input", { name: "nome", value: p.nome || "", required: true, autocomplete: "off" })),
    campo("Categoria di vendita", sceltaCategoria(p.categoria, categorie(piatti.filter((x) => x.stato !== "archiviato"))),
      "Si sceglie fra quelle che ci sono; per una categoria nuova c'è la voce in fondo all'elenco."),
    campo("Prezzo di listino (€)", h("input", {
      name: "prezzo_listino", inputmode: "decimal", value: perCampo(p.prezzo_listino), autocomplete: "off",
    })),
    spunta("senza_merce", "Senza merce: si vende ma non consuma niente dal magazzino (coperto, acqua alla spina)", p.senza_merce === true),
  ];
}

export async function nuovo(ctx) {
  const piatti = await ctx.dati.piatti();
  return h("section", { class: "tipo-piatto" },
    h("h2", {}, "Nuovo piatto in vendita"),
    modulo(campiPiatto({}, piatti), "Crea e passa alla distinta base", async (d) => {
      if (!String(d.categoria || "").trim()) throw new Error("Scegli la categoria del piatto.");
      const p = await ctx.dati.salvaPiatto(d);
      location.hash = p.senza_merce ? "#/piatti" : "#/piatti/" + p.id;
    }));
}
