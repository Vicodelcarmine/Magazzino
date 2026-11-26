// Un elenco lungo diviso in reparti, per non avere pagine infinite.
//
// Si apre con i reparti come riquadri con l'icona. Toccandone uno si entra: lo si trova aperto e
// gli altri restano lì come tendine, così si passa da un reparto all'altro senza uscire.
// Una sola tendina aperta alla volta. La ricerca in alto cerca in tutti i reparti insieme.
// Scelto dal titolare il 25/11 fra due prove; vale per ogni pagina con un elenco lungo.
import { h, vuoto } from "../dom.js";
import { filtra, categorieCon } from "../cerca.js";

const ICONE = [["carne", "🥩"], ["pesce", "🐟"], ["latticin", "🧀"], ["formagg", "🧀"], ["salum", "🥓"], ["verdur", "🥬"], ["frutta", "🥬"],
  ["insalat", "🥗"], ["contorn", "🥗"], ["pizz", "🍕"], ["prim", "🍝"], ["second", "🍖"], ["antipast", "🍤"],
  ["farin", "🌾"], ["past", "🌾"], ["dolc", "🍰"], ["dessert", "🍰"], ["barattol", "🥫"], ["sals", "🥫"], ["oli", "🫒"], ["spezi", "🌿"], ["uov", "🥚"],
  ["soft", "🥤"], ["analcolic", "🥤"], ["bevand", "🥤"], ["spirit", "🍸"], ["alcolic", "🍷"], ["vin", "🍷"], ["birr", "🍺"], ["caff", "☕"], ["coff", "☕"],
  ["non food", "🧴"], ["material", "🧴"], ["preparazion", "🍲"], ["impast", "🍲"]];
export function iconaDi(nome, predefinita) {
  // Si guarda l'INIZIO delle parole: «oli» è Oli, non alcOLIci.
  const n = String(nome || "").toLowerCase();
  const parole = n.split(/[^a-zà-ú]+/);
  const t = ICONE.find((x) => (x[0].includes(" ") ? n.includes(x[0]) : parole.some((w) => w.startsWith(x[0]))));
  return t ? t[1] : (predefinita || "📦");
}

// Il reparto lasciato aperto in ogni pagina: tornando indietro da una scheda lo si ritrova.
const ricordo = new Map();

// opz:
//  voci      le righe dell'elenco (hanno almeno nome; categoria se i reparti sono le categorie)
//  riga      (voce) → l'elemento <li> da mostrare
//  memoria   un nome per ricordare il reparto aperto in questa pagina
//  unita     ["articolo", "articoli"]: come si contano le voci
//  gruppoDi  (facoltativo) (voce) → nome del reparto, quando i reparti NON sono le categorie (es. i fornitori)
//  icona     (facoltativo) icona fissa per tutti i reparti (es. il camion per i fornitori)
//  allarme   (facoltativo) (voce) → vero se la voce ha un problema; etichettaAllarme: (n) → "3 sotto zero"
//  valore    (facoltativo) (voci del reparto) → testo da mostrare sul reparto (es. il totale in euro)
//  filtri    (facoltativo) [[chiave, testo del tasto, (voce) → vero se resta]]
//  ordina    (facoltativo) (a, b) → ordine delle voci dentro un reparto e nella ricerca
//  testa     (facoltativo) (nome del reparto, voci) → qualcosa da mettere in cima al reparto aperto (es. un tasto)
//  ordinaGruppi (facoltativo) (a, b) → ordine dei reparti (a.voci sono le voci del reparto)
//  classeGruppo (facoltativo) (voci del reparto) → classe in più sul reparto (es. «finito»)
//  alGruppo  (facoltativo) (elemento, nome del reparto, voci) → per agganciare qualcosa al reparto (es. lo striscio)
//  cerca     testo del riquadro di ricerca
//  vuoto     testo quando non c'è niente
export function reparti(opz) {
  const unita = opz.unita || ["voce", "voci"];
  let aperto = ricordo.get(opz.memoria) || "", testo = "", solo = "";
  const corpo = h("div", {});
  const quanti = (n) => n + " " + (n === 1 ? unita[0] : unita[1]);
  const inOrdine = (lista) => (opz.ordina ? lista.slice().sort(opz.ordina) : lista);
  const scegli = (chiave) => { aperto = chiave; ricordo.set(opz.memoria, chiave); };

  function gruppi() {
    const filtro = (opz.filtri || []).find((f) => f[0] === solo);
    const voci = filtro ? opz.voci.filter(filtro[2]) : opz.voci;
    let out;
    if (opz.gruppoDi) {
      const m = new Map();
      voci.forEach((v) => { const n = opz.gruppoDi(v) || "Altro"; if (!m.has(n)) m.set(n, []); m.get(n).push(v); });
      out = Array.from(m.entries()).map(([nome, lista]) => ({ chiave: nome, nome: nome, voci: lista }));
    } else {
      out = categorieCon(voci).map((r) => ({ chiave: r.chiave, nome: r.nome, voci: filtra(voci, "", r.chiave) }));
    }
    out.forEach((g) => {
      g.voci = inOrdine(g.voci);
      g.allarmi = opz.allarme ? g.voci.filter(opz.allarme).length : 0;
      g.icona = opz.icona || iconaDi(g.nome);
    });
    if (opz.ordinaGruppi) out.sort(opz.ordinaGruppi);
    return { voci: voci, gruppi: out };
  }
  const segni = (g) => [
    h("span", { class: "nota" }, quanti(g.voci.length)),
    opz.valore ? h("span", { class: "numero" }, opz.valore(g.voci)) : null,
    g.allarmi ? h("span", { class: "bollo rifiutato" }, opz.etichettaAllarme ? opz.etichettaAllarme(g.allarmi) : String(g.allarmi)) : null];

  function disegna() {
    const stato = gruppi();
    if (testo.trim()) { // scrivendo si cerca in tutti i reparti insieme
      const trovati = inOrdine(filtra(stato.voci, testo, ""));
      corpo.replaceChildren(trovati.length ? h("ul", { class: "lista" }, trovati.map(opz.riga)) : vuoto("Niente che cominci così."));
      return;
    }
    if (!stato.gruppi.length) { corpo.replaceChildren(vuoto(opz.voci.length ? "Niente con questo filtro." : (opz.vuoto || "Ancora niente."))); return; }
    // Con un solo reparto non serve sceglierlo: lo si mostra aperto.
    if (stato.gruppi.length === 1) { corpo.replaceChildren(h("ul", { class: "lista" }, stato.gruppi[0].voci.map(opz.riga))); return; }
    // "" = si vedono le icone; "-" = si è dentro, con tutte le tendine chiuse.
    if (aperto !== "-" && !stato.gruppi.some((g) => g.chiave === aperto)) {
      corpo.replaceChildren(h("div", { class: "griglia-reparti" }, stato.gruppi.map((g) => {
        const b = h("button", { type: "button", class: "reparto-icona" + (g.allarmi ? " allarme" : "") + (opz.classeGruppo ? " " + opz.classeGruppo(g.voci) : ""),
          onclick: () => { scegli(g.chiave); disegna(); corpo.scrollIntoView({ block: "start" }); } },
          h("span", { class: "icona" }, g.icona), h("strong", {}, g.nome), segni(g));
        if (opz.alGruppo) opz.alGruppo(b, g.nome, g.voci);
        return b;
      })));
      return;
    }
    corpo.replaceChildren(
      h("button", { type: "button", class: "leggero", onclick: () => { scegli(""); disegna(); } }, "‹ Tutti i reparti"),
      h("div", { class: "tendine" }, stato.gruppi.map((g) => {
        const d = h("details", { class: "tendina reparto" + (opz.classeGruppo ? " " + opz.classeGruppo(g.voci) : ""), open: aperto === g.chiave },
          h("summary", {}, h("span", { class: "icona" }, g.icona), h("strong", {}, g.nome), segni(g)),
          // Le righe si costruiscono solo per il reparto aperto: la pagina resta leggera.
          aperto === g.chiave && opz.testa ? opz.testa(g.nome, g.voci) : null,
          aperto === g.chiave ? h("ul", { class: "lista" }, g.voci.map(opz.riga)) : null);
        if (opz.alGruppo) opz.alGruppo(d.querySelector("summary"), g.nome, g.voci);
        d.addEventListener("toggle", () => {
          if (d.open && aperto !== g.chiave) { scegli(g.chiave); disegna(); }
          else if (!d.open && aperto === g.chiave) { scegli("-"); disegna(); }
        });
        return d;
      })));
    const ora = corpo.querySelector("details[open]");
    if (ora && ora.getBoundingClientRect().top < 0) ora.scrollIntoView({ block: "start" });
  }

  const tasti = (opz.filtri || []).length ? h("div", { class: "filtri" }, opz.filtri.map((f) =>
    h("button", { type: "button", class: "filtro", onclick: (ev) => {
      solo = solo === f[0] ? "" : f[0];
      ev.target.parentNode.querySelectorAll("button").forEach((b) => b.classList.toggle("attivo", b === ev.target && solo === f[0]));
      disegna();
    } }, f[1]))) : null;
  disegna();
  return h("div", { class: "reparti" }, tasti,
    opz.voci.length > 5 ? h("input", { type: "search", placeholder: opz.cerca || "Cerca in tutti i reparti", "aria-label": opz.cerca || "Cerca",
      oninput: (ev) => { testo = ev.target.value; disegna(); } }) : null,
    corpo);
}
