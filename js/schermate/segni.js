// I segni che distinguono a colpo d'occhio le tre famiglie:
//   ARTICOLO     = ciò che entra in magazzino        (blu)
//   PREPARAZIONE = ciò che si fa in cucina           (viola)
//   PIATTO       = ciò che si vende                  (terracotta)
// Il colore non basta da solo: c'è sempre anche la parola.
import { h } from "../dom.js";

// I codici (LAT-009, PIZ-001) esistono e li assegna il sistema, ma NON si mostrano:
// il titolare li trova solo fonte di confusione (23/11/2026). Restano nell'archivio
// e servono a fatture e cassa. Per rivederli a schermo basta mettere «true» qui.
export const MOSTRA_CODICI = false;

const PAROLA = { articolo: "Articolo", preparazione: "Preparazione", piatto: "Piatto" };

export function tipoDi(articolo) {
  return articolo && articolo.prodotto_in_cucina ? "preparazione" : "articolo";
}

// L'etichetta della famiglia (ARTICOLO / PREPARAZIONE / PIATTO), col codice solo se richiesto.
export function codice(tipo, valore) {
  return h("span", { class: "codice tipo-" + tipo },
    h("span", { class: "famiglia" }, PAROLA[tipo]), MOSTRA_CODICI ? " " + valore : null);
}

export function categoria(tipo, valore) {
  return h("span", { class: "categoria tipo-" + tipo }, valore || "senza categoria");
}

// Nome + codice di un articolo dentro una distinta.
export function etichettaArticolo(a) {
  const tipo = tipoDi(a);
  return h("span", { class: "nome" }, a.nome, " ", codice(tipo, a.codice),
    a.attivo ? null : h("span", { class: "bollo" }, "non attivo"));
}
