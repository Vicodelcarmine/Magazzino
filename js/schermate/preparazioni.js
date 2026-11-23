// Preparazioni fatte in cucina (impasto, sugo, salse): articoli con una ricetta loro,
// che poi si usano come ingredienti nei piatti o in altre preparazioni.
import { h, campo, modulo, scelta, spunta, suggerimenti, vuoto } from "../dom.js";
import { qta, perCampo } from "../numeri.js";
import { categorie } from "../codici.js";
import { righeAperte, vietatiPer } from "../convalida.js";
import { distinta } from "./distinta.js";
import { usatoIn } from "./rivendita.js";
import { codice as segnoCodice, categoria as segnoCategoria } from "./segni.js";

const UNITA = [["kg", "chili (kg)"], ["L", "litri (L)"], ["pz", "pezzi (pz)"]];

function lotto(p) { return Number(p.lotto_abituale) > 0 ? Number(p.lotto_abituale) : 1; }

export async function elenco(ctx) {
  const preparazioni = (await ctx.dati.articoli()).filter((a) => a.prodotto_in_cucina);
  return h("section", { class: "tipo-preparazione" },
    h("div", { class: "testata" },
      h("h2", {}, "Preparazioni di cucina"),
      ctx.titolare ? h("a", { class: "pulsante primario", href: "#/preparazioni/nuovo" }, "＋ Nuova") : null),
    preparazioni.length ? h("ul", { class: "lista" }, preparazioni.map((p) =>
      h("li", {}, h("a", { class: "riga tipo-preparazione" + (p.attivo ? "" : " spento"), href: "#/preparazioni/" + p.id },
        h("strong", {}, p.nome),
        segnoCategoria("preparazione", p.categoria),
        h("span", { class: "nota" }, [
          "di solito " + qta(lotto(p)) + " " + p.udm, p.attivo ? null : "non attiva"].filter(Boolean).join(" · "))))))
      : vuoto("Nessuna preparazione. Sono le cose fatte in cucina che entrano in più piatti: impasto, sugo, salse."));
}

// Il codice non è fra i campi: lo assegna il sistema quando la preparazione nasce.
function campi(p, articoli) {
  return [
    campo("Nome", h("input", { name: "nome", value: p.nome || "", required: true, autocomplete: "off" })),
    campo("Categoria", h("input", {
      name: "categoria", value: p.categoria || "", list: "categorie-preparazioni", autocomplete: "off",
    }), "Per esempio Impasti, Salse, Basi."),
    suggerimenti("categorie-preparazioni", categorie(articoli.filter((a) => a.prodotto_in_cucina))),
    campo("Unità di misura", scelta("udm", UNITA, p.udm || "kg"),
      "È l'unità in cui la conti. Nelle ricette potrai scrivere anche grammi e centilitri."),
    campo("Quanta ne prepari di solito", h("input", {
      name: "lotto_abituale", inputmode: "decimal", value: perCampo(p.id ? lotto(p) : ""), autocomplete: "off",
    }), "Per esempio 16 se ogni volta fai 16 kg di impasto. La ricetta la scrivi per questa quantità."),
    p.id ? spunta("attivo", "Preparazione attiva", p.attivo !== false) : null,
  ];
}

export async function scheda(ctx, id, ridisegna) {
  const [articoli, piatti] = await Promise.all([ctx.dati.articoli(), ctx.dati.piatti()]);
  if (id === "nuovo") {
    return h("section", { class: "tipo-preparazione" },
      h("h2", {}, "Nuova preparazione"),
      modulo(campi({}, articoli), "Crea e passa alla ricetta", async (d) => {
        const p = await ctx.dati.salvaPreparazione(d);
        location.hash = "#/preparazioni/" + p.id;
      }));
  }
  const p = articoli.find((x) => x.id === id && x.prodotto_in_cucina);
  if (!p) return vuoto("Preparazione non trovata.");
  const [tutte, altre] = await Promise.all([
    ctx.dati.righeDi({ preparazione_id: id }), ctx.dati.righePreparazioni(),
  ]);
  const righe = righeAperte(tutte);
  const dose = qta(lotto(p)) + " " + p.udm;

  return h("section", { class: "tipo-preparazione" },
    h("div", { class: "testata" },
      h("h2", {}, p.nome, " ", segnoCodice("preparazione", p.codice), " ", segnoCategoria("preparazione", p.categoria)),
      p.attivo ? null : h("span", { class: "bollo" }, "non attiva")),

    h("h3", {}, "Ricetta", h("span", { class: "nota" }, " — cosa serve per farne " + dose)),
    distinta(ctx, {
      righe: righe, articoli: articoli, chiave: { preparazione_id: id }, scala: lotto(p),
      perCosa: dose + " di " + p.nome,
      // Non può contenere se stessa, né una preparazione che la contiene già.
      vietati: vietatiPer(id, altre),
      modificabile: ctx.titolare, ridisegna: ridisegna,
    }),

    await usatoIn(ctx, p, piatti, articoli),

    ctx.titolare ? h("details", {},
      h("summary", {}, "Nome, unità e dose abituale"),
      modulo(campi(p, articoli), "Salva", async (d) => {
        await ctx.dati.salvaPreparazione(Object.assign({ id: p.id }, d));
        ridisegna();
      }),
      h("p", { class: "nota" }, "Cambiare la dose abituale cambia solo come vedi la ricetta: le proporzioni restano le stesse.")) : null);
}
