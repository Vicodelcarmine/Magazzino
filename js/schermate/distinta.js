// La distinta base, uguale per un piatto e per una preparazione.
// Nell'archivio le quantità sono sempre «per 1» e nell'unità dell'articolo (kg, L, pz):
// una porzione di piatto, oppure 1 kg/L/pz di preparazione. Qui «scala» dice per
// quante unità le si mostra (1 per il piatto, la dose abituale per la preparazione),
// e si può scrivere anche in grammi e centilitri.
import { h, campo, modulo, vuoto, conConferma } from "../dom.js";
import { qta, perCampo, parseNumero } from "../numeri.js";
import { unitaPer, inBase, comoda, piccolaDi } from "../unita.js";
import { campiArticolo } from "./articoli.js";
import { etichettaArticolo } from "./segni.js";
import { sceltaArticolo } from "./scegli.js";

export function sceltaUnita(udm, scelta) {
  const sel = h("select", { name: "unita", class: "unita-misura", "aria-label": "Unità" });
  sel.imposta = (nuovaUdm, preferita) => {
    sel.replaceChildren(...unitaPer(nuovaUdm).map((u) => h("option", { value: u, selected: u === preferita }, u)));
    sel.hidden = !nuovaUdm;
  };
  sel.imposta(udm, scelta);
  return sel;
}

// opz: { righe (quelle aperte), articoli, chiave: { piatto_id } | { preparazione_id },
//        scala, perCosa ("una porzione"), vietati: Set di id, modificabile, ridisegna }
export function distinta(ctx, opz) {
  const { righe, articoli, chiave, perCosa, ridisegna } = opz;
  const scala = opz.scala > 0 ? opz.scala : 1;
  const vietati = opz.vietati || new Set();
  const perId = new Map(articoli.map((a) => [a.id, a]));
  const nomeDi = (r) => (perId.get(r.articolo_id) || { nome: "" }).nome;
  const ordinate = righe.slice().sort((x, y) => nomeDi(x).localeCompare(nomeDi(y), "it"));
  const avviso = h("p", { class: "errore", role: "alert" });

  // Da «quanto ne metto nella dose mostrata, nell'unità scelta» a «quanto per 1, nell'unità dell'articolo».
  function perUno(valore, unita, udm) {
    const n = parseNumero(valore);
    if (n == null || !(n > 0)) return valore; // lo rifiuterà il controllo, col suo messaggio
    return Math.round((inBase(n, unita, udm) / scala) * 1e6) / 1e6;
  }

  async function prova(azione) {
    avviso.textContent = "";
    try { await azione(); ridisegna(); } catch (e) { avviso.textContent = e.message; }
  }

  function riga(r) {
    const a = perId.get(r.articolo_id);
    const udm = a ? a.udm : "";
    const m = comoda(Number(r.quantita) * scala, udm);
    const scritto = perCampo(m.valore, 4);
    const quanto = h("input", {
      class: "stretto", inputmode: "decimal", value: scritto,
      "aria-label": "Quantità di " + (a ? a.nome : "ingrediente"),
    });
    const unita = sceltaUnita(udm, m.unita);
    return h("li", { class: "riga-distinta " + (a && a.prodotto_in_cucina ? "tipo-preparazione" : "tipo-articolo") },
      a ? etichettaArticolo(a) : h("span", { class: "nome" }, "Articolo mancante"),
      opz.modificabile
        ? h("span", { class: "dose" }, quanto, unita,
          h("button", { type: "button", onclick: () => prova(() => {
            // Se numero e unità non sono stati toccati non si riscrive niente.
            if (quanto.value.trim() === scritto && unita.value === m.unita) return null;
            return ctx.dati.cambiaQuantita(r, perUno(quanto.value, unita.value, udm), righe);
          }) }, "Cambia"),
          conConferma("Togli", "Sì, togli " + (a ? a.nome : "la riga"), () => prova(() => ctx.dati.togliRiga(r))))
        : h("span", { class: "dose" }, qta(m.valore) + " " + m.unita));
  }

  // Aggiunta di un ingrediente: fra quelli che ci sono, oppure nuovo sul momento.
  function aggiunta() {
    const usati = new Set(righe.map((r) => r.articolo_id));
    const liberi = articoli.filter((a) => a.attivo && !usati.has(a.id) && !vietati.has(a.id));
    // In una porzione si ragiona in grammi e centilitri; in una dose di cucina in chili e litri.
    const proposta = (udm) => (scala === 1 ? piccolaDi(udm) : udm);
    const etichetta = "Quantità per " + perCosa;

    const unitaE = sceltaUnita("", "");
    const quantitaE = h("input", { name: "quantita", inputmode: "decimal", autocomplete: "off" });
    const sel = sceltaArticolo(liberi, (a) => {
      unitaE.imposta(a ? a.udm : "", a ? proposta(a.udm) : "");
      if (a) quantitaE.focus();
    });

    const esistente = modulo([
      h("div", { class: "campo" }, h("span", { class: "etichetta" }, "Ingrediente (articolo di magazzino)"), sel),
      campo(etichetta, h("span", { class: "con-unita" }, quantitaE, unitaE)),
    ], "Aggiungi alla distinta", async (d) => {
      const a = perId.get(d.articolo_id);
      await ctx.dati.aggiungiRiga(chiave,
        { articolo_id: d.articolo_id, quantita: a ? perUno(d.quantita, d.unita, a.udm) : d.quantita }, righe);
      ridisegna();
    });

    const unitaN = sceltaUnita("kg", proposta("kg"));
    const nuovo = modulo([
      campiArticolo({}, articoli, true),
      campo(etichetta, h("span", { class: "con-unita" },
        h("input", { name: "quantita", inputmode: "decimal", autocomplete: "off" }), unitaN)),
    ], "Crea l'articolo e aggiungilo", async (d) => {
      // Prima controllo la quantità, così non nasce un articolo se la riga non può entrare.
      if (!(parseNumero(d.quantita) > 0)) {
        throw new Error("Scrivi la quantità (un numero maggiore di zero).");
      }
      const a = await ctx.dati.salvaArticolo(d);
      await ctx.dati.aggiungiRiga(chiave,
        { articolo_id: a.id, quantita: perUno(d.quantita, d.unita, a.udm) }, righe);
      ridisegna();
    });
    nuovo.elements.udm.addEventListener("change", (ev) => unitaN.imposta(ev.target.value, proposta(ev.target.value)));
    nuovo.hidden = true;

    const cambia = h("button", { type: "button", class: "leggero", onclick: () => {
      nuovo.hidden = !nuovo.hidden;
      esistente.hidden = !esistente.hidden;
      cambia.textContent = nuovo.hidden ? "＋ L'ingrediente non c'è: creane uno nuovo" : "‹ Scegli fra gli articoli che ci sono";
    } }, "＋ L'ingrediente non c'è: creane uno nuovo");

    return h("div", { class: "aggiunta" }, h("h3", {}, "Aggiungi un ingrediente"), esistente, nuovo, cambia);
  }

  return [
    ordinate.length ? h("ul", { class: "lista" }, ordinate.map(riga))
      : vuoto("Ancora nessun ingrediente: aggiungi il primo qui sotto."),
    avviso,
    opz.modificabile ? aggiunta() : null,
  ];
}
