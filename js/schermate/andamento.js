// Andamento: i grafici per capire come si muove il locale. Pensata per lo schermo grande.
import { h } from "../dom.js";
import { euro, qta } from "../numeri.js";
import * as motore from "../motore.js";
import { nelTempo, classifica } from "../grafici.js";

// Un colore per famiglia, come nel resto dell'app: ciò che si vende, ciò che si compra.
// Stesse tinte, un passo più scure perché nei grafici sono superfici piene: controllate col
// validatore dei colori (luminosità, distinguibilità anche per i daltonici, contrasto sul fondo).
const VENDITA = "#d9704c";
const ACQUISTO = "#4588dc";

const pct = (n) => (n == null ? "—" : new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 }).format(n));
const migliaia = (n) => (Math.abs(n) >= 10000 ? new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(n / 1000) + " mila" : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(n));
const giornoMese = (t) => new Date(t).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });

function scheda(titolo, sotto, contenuto) {
  return h("section", { class: "scheda-grafico" }, h("h3", {}, titolo), sotto ? h("p", { class: "nota" }, sotto) : null, contenuto);
}
function riquadro(numero, cosa) { return h("div", { class: "riquadro" }, h("strong", {}, numero), h("span", {}, cosa)); }

export async function pagina(ctx) {
  const c = motore.prepara(await ctx.dati.perIConti(ctx.ristorante));
  const sett = motore.settimane(c);
  if (!sett.length) {
    return h("section", {}, h("div", { class: "testata" }, h("h2", {}, "Andamento")),
      h("p", { class: "vuoto" }, "Servono vendite e acquisti registrati per disegnare l'andamento."));
  }
  // La settimana in corso è a metà: nei grafici confonderebbe, sembrerebbe un crollo.
  const chiuse = sett.filter((s) => s.inizio + 7 * 86400000 <= c.adesso);
  const serie = chiuse.length ? chiuse : sett;
  const ultime = serie.slice(-4);
  const somma = (campo) => ultime.reduce((t, s) => t + s[campo], 0);
  const ricavo4 = somma("ricavo"), costo4 = somma("costo");
  const sp = motore.sprechi(c);
  const margini = motore.marginiCategoria(c);
  const allerte = motore.allertePrezzi(c);
  const punti = (campo) => serie.map((s) => ({ etichetta: giornoMese(s.inizio),
    titolo: "Settimana del " + giornoMese(s.inizio), valore: campo === "fc" ? s.fc : s[campo] }));

  return h("section", { class: "andamento" },
    h("div", { class: "testata" }, h("h2", {}, "Andamento")),
    h("p", { class: "nota" }, "Settimane intere, da lunedì a domenica. Vendite della cassa aggiornate al "
      + new Date(c.ultimaVendita).toLocaleDateString("it-IT") + "."),
    h("div", { class: "riquadri" },
      riquadro(euro(ricavo4), "incassato dai piatti, ultime " + ultime.length + " settimane"),
      riquadro(pct(ricavo4 > 0 ? costo4 / ricavo4 : null), "food cost, ultime " + ultime.length + " settimane"),
      riquadro(euro(somma("acquisti")), "comprato, ultime " + ultime.length + " settimane"),
      riquadro(euro(sp.totale), "merce oltre la ricetta, ultimi " + sp.giorni + " giorni")),

    h("div", { class: "griglia-grafici" },
      scheda("Incassato dai piatti", "Euro a settimana. Non comprende coperto e menu fissi.",
        nelTempo(punti("ricavo"), { tipo: "colonne", colore: VENDITA, formato: euro, formatoAsse: migliaia,
          titolo: "Incassato dai piatti per settimana", intestazioni: ["Settimana", "Incassato"] })),
      scheda("Food cost", "Costo della merce venduta sul suo incasso, a settimana. Ai prezzi d'acquisto di oggi.",
        nelTempo(punti("fc"), { tipo: "linea", colore: VENDITA, formato: pct, titolo: "Food cost per settimana",
          intestazioni: ["Settimana", "Food cost"] })),
      scheda("Comprato", "Euro di merce arrivata a settimana, dalle fatture registrate.",
        nelTempo(punti("acquisti"), { tipo: "colonne", colore: ACQUISTO, formato: euro, formatoAsse: migliaia,
          titolo: "Acquisti per settimana", intestazioni: ["Settimana", "Comprato"] })),
      scheda("Margine per categoria", "Incassato meno costo della merce, su tutto il periodo.",
        classifica(margini.map((k) => ({ etichetta: k.categoria, valore: k.margine, nota: "food cost " + pct(k.fc) })),
          { colore: VENDITA, formato: euro })),
      scheda("Dove se ne va la merce", "Quanto si consuma oltre la ricetta (sfrido) più quello che è stato buttato, in euro, negli ultimi "
        + sp.giorni + " giorni. I primi dieci.",
        h("div", {},
          classifica(sp.righe.slice(0, 10).map((r) => ({ etichetta: r.nome, valore: r.euro,
            nota: qta(r.quantita) + " " + r.udm + (r.buttato ? ", di cui buttati " + qta(r.buttato) : "") + (r.senzaPrezzo ? " · senza prezzo" : "") })),
            { colore: ACQUISTO, formato: euro, vuoto: "Nessuno sfrido misurato sopra la ricetta." }),
          sp.daControllare.length ? h("p", { class: "nota avviso" }, sp.daControllare.length
            + " articoli hanno uno sfrido impossibile (al limite) e sono fuori dalla classifica: quasi sempre è un conteggio o un'unità sbagliata. "
            + sp.daControllare.map((a) => a.nome).join(", ") + ".") : null)),
      scheda("Prezzi aumentati", "Fra le ultime due fatture dello stesso fornitore.",
        classifica(allerte.slice(0, 10).map((a) => ({ etichetta: a.nome, valore: a.delta,
          nota: a.fornitore + ", da " + euro(a.prima) + " a " + euro(a.dopo) + " al " + a.udm })),
          { colore: ACQUISTO, formato: (v) => "+" + pct(v), vuoto: "Nessun aumento sopra la soglia." }))));
}
