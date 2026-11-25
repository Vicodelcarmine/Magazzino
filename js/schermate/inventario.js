// Inventario: si conta tutto il magazzino con calma, e si conferma in un secondo momento.
//
// Il conteggio resta in BOZZA sul telefono (anche senza rete, anche chiudendo l'app) finché non si preme
// «Conferma l'inventario». Solo allora diventa una serie di conteggi nel registro, tutti con l'ora della conferma.
// Perché in due tempi: il magazzino riparte dall'ultimo conteggio e toglie le vendite venute DOPO. Se si conta la
// sera e si conferma subito, la chiusura di cassa di quella sera (che arriva più tardi) verrebbe tolta una seconda
// volta da merce già contata. Confermando la mattina dopo, a chiusura arrivata, i conti tornano.
import { h, vuoto, conConferma } from "../dom.js";
import { qta, perCampo, parseNumero } from "../numeri.js";
import { reparti } from "./reparti.js";

const chiave = (ctx) => "erp.inventario." + ctx.ristorante.id;
function leggiBozza(ctx) {
  try { const b = JSON.parse(localStorage.getItem(chiave(ctx)) || "null"); return b && b.conteggi ? b : { iniziata: null, conteggi: {} }; }
  catch (e) { return { iniziata: null, conteggi: {} }; }
}
function salvaBozza(ctx, b) { try { localStorage.setItem(chiave(ctx), JSON.stringify(b)); return true; } catch (e) { return false; } }

const ore = (t) => new Date(t).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export async function pagina(ctx, ridisegna) {
  if (!ctx.titolare) return vuoto("Per ora l'inventario lo fa il titolare.");
  const tutti = (await ctx.dati.articoli()).filter((a) => a.attivo !== false && !a.prodotto_in_cucina);
  const bozza = leggiBozza(ctx);
  const noti = new Set(tutti.map((a) => a.id));
  Object.keys(bozza.conteggi).forEach((id) => { if (!noti.has(id)) delete bozza.conteggi[id]; });
  const contato = (a) => Object.prototype.hasOwnProperty.call(bozza.conteggi, a.id);
  const errore = h("p", { class: "errore", role: "alert" });
  const quanti = h("strong", {});
  const mancano = h("strong", {});
  const zonaConferma = h("div", { class: "scheda-confronto fine-spesa" });
  let salvataggioRotto = false;

  function segna(a, valore) {
    if (valore == null) delete bozza.conteggi[a.id]; else bozza.conteggi[a.id] = valore;
    if (!bozza.iniziata && Object.keys(bozza.conteggi).length) bozza.iniziata = new Date().toISOString();
    if (!Object.keys(bozza.conteggi).length) bozza.iniziata = null;
    if (!salvaBozza(ctx, bozza)) salvataggioRotto = true;
    aggiorna();
  }
  function aggiorna() {
    const n = Object.keys(bozza.conteggi).length;
    quanti.textContent = String(n);
    mancano.textContent = String(tutti.length - n);
    disegnaConferma();
  }

  const riga = (a) => {
    const stato = h("span", { class: "nota" });
    const li = h("li", {});
    const campo = h("input", { class: "stretto", inputmode: "decimal", autocomplete: "off", "aria-label": "Quanto ce n'è di " + a.nome,
      value: contato(a) ? perCampo(bozza.conteggi[a.id], 3) : "", placeholder: "—",
      oninput: (ev) => {
        const testo = ev.target.value.trim();
        const n = testo === "" ? null : parseNumero(testo);
        segna(a, n != null && n >= 0 ? n : null);
        dipingi();
      } });
    // «Ne ho trovate altre in un altro frigo»: si scrive solo la quantità in più, e si somma.
    const altro = h("input", { class: "stretto", inputmode: "decimal", autocomplete: "off", placeholder: "+", "aria-label": "Quantità da aggiungere a " + a.nome, hidden: true,
      onchange: (ev) => {
        const n = parseNumero(ev.target.value);
        if (n != null && n > 0) {
          const totale = Math.round(((contato(a) ? bozza.conteggi[a.id] : 0) + n) * 1000) / 1000;
          segna(a, totale);
          campo.value = perCampo(totale, 3);
        }
        ev.target.value = ""; ev.target.hidden = true;
        dipingi();
      } });
    const piu = h("button", { type: "button", class: "leggero", onclick: () => { altro.hidden = false; altro.focus(); } }, "＋ ne ho trovate altre");
    const blocco = h("div", { class: "riga tipo-articolo riga-inventario" },
      h("strong", {}, a.nome), h("span", { class: "dose" }, campo, h("strong", {}, a.udm), altro), stato, piu);
    function dipingi() {
      blocco.classList.toggle("presa", contato(a));
      stato.textContent = contato(a) ? "✓ contato: " + qta(bozza.conteggi[a.id]) + " " + a.udm : "da contare";
      piu.hidden = !contato(a);
      const reparto = li.closest("details");
      const conto = reparto && reparto.querySelector("summary .numero");
      if (conto) conto.textContent = reparto.querySelectorAll(".riga-inventario.presa").length + " di " + reparto.querySelectorAll(".riga-inventario").length + " contati";
    }
    li.append(blocco);
    dipingi();
    return li;
  };

  function disegnaConferma() {
    const n = Object.keys(bozza.conteggi).length;
    zonaConferma.hidden = !n;
    if (!n) return;
    const zero = h("input", { type: "checkbox" });
    const avviso = h("p", { class: "nota avviso" });
    const tasto = conConferma("Conferma l'inventario (" + n + " articoli)", "Sì, conferma adesso: non si torna indietro", async () => {
      errore.textContent = "";
      try {
        const conteggi = Object.keys(bozza.conteggi).map((id) => ({ articolo_id: id, quantita: bozza.conteggi[id] }));
        if (zero.checked) tutti.forEach((a) => { if (!contato(a)) conteggi.push({ articolo_id: a.id, quantita: 0 }); });
        const fatti = await ctx.dati.registraInventario(conteggi);
        localStorage.removeItem(chiave(ctx));
        location.hash = "#/magazzino";
        void fatti;
      } catch (e) { errore.textContent = e.message || "L'inventario non è stato registrato: la bozza è ancora qui, riprova."; }
    }, "primario");
    zonaConferma.replaceChildren(
      h("h3", {}, "Conferma l'inventario"),
      h("p", { class: "nota" }, "Da qui i numeri che hai scritto diventano le giacenze. Vale l'ora in cui confermi: conferma quando è già arrivata la chiusura di cassa dell'ultimo servizio (di solito la mattina dopo), altrimenti quelle vendite verrebbero tolte una seconda volta."),
      avviso,
      tutti.length - n > 0 ? h("label", { class: "spunta" }, zero, " Gli altri " + (tutti.length - n) + " articoli, che non ho contato, valgono zero") : null,
      tutti.length - n > 0 ? h("p", { class: "nota" }, "Senza la spunta, gli articoli non contati restano com'erano.") : null,
      h("div", { class: "azioni" }, tasto));
    // L'avviso sulla chiusura: si guarda quando è arrivata l'ultima.
    ctx.dati.ultimaChiusuraCassa().then((t) => {
      const iniziata = bozza.iniziata ? Date.parse(bozza.iniziata) : Date.now();
      if (t == null) avviso.textContent = "Non vedo nessuna chiusura di cassa: controlla la pagina Cassa prima di confermare.";
      else if (t < iniziata - 12 * 3600000) avviso.textContent = "Attenzione: l'ultima chiusura di cassa arrivata è di " + ore(t) + ", prima che tu cominciassi a contare. Quella dell'ultimo servizio non è ancora arrivata: aspetta che arrivi (guarda in Cassa), poi conferma.";
      else avviso.textContent = "";
      avviso.hidden = !avviso.textContent;
    }).catch(() => { avviso.hidden = true; });
  }

  aggiorna();
  return h("section", { class: "tipo-articolo" },
    h("div", { class: "testata" }, h("h2", {}, "Inventario")),
    h("p", { class: "nota" }, "Conta reparto per reparto e scrivi quanto c'è. Quello che scrivi resta su questo telefono, anche senza rete e anche se chiudi l'app, finché non confermi in fondo alla pagina. Se un articolo non c'è, scrivi 0."),
    bozza.iniziata ? h("p", { class: "nota avviso" }, "Inventario in corso, cominciato " + ore(bozza.iniziata) + ". Non è ancora confermato: le giacenze sono quelle di prima.") : null,
    h("div", { class: "riquadri" },
      h("div", { class: "riquadro" }, quanti, h("span", {}, "contati")),
      h("div", { class: "riquadro giallo" }, mancano, h("span", {}, "da contare")),
      h("div", { class: "riquadro" }, h("strong", {}, String(tutti.length)), h("span", {}, "articoli in tutto"))),
    salvataggioRotto ? h("p", { class: "errore" }, "Questo telefono non mi lascia salvare la bozza: se chiudi l'app i numeri si perdono.") : null,
    reparti({ voci: tutti, riga: riga, memoria: "inventario", unita: ["articolo", "articoli"],
      valore: (voci) => voci.filter(contato).length + " di " + voci.length + " contati",
      filtri: [["mancano", "Solo quelli ancora da contare", (a) => !contato(a)]],
      classeGruppo: (voci) => (voci.every(contato) ? "finito" : ""),
      ordinaGruppi: (x, y) => x.voci.every(contato) - y.voci.every(contato),
      cerca: "Cerca un articolo in tutti i reparti" }),
    errore, zonaConferma,
    Object.keys(bozza.conteggi).length ? h("div", { class: "azioni" },
      conConferma("Butta via questo inventario", "Sì, cancella tutti i numeri scritti", () => { localStorage.removeItem(chiave(ctx)); ridisegna(); })) : null);
}
