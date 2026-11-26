// Ordini ai fornitori: prepararli dalla Spesa, inviarli con WhatsApp o per email, e da lì aspettare la fattura.
import { h, vuoto, conConferma } from "../dom.js";
import { qta, perCampo, parseNumero } from "../numeri.js";
import * as motore from "../motore.js";
import * as regole from "../ordini.js";
import { sceltaArticolo } from "./scegli.js";
import { blocchiConfronto } from "./fatture.js";

const giorno = (d) => (d ? new Date(d).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" }) : "—");
const dataBreve = (d) => { const p = String(d || "").slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] : "—"; };

function bollo(o, adesso) {
  if (o.stato === "annullato") return h("span", { class: "bollo" }, "annullato");
  if (o.stato === "chiuso") return h("span", { class: "bollo attivo" }, o.fattura_id ? "fattura arrivata" : "chiuso");
  if (regole.inRitardo(o, adesso)) return h("span", { class: "bollo rifiutato" }, "fattura in ritardo");
  return h("span", { class: "bollo da_completare" }, o.attesa_entro ? "aspetto la fattura entro " + dataBreve(o.attesa_entro) : "inviato");
}

// ---------- elenco ----------
export async function elenco(ctx) {
  const [ordini, fornitori] = await Promise.all([ctx.dati.ordini(), ctx.dati.fornitori()]);
  const nomi = new Map(fornitori.map((f) => [f.id, f.nome]));
  const adesso = Date.now();
  const riga = (o) => h("li", {}, h("a", { class: "riga" + (regole.inRitardo(o, adesso) ? " allarme" : "") + (o.stato === "aperto" ? "" : " spento"), href: "#/ordini/" + o.id },
    h("strong", {}, nomi.get(o.fornitore_id) || "Fornitore"), bollo(o, adesso),
    h("span", { class: "nota" }, (regole.eDiPersona(o) ? "spesa di persona " : "ordinato ") + giorno(o.inviato_il) + " · " + regole.righeDi(o).length + " articoli")));
  const aperti = ordini.filter((o) => o.stato === "aperto").sort((a, b) => regole.inRitardo(b, adesso) - regole.inRitardo(a, adesso));
  const altri = ordini.filter((o) => o.stato !== "aperto");
  const ritardi = aperti.filter((o) => regole.inRitardo(o, adesso)).length;
  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "Ordini"),
      h("a", { class: "pulsante primario", href: "#/spesa" }, "＋ Nuovo dalla Spesa")),
    h("p", { class: "nota" }, "Quando invii un ordine, il programma aspetta la fattura di quel fornitore. Se non arriva entro il termine, te lo segnala."),
    ritardi ? h("p", { class: "errore" }, ritardi === 1 ? "C'è un ordine la cui fattura non è arrivata nei tempi." : "Ci sono " + ritardi + " ordini la cui fattura non è arrivata nei tempi.") : null,
    h("h3", {}, "In attesa di fattura (" + aperti.length + ")"),
    aperti.length ? h("ul", { class: "lista" }, aperti.map(riga)) : vuoto("Nessun ordine in attesa."),
    altri.length ? h("details", { class: "tendina" }, h("summary", {}, h("strong", {}, "Ordini conclusi"), h("span", { class: "nota" }, String(altri.length))),
      h("ul", { class: "lista" }, altri.map(riga))) : null);
}

// ---------- ordine nuovo, partendo da ciò che la Spesa propone per quel fornitore ----------
let bozza = null; // { fornitoreId, righe, nota }: resta se si esce un attimo dalla pagina
// Quando nella Spesa si sposta qualcosa da un fornitore all'altro, l'ordine va ripreparato da capo.
export function scordaBozza() { bozza = null; }

export async function nuovo(ctx, fornitoreId) {
  const fornitori = await ctx.dati.fornitori();
  const fornitore = fornitori.find((f) => f.id === fornitoreId);
  if (!fornitore) return vuoto("Fornitore non trovato: apri l'ordine dalla pagina Spesa.");
  const articoli = (await ctx.dati.articoli()).filter((a) => a.attivo !== false && !a.prodotto_in_cucina);
  if (!bozza || bozza.fornitoreId !== fornitoreId) {
    const c = motore.prepara(await ctx.dati.perIConti(ctx.ristorante));
    const proposte = motore.spesa(c).righe.filter((r) => r.fornitore === fornitore.nome);
    bozza = { fornitoreId: fornitoreId, nota: "", righe: proposte.map((r) => ({ articolo_id: r.id, nome: r.nome, udm: r.udm,
      qtaConfezione: r.colli != null ? r.qtaConfezione : null, colli: r.colli, quantita: r.quantita, proposta: true, spostato: r.spostato, spostatoDa: r.spostatoDa || "" })) };
  }
  const b = bozza;
  const lista = h("ul", { class: "lista" });
  const errore = h("p", { class: "errore", role: "alert" });
  const conto = h("p", { class: "nota", role: "status" });
  const buone = () => b.righe.filter((r) => Number(r.quantita) > 0);
  const aggiornaConto = () => { conto.textContent = buone().length + (buone().length === 1 ? " articolo nell'ordine" : " articoli nell'ordine"); };

  function rigaOrdine(r) {
    const aConfezioni = r.qtaConfezione > 0;
    const campo = h("input", { class: "stretto", inputmode: "decimal", autocomplete: "off",
      value: perCampo(aConfezioni ? r.colli : r.quantita, 3), "aria-label": "Quanto ordinare di " + r.nome,
      oninput: (ev) => {
        const n = parseNumero(ev.target.value);
        const v = n != null && n > 0 ? n : 0;
        if (aConfezioni) { r.colli = v; r.quantita = v * r.qtaConfezione; } else { r.quantita = v; }
        li.classList.toggle("spento", !(v > 0));
        aggiornaConto();
      } });
    const li = h("li", { class: "riga tipo-articolo" + (Number(r.quantita) > 0 ? "" : " spento") },
      h("strong", {}, r.nome),
      h("span", { class: "dose" }, campo, h("span", {}, aConfezioni ? "confezioni da " + qta(r.qtaConfezione) + " " + r.udm : r.udm)),
      r.spostato ? h("span", { class: "bollo da_completare" }, "↪ spostato qui da te" + (r.spostatoDa ? " (da " + r.spostatoDa + ")" : "")) : null,
      h("span", { class: "nota" }, r.proposta ? "proposto dalla Spesa" : "aggiunto da te", " · metti 0 per non ordinarlo"));
    return li;
  }
  const disegna = () => { lista.replaceChildren(...b.righe.map(rigaOrdine)); aggiornaConto(); };
  disegna();

  const aggiunta = h("div", {});
  const apriAggiunta = h("button", { type: "button", class: "leggero", onclick: () => {
    const liberi = articoli.filter((a) => !b.righe.some((r) => r.articolo_id === a.id));
    aggiunta.replaceChildren(sceltaArticolo(liberi, (a) => {
      if (!a) return;
      const conf = Number(a.qta_confezione) > 0 && !a.acquisto_sfuso ? Number(a.qta_confezione) : null;
      b.righe.push({ articolo_id: a.id, nome: a.nome, udm: a.udm, qtaConfezione: conf, colli: conf ? 1 : null, quantita: conf || 1, proposta: false });
      aggiunta.replaceChildren(apriAggiunta);
      disegna();
    }));
    const cerca = aggiunta.querySelector("input[type=search]");
    if (cerca) cerca.focus();
  } }, "＋ Aggiungi un altro articolo");
  aggiunta.append(apriAggiunta);

  const nota = h("input", { autocomplete: "off", value: b.nota, placeholder: "Per esempio: consegna entro venerdì mattina",
    "aria-label": "Nota per il fornitore", oninput: (ev) => { b.nota = ev.target.value; } });
  const giorni = regole.giorniDi(fornitore);
  const salva = h("button", { type: "button", class: "primario", disabled: !ctx.titolare, onclick: async () => {
    errore.textContent = "";
    salva.disabled = true;
    try {
      const o = await ctx.dati.creaOrdine(fornitore, buone(), b.nota);
      bozza = null;
      location.hash = "#/ordini/" + o.id;
    } catch (e) { errore.textContent = e.message || "L'ordine non è stato salvato."; salva.disabled = false; }
  } }, "Salva l'ordine e passa all'invio");

  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "Ordine a " + fornitore.nome)),
    h("p", { class: "nota" }, giorni > 0
      ? "Dopo l'invio aspetterò la fattura per " + giorni + (giorni === 1 ? " giorno lavorativo" : " giorni lavorativi") + "; se non arriva, te lo segnalo. Il termine si cambia nella scheda del fornitore."
      : "Per questo fornitore non aspetto la fattura (si cambia nella scheda del fornitore)."),
    b.righe.length ? lista : vuoto("La Spesa non propone niente per questo fornitore: aggiungi tu gli articoli."),
    aggiunta,
    h("label", { class: "campo" }, h("span", { class: "etichetta" }, "Nota per il fornitore (facoltativa)"), nota),
    conto, errore,
    ctx.titolare ? null : h("p", { class: "nota avviso" }, "Solo il titolare può salvare un ordine."),
    h("div", { class: "azioni" }, salva,
      conConferma("Lascia perdere", "Sì, butta via questo ordine", () => { bozza = null; location.hash = "#/spesa"; })));
}

// ---------- un ordine salvato: inviarlo, e seguire la fattura ----------
export async function scheda(ctx, id, ridisegna) {
  const [ordini, fornitori] = await Promise.all([ctx.dati.ordini(), ctx.dati.fornitori()]);
  const o = ordini.find((x) => x.id === id);
  if (!o) return vuoto("Ordine non trovato.");
  const fornitore = fornitori.find((f) => f.id === o.fornitore_id);
  const righe = regole.righeDi(o);
  const adesso = Date.now();
  const testo = regole.testoOrdine(ctx.ristorante.nome, righe, o.nota);
  const errore = h("p", { class: "errore", role: "alert" });
  const stato = h("p", { class: "nota", role: "status" });
  const prova = async (azione) => { errore.textContent = ""; try { await azione(); ridisegna(); } catch (e) { errore.textContent = e.message; } };
  const ritardo = regole.inRitardo(o, adesso);
  // Se la fattura è arrivata, il confronto resta qui: cosa mancava, cosa è arrivato in più.
  let confronto = null;
  if (o.fattura_id) {
    const fattura = (await ctx.dati.fatture()).find((f) => f.id === o.fattura_id);
    if (fattura) {
      let entrate = [];
      try { entrate = JSON.parse(fattura.righe || "[]").filter((r) => r.azione === "carica"); } catch (e) { entrate = []; }
      const nomi = new Map((await ctx.dati.articoli()).map((a) => [a.id, a]));
      confronto = blocchiConfronto(regole.confronta(righe, entrate, nomi), "Confronto con la fattura " + fattura.numero, "");
    }
  }
  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, (regole.eDiPersona(o) ? "Spesa fatta da " : "Ordine a ") + (fornitore ? fornitore.nome : "fornitore")), bollo(o, adesso)),
    h("ul", { class: "voci" },
      h("li", { class: "voce" }, h("span", {}, "Ordinato"), h("strong", {}, giorno(o.inviato_il))),
      h("li", { class: "voce" }, h("span", {}, "Fattura attesa entro"), h("strong", { class: ritardo ? "rosso" : "" }, o.attesa_entro ? giorno(o.attesa_entro + "T12:00:00") : "non la aspetto")),
      o.fattura_id ? h("li", { class: "voce" }, h("span", {}, "Fattura"), h("strong", {}, h("a", { href: "#/fatture/" + o.fattura_id }, "aprila"))) : null),
    ritardo ? h("p", { class: "errore" }, "La fattura di questo ordine non è arrivata nei tempi. Sollecita il fornitore, oppure carica la fattura da Fatture se ce l'hai già.") : null,
    h("h3", {}, "Cosa hai ordinato"),
    h("ul", { class: "lista" }, righe.map((r) => h("li", { class: "riga tipo-articolo" }, h("strong", {}, r.nome), h("span", { class: "numero" }, regole.quantoTesto(r))))),
    o.nota && !regole.eDiPersona(o) ? h("p", { class: "nota" }, "Nota: " + o.nota) : null,
    confronto,
    o.stato === "aperto" && regole.eDiPersona(o) ? h("p", { class: "nota" }, "Merce già ritirata di persona: non c'è niente da inviare. Quando arriva la fattura, caricala da Fatture: la confronto con questa lista.") : null,
    o.stato === "aperto" && !regole.eDiPersona(o) ? h("div", {},
      h("h3", {}, "Invia l'ordine"),
      h("p", { class: "nota" }, "Si apre WhatsApp o la posta col messaggio già scritto: scegli il fornitore e premi invio."),
      h("div", { class: "azioni" },
        h("a", { class: "pulsante primario", href: "https://wa.me/?text=" + encodeURIComponent(testo), target: "_blank", rel: "noopener" }, "Invia con WhatsApp"),
        h("a", { class: "pulsante", href: "mailto:?subject=" + encodeURIComponent("Ordine " + ctx.ristorante.nome) + "&body=" + encodeURIComponent(testo) }, "Invia per email"),
        h("button", { type: "button", onclick: async () => {
          try { await navigator.clipboard.writeText(testo); stato.textContent = "Messaggio copiato: incollalo dove vuoi."; }
          catch (e) { stato.textContent = "Non riesco a copiare da qui: seleziona il testo qui sotto."; }
        } }, "Copia il messaggio")),
      stato,
      h("pre", { class: "messaggio" }, testo)) : null,
    errore,
    ctx.titolare ? h("div", { class: "azioni" },
      o.stato === "aperto" ? conConferma("La fattura è arrivata: chiudi l'ordine", "Sì, chiudi", () => prova(() => ctx.dati.chiudiOrdine(o))) : null,
      o.stato === "aperto" ? conConferma("Annulla l'ordine", "Sì, annulla l'ordine", () => prova(() => ctx.dati.annullaOrdine(o))) : null,
      o.stato !== "aperto" ? conConferma("Riapri l'ordine", "Sì, riapri", () => prova(() => ctx.dati.riapriOrdine(o))) : null) : null);
}
