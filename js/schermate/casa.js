// La Home: da qui si va in ogni pagina con un tocco. È la prima cosa che si vede aprendo l'app,
// e ci si torna da ovunque col tasto della casina accanto a «Indietro».
import { h } from "../dom.js";
import * as motore from "../motore.js";
import { inRitardo } from "../ordini.js";

const LAVORO = [
  ["magazzino", "📦", "Magazzino", "quanta merce c'è"],
  ["fatture", "🧾", "Fatture", "la merce che arriva"],
  ["spesa", "🛒", "Spesa", "cosa ordinare"],
  ["ordini", "📝", "Ordini", "inviati, in attesa di fattura"],
  ["cassa", "🧮", "Cassa", "le vendite di ogni sera"],
  ["costi", "💶", "Costi", "food cost e margini"],
  ["andamento", "📈", "Andamento", "grafici e sprechi"],
];
const ANAGRAFICA = [
  ["piatti", "🍽️", "Menu", "i piatti che vendi"],
  ["preparazioni", "🍲", "Preparazioni", "impasti, sughi, salse"],
  ["articoli", "🏷️", "Articoli", "ciò che compri"],
  ["fornitori", "🚚", "Fornitori", "da chi compri"],
];

export async function pagina(ctx) {
  // Qualche numero sui riquadri, per sapere dove guardare prima. Se i conti non riescono, la Home si apre lo stesso.
  const segni = {};
  try {
    const c = motore.prepara(await ctx.dati.perIConti(ctx.ristorante));
    const sottoZero = motore.cruscotto(c).filter((p) => p.attivo && p.giacenzaNegativa).length;
    if (sottoZero) segni.magazzino = ["rifiutato", sottoZero + " sotto zero"];
    const daOrdinare = motore.spesa(c).righe.length;
    if (daOrdinare) segni.spesa = ["da_completare", daOrdinare + " da ordinare"];
    const daCaricare = (await ctx.dati.fatture()).filter((f) => f.stato === "da_caricare").length;
    if (daCaricare) segni.fatture = ["da_completare", daCaricare + " da caricare"];
    const ordini = (await ctx.dati.ordini()).filter((o) => o.stato === "aperto");
    const ritardi = ordini.filter((o) => inRitardo(o, Date.now())).length;
    if (ritardi) segni.ordini = ["rifiutato", ritardi === 1 ? "1 fattura in ritardo" : ritardi + " fatture in ritardo"];
    else if (ordini.length) segni.ordini = ["da_completare", ordini.length + " in attesa"];
    const senzaDistinta = Array.from(c.piatti.values()).filter((p) => p.stato === "da_completare" && !p.senza_merce).length;
    if (senzaDistinta) segni.piatti = ["da_completare", senzaDistinta + " senza distinta"];
  } catch (e) { /* i riquadri restano senza numeri */ }

  const riquadro = (v) => h("a", { class: "reparto-icona pagina-" + v[0] + (segni[v[0]] && segni[v[0]][0] === "rifiutato" && v[0] === "ordini" ? " allarme" : ""), href: "#/" + v[0] },
    h("span", { class: "icona" }, v[1]), h("strong", {}, v[2]), h("span", { class: "nota" }, v[3]),
    segni[v[0]] ? h("span", { class: "bollo " + segni[v[0]][0] }, segni[v[0]][1]) : null);
  return h("section", { class: "casa" },
    h("div", { class: "griglia-reparti" }, LAVORO.map(riquadro)),
    h("h3", {}, "Anagrafica"),
    h("div", { class: "griglia-reparti" }, ANAGRAFICA.map(riquadro)));
}
