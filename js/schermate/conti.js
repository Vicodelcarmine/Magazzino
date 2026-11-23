// Le pagine dei conti: Magazzino (giacenze), Spesa (cosa ordinare), Costi (food cost e allerta prezzi).
// I numeri non sono salvati da nessuna parte: si ricalcolano ogni volta dal registro dei movimenti.
import { h, campo, modulo, scelta, vuoto, conConferma } from "../dom.js";
import { qta, euro } from "../numeri.js";
import { filtra } from "../cerca.js";
import * as motore from "../motore.js";
import { barraCategorie } from "./scegli.js";
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
  const lista = h("ul", { class: "lista" });
  let testo = "", categoria = "", solo = "";
  function disegna() {
    let visti = filtra(tutti, testo, categoria);
    if (solo === "zero") visti = visti.filter((p) => p.giacenzaNegativa);
    if (solo === "mai") visti = visti.filter((p) => p.contatoIl == null);
    lista.replaceChildren(...visti.map((p) =>
      h("li", {}, h("a", { class: "riga tipo-articolo" + (p.giacenzaNegativa ? " allarme" : ""), href: "#/magazzino/" + p.id },
        h("strong", {}, p.nome),
        h("span", { class: "numero" + (p.giacenzaNegativa ? " rosso" : "") }, qta(p.giacenza) + " " + p.udm),
        h("span", { class: "nota" }, [
          p.giacenzaNegativa ? "sotto zero: va ricontato" : (p.autonomia == null ? null : "basta per " + qta(Math.floor(p.autonomia)) + " giorni"),
          "contato: " + giorno(p.contatoIl),
          sfridoTesto(p),
        ].filter(Boolean).join(" · "))))));
    if (!visti.length) lista.append(h("li", {}, vuoto("Nessun articolo così.")));
  }
  const filtro = (chiave, testoTasto) => h("button", { type: "button", class: "filtro", onclick: (ev) => {
    solo = solo === chiave ? "" : chiave;
    ev.target.parentNode.querySelectorAll("button").forEach((b) => b.classList.toggle("attivo", b === ev.target && solo === chiave));
    disegna();
  } }, testoTasto);
  disegna();
  return h("section", { class: "tipo-articolo" },
    h("div", { class: "testata" }, h("h2", {}, "Magazzino")),
    aggiornamento(c),
    h("div", { class: "riquadri" },
      riquadro(String(tutti.length), "articoli attivi"),
      riquadro(String(sottoZero), "sotto zero", sottoZero ? "rosso" : ""),
      riquadro(String(maiContati), "mai contati", maiContati ? "giallo" : "")),
    h("div", { class: "filtri" }, filtro("zero", "Solo sotto zero"), filtro("mai", "Solo mai contati")),
    barraCategorie(tutti, (k) => { categoria = k; disegna(); }),
    h("input", { type: "search", placeholder: "Cerca per nome", "aria-label": "Cerca articolo",
      oninput: (ev) => { testo = ev.target.value; disegna(); } }),
    lista);
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
export async function spesa(ctx) {
  const c = await conti(ctx);
  const sp = motore.spesa(c);
  const quanto = (r) => (r.colli != null
    ? r.colli + (r.colli === 1 ? " confezione" : " confezioni") + " da " + qta(r.qtaConfezione) + " " + r.udm
    : qta(r.quantita) + " " + r.udm);
  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "Spesa")),
    aggiornamento(c),
    h("p", { class: "nota" }, "Quanto serve per i prossimi " + c.opz.giorniCopertura + " giorni, in base alle vendite degli ultimi "
      + c.opz.giorniStorico + ", alle ricette e allo sfrido, tolto quello che c'è in magazzino."),
    h("div", { class: "riquadri" },
      riquadro(String(sp.righe.length), "articoli da ordinare"),
      riquadro(euro(sp.totale) + (sp.parziale ? " +" : ""), "spesa prevista"),
      riquadro(String(sp.gruppi.length), "fornitori")),
    sp.gruppi.length ? sp.gruppi.map((g) => h("div", { class: "gruppo" },
      h("h3", {}, g.fornitore, h("span", { class: "numero" }, euro(g.totale) + (g.parziale ? " + articoli senza prezzo" : ""))),
      h("ul", { class: "lista" }, g.righe.map((r) =>
        h("li", {}, h("a", { class: "riga tipo-articolo", href: "#/magazzino/" + r.id },
          h("strong", {}, r.nome),
          h("span", { class: "numero" }, quanto(r)),
          h("span", { class: "nota" }, [
            r.costo == null ? "senza prezzo" : euro(r.costo),
            "in magazzino " + qta(Math.max(0, r.giacenza)) + " " + r.udm,
            "servono " + qta(r.fabbisogno) + " " + r.udm,
          ].join(" · ")),
          r.avviso ? h("span", { class: "nota avviso" }, r.avviso) : null))))))
      : vuoto("Niente da ordinare: quello che c'è in magazzino copre i prossimi giorni."));
}

// ---------- Costi: food cost e allerta prezzi ----------
export async function costi(ctx) {
  const c = await conti(ctx);
  const fc = motore.foodCost(c);
  const allerte = motore.allertePrezzi(c);
  const lista = h("ul", { class: "lista" });
  let testo = "", categoria = "";
  function disegna() {
    // Prima i piatti che costano di più rispetto a quello che incassano.
    const peso = (p) => (p.fcIncasso != null ? p.fcIncasso : (p.fcListino != null ? p.fcListino : -1));
    const visti = filtra(fc.piatti, testo, categoria).sort((a, b) => peso(b) - peso(a));
    lista.replaceChildren(...visti.map((p) =>
      h("li", {}, h("a", { class: "riga tipo-piatto", href: "#/piatti/" + p.id },
        h("strong", {}, p.nome),
        h("span", { class: "numero" + (p.fcIncasso != null && p.fcIncasso > 0.35 ? " rosso" : "") },
          p.fcIncasso != null ? pct(p.fcIncasso) : (p.fcListino != null ? pct(p.fcListino) + " (listino)" : "—")),
        h("span", { class: "nota" }, [
          "costo " + euro(p.costoReale),
          p.incasso != null ? "incassi in media " + euro(p.incasso) : (p.listino ? "listino " + euro(p.listino) : "senza prezzo"),
          p.margine != null ? "margine " + euro(p.margine) : null,
          p.venduti ? qta(p.venduti) + " venduti" : "mai venduto",
        ].filter(Boolean).join(" · ")),
        p.mancanoPrezzi.length ? h("span", { class: "nota avviso" }, "Costo incompleto, manca il prezzo di: " + p.mancanoPrezzi.join(", ")) : null))));
    if (!visti.length) lista.append(h("li", {}, vuoto("Nessun piatto così.")));
  }
  disegna();
  return h("section", { class: "tipo-piatto" },
    h("div", { class: "testata" }, h("h2", {}, "Costi e margini")),
    aggiornamento(c),
    h("div", { class: "riquadri" },
      riquadro(pct(fc.totale.fc), "food cost sull'incassato"),
      riquadro(euro(fc.totale.ricavo), "incassato dai piatti"),
      riquadro(euro(fc.totale.ricavo - fc.totale.costo), "margine sulla merce")),

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
    barraCategorie(fc.piatti, (k) => { categoria = k; disegna(); }, "piatto"),
    h("input", { type: "search", placeholder: "Cerca per nome", "aria-label": "Cerca piatto",
      oninput: (ev) => { testo = ev.target.value; disegna(); } }),
    lista);
}
