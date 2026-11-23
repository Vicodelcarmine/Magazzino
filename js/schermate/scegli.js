// Scelta di un articolo fra tanti (anche 200): pulsanti delle categorie + ricerca
// che si restringe a ogni lettera. Niente tendine lunghe.
import { h } from "../dom.js";
import { filtra, categorieCon } from "../cerca.js";
import { codice as segnoCodice, categoria as segnoCategoria, tipoDi, etichettaArticolo } from "./segni.js";

const MOSTRATI = 12;

// I pulsanti delle categorie. alCambio(chiave oppure "") a ogni tocco.
// famiglia: "articolo" (predefinita) o "piatto", per il colore dei pulsanti.
export function barraCategorie(lista, alCambio, famiglia) {
  const categorie = categorieCon(lista);
  if (categorie.length < 2) return null;
  let attiva = "";
  const barra = h("div", { class: "filtri tipo-" + (famiglia || "articolo"), role: "group", "aria-label": "Categorie" });
  function disegna() {
    const voce = (chiave, testo) => h("button", {
      type: "button", class: "filtro" + (attiva === chiave ? " attivo" : ""),
      "aria-pressed": attiva === chiave ? "true" : "false",
      onclick: () => { attiva = chiave; disegna(); alCambio(attiva); },
    }, testo);
    barra.replaceChildren(voce("", "Tutte (" + lista.length + ")"),
      ...categorie.map((c) => voce(c.chiave, c.nome + " (" + c.quante + ")")));
  }
  disegna();
  return barra;
}

// Il riquadro «Ingrediente» della distinta. Dentro un modulo porta il campo
// nascosto articolo_id. alCambio(articolo oppure null) quando la scelta cambia.
export function sceltaArticolo(articoli, alCambio) {
  let categoria = "";
  const nascosto = h("input", { type: "hidden", name: "articolo_id" });
  const cerca = h("input", {
    type: "search", autocomplete: "off", "aria-label": "Cerca ingrediente",
    placeholder: "Scrivi il nome, anche solo l'inizio",
  });
  const risultati = h("ul", { class: "lista risultati" });
  const ricerca = h("div", { class: "ricerca" });
  const scelto = h("div", { class: "scelto" });
  scelto.hidden = true;

  function scegli(a) {
    nascosto.value = a ? a.id : "";
    ricerca.hidden = !!a;
    scelto.hidden = !a;
    scelto.replaceChildren(...(a ? [
      h("span", { class: "riga-distinta tipo-" + tipoDi(a) }, etichettaArticolo(a)),
      h("button", { type: "button", class: "leggero", onclick: () => { scegli(null); cerca.focus(); } }, "Cambia"),
    ] : []));
    alCambio(a);
  }

  function disegna() {
    const trovati = filtra(articoli, cerca.value, categoria);
    risultati.replaceChildren(...trovati.slice(0, MOSTRATI).map((a) =>
      h("li", {}, h("button", { type: "button", class: "riga tipo-" + tipoDi(a), onclick: () => scegli(a) },
        h("strong", {}, a.nome), segnoCodice(tipoDi(a), a.codice),
        a.prodotto_in_cucina ? null : segnoCategoria("articolo", a.categoria)))));
    if (!trovati.length) {
      risultati.append(h("li", { class: "nota" }, "Nessun articolo così. Controlla il nome oppure creane uno nuovo qui sotto."));
    } else if (trovati.length > MOSTRATI) {
      risultati.append(h("li", { class: "nota" },
        "…e altri " + (trovati.length - MOSTRATI) + ": scrivi qualche lettera in più o scegli una categoria."));
    }
  }

  cerca.addEventListener("input", disegna);
  // Invio non deve spedire il modulo a metà: sceglie il primo della lista.
  cerca.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const primo = filtra(articoli, cerca.value, categoria)[0];
    if (primo) scegli(primo);
  });

  ricerca.append(...[barraCategorie(articoli, (c) => { categoria = c; disegna(); }), cerca, risultati].filter(Boolean));
  disegna();
  return h("div", { class: "scelta-articolo" }, nascosto, ricerca, scelto);
}
