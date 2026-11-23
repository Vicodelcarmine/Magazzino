import { h, campo, modulo, spunta } from "../dom.js";
import { nuovoId, pulisci } from "../numeri.js";
import { creaDati } from "../dati.js";
import { VERSIONE, TAPPA } from "../versione.js";

export function schermataAccesso(archivio, fatto, scelta) {
  return h("main", { class: "centro" },
    h("h1", {}, "Magazzino"),
    // In cima e ben visibile: in quale archivio si sta per entrare.
    scelta ? h("div", { class: "quale-archivio" },
      h("span", { class: "etichetta" }, "Dove vuoi entrare?"),
      h("div", { class: "filtri", role: "group", "aria-label": "Quale archivio" },
        Object.keys(scelta.archivi).map((k) => h("button", { type: "button",
          class: "filtro" + (k === scelta.scelto ? " attivo" : ""), "aria-pressed": k === scelta.scelto ? "true" : "false",
          onclick: () => { if (k !== scelta.scelto) scelta.cambia(k); } }, scelta.archivi[k].nome))),
      h("p", { class: "nota" }, scelta.scelto === "prova"
        ? "Archivio di prova: i dati stanno solo su questo Mac. Si entra con le credenziali di prova."
        : "Archivio online: si entra con la tua email e la tua password.")) : null,
    h("p", { class: "sotto" }, "Entra con email e password."),
    modulo([
      campo("Email", h("input", { name: "email", type: "email", autocomplete: "username", required: true })),
      campo("Password", h("input", { name: "password", type: "password", autocomplete: "current-password", required: true })),
    ], "Entra", async (d) => {
      if (!pulisci(d.email) || !d.password) throw new Error("Scrivi email e password.");
      await archivio.entra(d.email, d.password);
      fatto();
    }),
    h("p", { class: "piede" }, "Versione " + VERSIONE + " · " + TAPPA));
}

// Primo ingresso (nessun ristorante) oppure aggiunta di un altro ristorante.
export function schermataNuovoRistorante(archivio, fatto, annulla) {
  return h("main", { class: "centro" },
    h("h1", {}, "Nuovo ristorante"),
    h("p", { class: "sotto" }, "Ogni ristorante ha i suoi articoli, fornitori e piatti, separati dagli altri."),
    modulo([
      campo("Nome del ristorante", h("input", { name: "nome", required: true, autocomplete: "off" })),
      spunta("esempio", "Riempilo con dati di esempio (una Margherita e i suoi ingredienti)", false),
    ], "Crea", async (d) => {
      const nome = pulisci(d.nome);
      if (!nome) throw new Error("Scrivi il nome del ristorante.");
      const r = await archivio.funzione("crea_ristorante", { id: nuovoId(), nome: nome, demo: !!d.esempio });
      if (d.esempio) await creaDati(archivio, r.id).caricaEsempio();
      fatto(r);
    }, annulla ? h("button", { type: "button", onclick: annulla }, "Annulla") : null));
}

export function schermataScegliRistorante(ristoranti, scegli, nuovo) {
  return h("main", { class: "centro" },
    h("h1", {}, "Quale ristorante?"),
    h("ul", { class: "lista" }, ristoranti.map((r) =>
      h("li", {}, h("button", { class: "riga", onclick: () => scegli(r) },
        h("strong", {}, r.nome), r.demo ? h("span", { class: "bollo" }, "esempio") : null)))),
    h("button", { onclick: nuovo }, "＋ Nuovo ristorante"));
}
