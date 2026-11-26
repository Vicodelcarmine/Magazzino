// Le pagine dei conti: Magazzino (giacenze), Spesa (cosa ordinare), Costi (food cost e allerta prezzi).
// I numeri non sono salvati da nessuna parte: si ricalcolano ogni volta dal registro dei movimenti.
import { h, campo, modulo, scelta, vuoto, conConferma } from "../dom.js";
import { qta, euro } from "../numeri.js";
import * as motore from "../motore.js";
import { reparti } from "./reparti.js";
import * as spostamenti from "../spostamenti.js";
import { scordaBozza } from "./ordini.js";
import { filtra } from "../cerca.js";
import { categoria as segnoCategoria } from "./segni.js";

const GIORNO = 86400000;
const pct = (n) => (n == null ? "—" : new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 }).format(n));
const giorno = (t) => (t == null ? "mai" : new Date(t).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }));
const giorniFa = (t, adesso) => Math.floor((adesso - t) / GIORNO);

async function conti(ctx) {
  return motore.prepara(await ctx.dati.perIConti(ctx.ristorante));
}

function aggiornamento(c) {
  if (c.ultimaVendita == null) return h("p", { class: "nota" }, "Non ci sono ancora vendite registrate: i consumi non si possono calcolare.");
  const fa = giorniFa(c.ultimaVendita, c.adesso);
  return h("p", { class: "nota" + (fa > 2 ? " avviso" : "") },
    "Vendite della cassa aggiornate al " + giorno(c.ultimaVendita) + (fa > 2 ? " (" + fa + " giorni fa: i numeri qui sotto sono fermi a quel giorno)." : "."));
}

function sfridoTesto(p) {
  if (p.tipo === "tempo") return "a tempo";
  if (p.fonteSfrido !== "inventari") return "sfrido non ancora misurato";
  const extra = p.limiteSfrido ? " (al limite: da controllare)" : "";
  return "sfrido " + qta(p.coef) + extra;
}

// ---------- Magazzino ----------
export async function magazzino(ctx) {
  const c = await conti(ctx);
  const tutti = motore.cruscotto(c).filter((p) => p.attivo);
  const sottoZero = tutti.filter((p) => p.giacenzaNegativa).length;
  const maiContati = tutti.filter((p) => p.contatoIl == null).length;
  const riga = (p) => h("li", {}, h("a", { class: "riga tipo-articolo" + (p.giacenzaNegativa ? " allarme" : ""), href: "#/magazzino/" + p.id },
    h("strong", {}, p.nome),
    h("span", { class: "numero" + (p.giacenzaNegativa ? " rosso" : "") }, qta(p.giacenza) + " " + p.udm),
    h("span", { class: "nota" }, [
      p.giacenzaNegativa ? "sotto zero: va ricontato" : (p.autonomia == null ? null : "basta per " + qta(Math.floor(p.autonomia)) + " giorni"),
      "contato: " + giorno(p.contatoIl),
      sfridoTesto(p),
    ].filter(Boolean).join(" · "))));
  return h("section", { class: "tipo-articolo" },
    h("div", { class: "testata" }, h("h2", {}, "Magazzino"), h("a", { class: "pulsante", href: "#/inventario" }, "Inventario completo")),
    aggiornamento(c),
    h("div", { class: "riquadri" },
      riquadro(String(tutti.length), "articoli attivi"),
      riquadro(String(sottoZero), "sotto zero", sottoZero ? "rosso" : ""),
      riquadro(String(maiContati), "mai contati", maiContati ? "giallo" : "")),
    reparti({ voci: tutti, riga: riga, memoria: "magazzino", unita: ["articolo", "articoli"],
      allarme: (p) => p.giacenzaNegativa, etichettaAllarme: (n) => n + " sotto zero",
      filtri: [["zero", "Solo sotto zero", (p) => p.giacenzaNegativa], ["mai", "Solo mai contati", (p) => p.contatoIl == null]],
      cerca: "Cerca un articolo in tutti i reparti" }));
}

function riquadro(numero, cosa, colore) {
  return h("div", { class: "riquadro " + (colore || "") }, h("strong", {}, numero), h("span", {}, cosa));
}

// ---------- Un articolo: i suoi numeri, e dove si registra un conteggio o un arrivo ----------
export async function articolo(ctx, id, ridisegna) {
  const [c, fornitori] = await Promise.all([conti(ctx), ctx.dati.fornitori()]);
  const p = motore.profilo(c, id);
  if (!p) return vuoto("Articolo non trovato.");
  const s = motore.sfrido(c, id);
  const m = c.mov(id);
  const ultimi = [].concat(
    m.conteggi.eventi.map((e) => ({ t: e.t, cosa: "Contato", q: e.q, id: e.id })),
    m.carichi.eventi.map((e) => ({ t: e.t, cosa: "Arrivato", q: e.q, id: e.id })),
    m.correzioni.eventi.map((e) => ({ t: e.t, cosa: e.q < 0 ? "Buttato" + (e.nota ? " (" + e.nota + ")" : "") : "Correzione", q: e.q, id: e.id })))
    .sort((a, b) => b.t - a.t).slice(0, 12);
  // Già contato oggi? Allora il prossimo numero può essere «altre trovate» oppure «il totale giusto».
  const ultimoConteggio = m.conteggi.eventi.length ? m.conteggi.eventi[m.conteggi.eventi.length - 1] : null;
  const giaOggi = ultimoConteggio && new Date(ultimoConteggio.t).toDateString() === new Date().toDateString()
    ? { id: ultimoConteggio.id, quantita: ultimoConteggio.q, ora: new Date(ultimoConteggio.t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) }
    : null;
  const avvisoMovimenti = h("p", { class: "errore", role: "alert" });
  const riga = (cosa, valore, classe) => h("li", { class: "voce" }, h("span", {}, cosa), h("strong", { class: classe || "" }, valore));

  return h("section", { class: "tipo-articolo" },
    h("div", { class: "testata" }, h("h2", {}, p.nome, " ", segnoCategoria("articolo", p.categoria))),
    h("ul", { class: "voci" },
      riga("In magazzino adesso (calcolato)", qta(p.giacenza) + " " + p.udm, p.giacenzaNegativa ? "rosso" : ""),
      riga("Ultimo conteggio", giorno(p.contatoIl)),
      riga("Consumo al giorno", p.consumoMedio > 0 ? qta(p.consumoMedio) + " " + p.udm : "non calcolabile"),
      riga("Basta per", p.autonomia == null ? "—" : qta(Math.floor(p.autonomia)) + " giorni"),
      riga("Sfrido", p.tipo === "tempo" ? "non si applica (a tempo)"
        : (s.fonte === "inventari" ? qta(s.coef) + " — consumati " + qta(s.reale) + " " + p.udm + " contro " + qta(s.teorico) + " da ricetta"
          : "servono due conteggi con vendite in mezzo")),
      riga("Miglior prezzo", p.prezzo ? euro(p.prezzo.prezzoUdm) + " al " + p.udm + " — " + p.prezzo.fornitore
        + " (" + p.prezzo.tipo + " del " + giorno(Date.parse(p.prezzo.data)) + (p.prezzo.scaduto ? ", vecchio" : "") + ")" : "nessun prezzo")),
    p.giacenzaNegativa ? h("p", { class: "errore" }, "La giacenza calcolata è sotto zero: è stato consumato più di quanto risulta entrato. "
      + "Di solito manca un carico oppure l'ultimo conteggio è vecchio. Ricontalo.") : null,
    s.scartati ? h("p", { class: "nota avviso" }, s.scartati + " periodo/i fra due conteggi non tornano (risulta più merce alla fine che all'inizio senza carichi) e non contano nello sfrido.") : null,

    h("div", { class: "due" },
      h("div", {}, h("h3", {}, "Ho contato"),
        giaOggi ? h("p", { class: "nota avviso" }, "Oggi alle " + giaOggi.ora + " ne hai già contati "
          + qta(giaOggi.quantita) + " " + p.udm + ".") : null,
        modulo([
          campo(giaOggi ? "Quanti (" + p.udm + ")" : "Quanto ce n'è adesso (" + p.udm + ")",
            h("input", { name: "quantita", inputmode: "decimal", autocomplete: "off" })),
          giaOggi ? h("div", { class: "campo" },
            h("label", { class: "spunta" }, h("input", { type: "radio", name: "modo", value: "aggiungi" }),
              " Ne ho trovati altri: si AGGIUNGONO ai " + qta(giaOggi.quantita) + " già contati"),
            h("label", { class: "spunta" }, h("input", { type: "radio", name: "modo", value: "sostituisci" }),
              " È il totale giusto: SOSTITUISCE i " + qta(giaOggi.quantita) + " di prima")) : null,
        ], "Registra il conteggio", async (d) => {
          await ctx.dati.registraConteggio(id, d.quantita, giaOggi, d.modo);
          ridisegna();
        })),
      h("div", {}, h("h3", {}, "È arrivata merce"),
        modulo([
          campo("Quanta (" + p.udm + ")", h("input", { name: "quantita", inputmode: "decimal", autocomplete: "off" })),
          campo("Fornitore", scelta("fornitore_id", [["", "— acquisto diretto, senza fornitore —"]]
            .concat(fornitori.filter((f) => f.attivo).map((f) => [f.id, f.nome])), "")),
          campo("Prezzo al " + p.udm + " (€)", h("input", { name: "prezzo", inputmode: "decimal", autocomplete: "off" }),
            "Facoltativo. Se c'è il fornitore, entra nel confronto dei prezzi."),
        ], "Registra l'arrivo", async (d) => { await ctx.dati.registraCarico(id, d); ridisegna(); })),
      h("div", {}, h("h3", {}, "Ho buttato"),
        modulo([
          campo("Quanta (" + p.udm + ")", h("input", { name: "quantita", inputmode: "decimal", autocomplete: "off" })),
          campo("Perché", h("input", { name: "motivo", autocomplete: "off" }), "Per esempio: scaduto, caduto, bruciato."),
        ], "Registra lo spreco", async (d) => { await ctx.dati.registraSpreco(id, d.quantita, d.motivo); ridisegna(); }))),

    h("h3", {}, "Ultimi movimenti"),
    avvisoMovimenti,
    ultimi.length ? h("ul", { class: "voci" }, ultimi.map((u) =>
      h("li", { class: "voce" }, h("span", {}, giorno(u.t) + " — " + u.cosa),
        h("span", { class: "dose" }, h("strong", {}, qta(u.q) + " " + p.udm),
          // Un movimento sbagliato si annulla (resta scritto chi e quando), non si cancella.
          u.id ? conConferma("Annulla", "Sì, annulla", async () => {
            try { await ctx.dati.annullaMovimento(u.id); ridisegna(); } catch (e) { avvisoMovimenti.textContent = e.message; }
          }) : null))))
      : h("p", { class: "nota" }, "Nessun conteggio e nessun arrivo registrato."),
    h("p", {}, h("a", { href: "#/articoli/" + id }, "Apri la scheda dell'articolo (nome, confezione, ricette che lo usano)")));
}

// ---------- Spesa ----------
// Il foglio che sale dal basso: «a quale fornitore lo sposto?». Si cerca scrivendo, come dappertutto.
function chiediFornitore(titolo, fornitori, escluso, alScelto) {
  const chiudi = () => velo.remove();
  const cerca = h("input", { type: "search", placeholder: "Scrivi il nome del fornitore", "aria-label": "Cerca il fornitore", autocomplete: "off" });
  const lista = h("ul", { class: "lista risultati" });
  const candidati = fornitori.filter((f) => f.nome !== escluso);
  const disegna = () => {
    const trovati = filtra(candidati, cerca.value, "");
    lista.replaceChildren(...trovati.map((f) => h("li", {}, h("button", { type: "button", class: "riga", onclick: () => { chiudi(); alScelto(f.nome); } },
      h("strong", {}, "🚚 " + f.nome)))));
    if (!trovati.length) lista.append(h("li", { class: "nota" }, "Nessun fornitore così."));
  };
  cerca.addEventListener("input", disegna);
  disegna();
  const velo = h("div", { class: "velo", onclick: (ev) => { if (ev.target === velo) chiudi(); } },
    h("div", { class: "foglio", role: "dialog", "aria-label": titolo },
      h("div", { class: "testata" }, h("h3", {}, titolo), h("button", { type: "button", onclick: chiudi }, "Annulla")),
      candidati.length > 6 ? cerca : null, lista));
  document.body.append(velo);
}

export async function spesa(ctx, ridisegna) {
  const c = await conti(ctx);
  const sp = motore.spesa(c);
  const mossi = spostamenti.leggi(ctx.ristorante.id);
  const righe = spostamenti.applica(sp.righe, mossi).map((r) => Object.assign({}, r, { fornitoreSpesa: r.fornitore || spostamenti.SENZA }));
  const quantiFornitori = new Set(righe.map((r) => r.fornitoreSpesa)).size;
  const quantiSpostati = righe.filter((r) => r.spostatoDa).length;
  const tuttiFornitori = Array.from(c.fornitori.values()).filter((f) => f.attivo !== false).sort((x, y) => x.nome.localeCompare(y.nome, "it"));
  const dopo = () => { scordaBozza(); (ridisegna || (() => location.reload()))(); };
  const spostaRighe = (lista, da) => chiediFornitore(lista.length === 1 ? "Sposta «" + lista[0].nome + "» a…" : "Sposta tutto " + da + " (" + lista.length + " articoli) a…",
    tuttiFornitori, da, (a) => { spostamenti.sposta(ctx.ristorante.id, lista, a); dopo(); });
  const rimettiRighe = (lista) => { spostamenti.rimetti(ctx.ristorante.id, lista); dopo(); };
  const quanto = (r) => (r.colli != null
    ? r.colli + (r.colli === 1 ? " confezione" : " confezioni") + " da " + qta(r.qtaConfezione) + " " + r.udm
    : qta(r.quantita) + " " + r.udm);
  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "Spesa"), h("a", { class: "pulsante", href: "#/ordini" }, "Ordini inviati")),
    h("div", { class: "filtri" },
      h("a", { class: "pulsante filtro attivo", href: "#/spesa" }, "Per fornitore (ordino)"),
      h("a", { class: "pulsante filtro", href: "#/spesa/unica" }, "Lista unica (vado io)")),
    aggiornamento(c),
    h("p", { class: "nota" }, "Quanto serve per i prossimi " + c.opz.giorniCopertura + " giorni, in base alle vendite degli ultimi "
      + c.opz.giorniStorico + ", alle ricette e allo sfrido, tolto quello che c'è in magazzino."),
    h("div", { class: "riquadri" },
      riquadro(String(sp.righe.length), "articoli da ordinare"),
      riquadro(euro(sp.totale) + (sp.parziale ? " +" : ""), "spesa prevista"),
      riquadro(String(quantiFornitori), "fornitori")),
    sp.righe.length ? h("p", { class: "nota" }, "Per passare un articolo a un altro fornitore strisciaci sopra verso destra (o tocca ⇄). Strisciando sul fornitore sposti tutta la sua lista. Vale per questa spesa: finisce quando salvi l'ordine.") : null,
    quantiSpostati ? h("p", { class: "nota avviso" }, "↪ " + (quantiSpostati === 1 ? "1 articolo spostato" : quantiSpostati + " articoli spostati") + " da te a un altro fornitore.  ",
      conConferma("Rimetti tutto com'era", "Sì, annulla gli spostamenti", () => rimettiRighe(righe.filter((r) => r.spostatoDa)), "leggero")) : null,
    sp.righe.length ? reparti({
      voci: righe,
      gruppoDi: (r) => r.fornitoreSpesa, icona: "🚚", memoria: "spesa", unita: ["articolo", "articoli"],
      // In cima a ogni fornitore: da qui si prepara il suo ordine con queste quantità, o si passa tutto a un altro.
      testa: (nome, voci) => {
        const f = Array.from(c.fornitori.values()).find((x) => x.nome === nome);
        return h("p", { class: "testa-reparto" },
          f ? h("a", { class: "pulsante primario", href: "#/ordine-nuovo/" + f.id }, "Prepara l'ordine a " + nome) : null,
          h("button", { type: "button", onclick: () => spostaRighe(voci, nome) }, "⇄ Sposta tutto a un altro fornitore"));
      },
      ordinaGruppi: (x, y) => x.nome.localeCompare(y.nome, "it"),
      alGruppo: (el, nome, voci) => spostamenti.strisciabile(el, () => spostaRighe(voci, nome)),
      classeGruppo: (voci) => (voci.some((r) => r.spostatoDa) ? "con-spostati" : ""),
      valore: (voci) => euro(voci.reduce((s, r) => s + (r.costo || 0), 0)) + (voci.some((r) => r.costo == null) ? " +" : "")
        + (voci.some((r) => r.spostatoDa) ? " · ↪ " + voci.filter((r) => r.spostatoDa).length + " spostati qui" : ""),
      allarme: (r) => r.costo == null, etichettaAllarme: (n) => n + " senza prezzo",
      cerca: "Cerca un articolo da ordinare",
      riga: (r) => spostamenti.strisciabile(h("li", { class: r.spostatoDa ? "spostato" : "" }, h("a", { class: "riga tipo-articolo", href: "#/magazzino/" + r.id },
        h("strong", {}, r.nome),
        h("span", { class: "numero" }, quanto(r)),
        r.spostatoDa ? h("span", { class: "bollo da_completare" }, "↪ spostato da " + r.spostatoDa) : null,
        h("span", { class: "nota" }, [
          r.costo == null ? "senza prezzo" : euro(r.costo),
          "in magazzino " + qta(Math.max(0, r.giacenza)) + " " + r.udm,
          "servono " + qta(r.fabbisogno) + " " + r.udm,
        ].join(" · ")),
        r.avviso ? h("span", { class: "nota avviso" }, r.avviso) : null),
        h("span", { class: "dose sotto-riga" },
          h("button", { type: "button", class: "leggero", onclick: () => spostaRighe([r], r.fornitoreSpesa) }, "⇄ Sposta"),
          r.spostatoDa ? h("button", { type: "button", class: "leggero", onclick: () => rimettiRighe([r]) }, "↩ Rimetti a " + r.spostatoDa) : null)),
        () => spostaRighe([r], r.fornitoreSpesa)) })
      : vuoto("Niente da ordinare: quello che c'è in magazzino copre i prossimi giorni."));
}

// ---------- Spesa, lista unica: per quando la spesa si va a farla di persona ----------
// Tutto ciò che serve, di qualunque fornitore, in una lista sola divisa per reparto (come le corsie),
// con la spunta per ciò che si è già messo nel carrello. Le spunte restano sul telefono finché non si ricomincia.
export async function spesaUnica(ctx, ridisegna) {
  const c = await conti(ctx);
  const sp = motore.spesa(c);
  const chiave = "erp.spesa.presi." + ctx.ristorante.id;
  let presi = new Set();
  try { presi = new Set(JSON.parse(localStorage.getItem(chiave) || "[]")); } catch (e) { presi = new Set(); }
  const ricorda = () => { try { localStorage.setItem(chiave, JSON.stringify(Array.from(presi))); } catch (e) { /* le spunte valgono finché la pagina è aperta */ } };
  // Una spunta rimasta su un articolo che non serve più non conta.
  const servono = new Set(sp.righe.map((r) => r.id));
  presi.forEach((id) => { if (!servono.has(id)) presi.delete(id); });
  const quanto = (r) => (r.colli != null
    ? r.colli + (r.colli === 1 ? " confezione" : " confezioni") + " da " + qta(r.qtaConfezione) + " " + r.udm
    : qta(r.quantita) + " " + r.udm);
  const quantiPresi = h("strong", {}, String(presi.size));
  const contaReparto = (voci) => voci.filter((r) => presi.has(r.id)).length + " di " + voci.length + " presi";
  // A spesa finita: ciò che è spuntato diventa «comprato da…», e da lì si aspetta la fattura per il confronto.
  const fornitori = Array.from(c.fornitori.values()).filter((f) => f.attivo !== false).sort((x, y) => x.nome.localeCompare(y.nome, "it"));
  const metro = fornitori.find((f) => f.nome.toLowerCase().startsWith("metro"));
  const dove = scelta("dove", fornitori.map((f) => [f.id, f.nome]), metro ? metro.id : (fornitori[0] || {}).id);
  const erroreFine = h("p", { class: "errore", role: "alert" });
  const fine = h("div", { class: "scheda-confronto fine-spesa" });
  function disegnaFine() {
    const n = presi.size;
    fine.hidden = !n || !ctx.titolare || !fornitori.length;
    if (fine.hidden) return;
    const tasto = h("button", { type: "button", class: "primario", onclick: async () => {
      erroreFine.textContent = "";
      tasto.disabled = true;
      try {
        const f = fornitori.find((x) => x.id === dove.value);
        const comprate = sp.righe.filter((r) => presi.has(r.id)).map((r) => ({ articolo_id: r.id, nome: r.nome, udm: r.udm,
          quantita: r.colli != null ? r.colli * r.qtaConfezione : r.quantita, colli: r.colli, qtaConfezione: r.colli != null ? r.qtaConfezione : null }));
        const o = await ctx.dati.creaOrdine(f, comprate, "", { diPersona: true });
        presi.clear(); ricorda();
        location.hash = "#/ordini/" + o.id;
      } catch (e) { erroreFine.textContent = e.message || "Non sono riuscito a registrare la spesa."; tasto.disabled = false; }
    } }, "Spesa fatta: aspetto la fattura (" + n + (n === 1 ? " articolo)" : " articoli)"));
    fine.replaceChildren(h("h3", {}, "Hai finito la spesa?"),
      h("p", { class: "nota" }, "Dimmi dove l'hai fatta: aspetterò la fattura di quel fornitore e, quando la carichi, la confronto con quello che hai spuntato. La merce entra in magazzino con la fattura, non adesso."),
      h("label", { class: "campo" }, h("span", { class: "etichetta" }, "Dove hai comprato"), dove),
      erroreFine, h("div", { class: "azioni" }, tasto));
  }

  const riga = (r) => {
    const spunta = h("input", { type: "checkbox", checked: presi.has(r.id), "aria-label": "Preso: " + r.nome });
    const li = h("li", {}, h("label", { class: "riga tipo-articolo riga-spesa" + (presi.has(r.id) ? " presa" : "") },
      spunta, h("strong", {}, r.nome), h("span", { class: "numero" }, quanto(r)),
      h("span", { class: "nota" }, [r.fornitore ? "di solito da " + r.fornitore : "nessun fornitore abituale", r.costo == null ? null : "circa " + euro(r.costo)].filter(Boolean).join(" · "))));
    spunta.addEventListener("change", () => {
      if (spunta.checked) presi.add(r.id); else presi.delete(r.id);
      ricorda();
      li.firstChild.classList.toggle("presa", spunta.checked);
      quantiPresi.textContent = String(presi.size);
      disegnaFine();
      // La riga presa scende in fondo al suo reparto; se la si rimette, torna su fra quelle da prendere.
      const elenco = li.parentNode;
      const primaPresa = Array.from(elenco.children).find((x) => x !== li && x.querySelector("input:checked"));
      if (spunta.checked || !primaPresa) elenco.append(li); else elenco.insertBefore(li, primaPresa);
      if (!spunta.checked) { // fra quelle da prendere, al suo posto in ordine di nome
        const dopo = Array.from(elenco.children).find((x) => x !== li && !x.querySelector("input:checked")
          && x.querySelector("strong").textContent.localeCompare(r.nome, "it") > 0);
        if (dopo) elenco.insertBefore(li, dopo);
      }
      const reparto = li.closest("details");
      if (!reparto) return;
      const fatte = reparto.querySelectorAll("input:checked").length, tutte = reparto.querySelectorAll("input[type=checkbox]").length;
      const conto = reparto.querySelector("summary .numero");
      if (conto) conto.textContent = fatte + " di " + tutte + " presi";
      // Un reparto finito scende in fondo, sotto quelli dove c'è ancora da prendere.
      // Si sposta SOLO quando cambia stato: finché manca qualcosa il reparto resta dov'è.
      const eraFinito = reparto.classList.contains("finito");
      if (eraFinito === (fatte === tutte)) return;
      reparto.classList.toggle("finito", fatte === tutte);
      const tendine = reparto.parentNode;
      if (fatte === tutte) tendine.append(reparto);
      else {
        const primoFinito = Array.from(tendine.children).find((x) => x !== reparto && x.classList.contains("finito"));
        if (primoFinito) tendine.insertBefore(reparto, primoFinito);
      }
    });
    return li;
  };
  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "Spesa")),
    h("div", { class: "filtri" },
      h("a", { class: "pulsante filtro", href: "#/spesa" }, "Per fornitore (ordino)"),
      h("a", { class: "pulsante filtro attivo", href: "#/spesa/unica" }, "Lista unica (vado io)")),
    h("p", { class: "nota" }, "Tutto quello che serve, di qualunque fornitore, diviso per reparto. Spunta ciò che metti nel carrello: le spunte restano anche se chiudi l'app."),
    h("div", { class: "riquadri" },
      riquadro(String(sp.righe.length), "articoli da comprare"),
      h("div", { class: "riquadro" }, quantiPresi, h("span", {}, "già presi")),
      riquadro(euro(sp.totale) + (sp.parziale ? " +" : ""), "spesa prevista")),
    sp.righe.length ? reparti({ voci: sp.righe, riga: riga, memoria: "spesa-unica", unita: ["articolo", "articoli"],
      valore: contaReparto, filtri: [["mancano", "Solo quelli ancora da prendere", (r) => !presi.has(r.id)]],
      // Ciò che è già preso sta in fondo: prima le righe da prendere, e prima i reparti dove manca ancora qualcosa.
      ordina: (x, y) => presi.has(x.id) - presi.has(y.id) || x.nome.localeCompare(y.nome, "it"),
      classeGruppo: (voci) => (voci.every((r) => presi.has(r.id)) ? "finito" : ""),
      ordinaGruppi: (x, y) => x.voci.every((r) => presi.has(r.id)) - y.voci.every((r) => presi.has(r.id)),
      cerca: "Cerca un articolo nella lista" })
      : vuoto("Niente da comprare: quello che c'è in magazzino copre i prossimi giorni."),
    (disegnaFine(), fine),
    presi.size ? h("div", { class: "azioni" }, conConferma("Togli tutte le spunte", "Sì, ricomincia da capo", () => { presi.clear(); ricorda(); ridisegna(); })) : null);
}

// ---------- Costi: food cost e allerta prezzi ----------
export async function costi(ctx) {
  const c = await conti(ctx);
  const fc = motore.foodCost(c);
  const allerte = motore.allertePrezzi(c);
  // Prima i piatti che costano di più rispetto a quello che incassano.
  const peso = (p) => (p.fcIncasso != null ? p.fcIncasso : (p.fcListino != null ? p.fcListino : -1));
  const riga = (p) => h("li", {}, h("a", { class: "riga tipo-piatto", href: "#/piatti/" + p.id },
    h("strong", {}, p.nome),
    h("span", { class: "numero" + (p.fcIncasso != null && p.fcIncasso > 0.35 ? " rosso" : "") },
      p.fcIncasso != null ? pct(p.fcIncasso) : (p.fcListino != null ? pct(p.fcListino) + " (listino)" : "—")),
    h("span", { class: "nota" }, [
      "costo " + euro(p.costoReale),
      p.incasso != null ? "incassi in media " + euro(p.incasso) : (p.listino ? "listino " + euro(p.listino) : "senza prezzo"),
      p.margine != null ? "margine " + euro(p.margine) : null,
      p.venduti ? qta(p.venduti) + " venduti" : "mai venduto",
    ].filter(Boolean).join(" · ")),
    p.mancanoPrezzi.length ? h("span", { class: "nota avviso" }, "Costo incompleto, manca il prezzo di: " + p.mancanoPrezzi.join(", ")) : null));
  return h("section", { class: "tipo-piatto" },
    h("div", { class: "testata" }, h("h2", {}, "Costi e margini")),
    aggiornamento(c),
    h("div", { class: "riquadri" },
      riquadro(pct(fc.totale.fc), "food cost sull'incassato"),
      riquadro(euro(fc.totale.ricavo), "incassato dai piatti"),
      riquadro(euro(fc.totale.ricavo - fc.totale.costo), "margine sulla merce"),
      fc.incassoSenzaMerce > 0 ? riquadro(euro(fc.incassoSenzaMerce), "incassi senza merce (coperto e simili), fuori dal food cost") : null),

    h("h3", {}, "Prezzi aumentati", h("span", { class: "nota" }, " — fra le ultime due fatture dello stesso fornitore")),
    allerte.length ? h("ul", { class: "lista" }, allerte.map((a) =>
      h("li", {}, h("a", { class: "riga tipo-articolo allarme", href: "#/magazzino/" + a.id },
        h("strong", {}, a.nome), h("span", { class: "numero rosso" }, "+" + pct(a.delta)),
        h("span", { class: "nota" }, a.fornitore + " · da " + euro(a.prima) + " a " + euro(a.dopo) + " al " + a.udm
          + " · " + giorno(Date.parse(a.dataPrima)) + " → " + giorno(Date.parse(a.dataDopo)))))))
      : h("p", { class: "nota" }, "Nessun aumento sopra il " + pct(c.opz.sogliaAllerta) + "."),

    h("h3", {}, "Per categoria"),
    h("ul", { class: "voci" }, fc.categorie.map((k) =>
      h("li", { class: "voce" }, h("span", {}, k.categoria + " (" + k.piatti + ")"),
        h("strong", {}, k.fc == null ? "—" : pct(k.fc) + " · " + euro(k.ricavo))))),

    h("h3", {}, "Per piatto", h("span", { class: "nota" }, " — dal food cost più alto")),
    reparti({ voci: fc.piatti, riga: riga, memoria: "costi", unita: ["piatto", "piatti"], ordina: (x, y) => peso(y) - peso(x),
      allarme: (p) => p.fcIncasso != null && p.fcIncasso > 0.35, etichettaAllarme: (n) => n + " sopra il 35%",
      cerca: "Cerca un piatto in tutti i reparti" }));
}
