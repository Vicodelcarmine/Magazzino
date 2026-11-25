// Preventivi: crei un link e lo mandi al fornitore; lui scrive i prezzi degli articoli che usi; tu li controlli
// e li carichi o li scarti. L'ordine e i pezzi della pagina sono quelli di ERP leggero; il fornitore però non
// apre più una pagina servita dal computer del locale: vedi js/preventivo-fornitore.js.
import { h, vuoto, conConferma } from "../dom.js";
import { qta, euro } from "../numeri.js";
import { categorieCon, filtra } from "../cerca.js";
import * as regole from "../preventivi.js";
import { sceltaArticolo } from "./scegli.js";

const dataIt = (d) => { const p = String(d || "").slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : ""; };

// I link creati da questo dispositivo: l'archivio ne tiene solo l'impronta, quindi il link si può rimostrare
// soltanto da dove è nato. Se si perde non è un danno: si ritira e se ne crea un altro.
const CHIAVE = "erp.preventivi.link";
function linkNoti() { try { return JSON.parse(localStorage.getItem(CHIAVE) || "{}") || {}; } catch (e) { return {}; } }
function ricordaLink(id, gettone) { try { const t = linkNoti(); t[id] = gettone; localStorage.setItem(CHIAVE, JSON.stringify(t)); } catch (e) { /* vale finché resti qui */ } }

let categorieScelte = {};   // le categorie accese nel modulo
let appenaCreato = null;    // { id, fornitore, indirizzo, scade }
let avvisoCopia = "";

function scarica(nome, testo) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([testo], { type: "text/csv;charset=utf-8" }));
  a.download = nome;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// I tre tasti sotto un link: WhatsApp, Excel, Copia link.
function tastiLink(indirizzo, fornitore, scade, articoli, ridisegna) {
  const stato = h("span", { class: "nota", role: "status" }, avvisoCopia && avvisoCopia.per === indirizzo ? avvisoCopia.testo : "");
  return h("div", {},
    h("p", { class: "link-preventivo" }, indirizzo),
    scade ? h("p", { class: "nota" }, "Valido fino al ", h("strong", {}, dataIt(scade))) : h("p", { class: "nota" }, "Senza scadenza"),
    h("div", { class: "azioni" },
      h("a", { class: "pulsante primario", target: "_blank", rel: "noopener",
        href: "https://wa.me/?text=" + encodeURIComponent(regole.testoWhatsApp(fornitore, indirizzo, scade)) }, "WhatsApp"),
      h("button", { type: "button", onclick: () => scarica("preventivo-" + String(fornitore).replace(/[^\w]+/g, "-") + ".csv", regole.fileArticoli(articoli)) }, "Excel"),
      h("button", { type: "button", onclick: async () => {
        try { await navigator.clipboard.writeText(indirizzo); stato.textContent = "Link copiato."; }
        catch (e) { stato.textContent = "Non riesco a copiare da qui: tieni premuto sul link qui sopra."; }
      } }, "Copia link"),
      stato));
}

// ---------- la pagina ----------
export async function elenco(ctx, nomeArchivio, ridisegna) {
  if (!ctx.titolare) return vuoto("Solo il titolare vede i preventivi.");
  const [preventivi, fornitori, tutti, prezzi] = await Promise.all([ctx.dati.preventivi(), ctx.dati.fornitori(), ctx.dati.articoli(), ctx.dati.prezziDaPreventivi()]);
  const articoli = tutti.filter((a) => a.attivo !== false && !a.prodotto_in_cucina);
  const nomi = new Map(fornitori.map((f) => [f.id, f.nome]));
  const perId = new Map(tutti.map((a) => [a.id, a]));
  const noti = linkNoti();
  const errore = h("p", { class: "errore", role: "alert" });
  const prova = async (azione) => { errore.textContent = ""; try { await azione(); ridisegna(); } catch (e) { errore.textContent = e.message || "Non riuscito."; } };
  const indirizzoDi = (gettone) => regole.indirizzoLink(location.href, gettone, location.hostname === "localhost" || location.hostname === "127.0.0.1" ? nomeArchivio : "");

  // 1. Da controllare
  const daControllare = preventivi.filter((p) => p.stato === "inviato");
  const bloccoControllo = daControllare.length ? [
    h("div", { class: "riquadri" }, h("div", { class: "riquadro giallo" }, h("strong", {}, String(daControllare.length)),
      h("span", {}, daControllare.length === 1 ? "preventivo arrivato. Aprilo, poi caricalo o scartalo." : "preventivi arrivati. Aprili, poi caricali o scartali."))),
    h("ul", { class: "lista" }, daControllare.map((p) => h("li", {}, h("a", { class: "riga allarme", href: "#/preventivi/" + p.id },
      h("strong", {}, nomi.get(p.fornitore_id) || "Fornitore"), h("span", { class: "nota" }, p.inviato_il ? "arrivato il " + dataIt(p.inviato_il) : ""))))),
  ] : null;

  // 2. Il modulo: fornitore, giorni, categorie, «Nel link»
  const categorie = categorieCon(articoli);
  const scelti = () => articoli.filter((a) => categorieScelte[String(a.categoria || "").trim() || "Senza categoria"]);
  const nelLink = h("p", { class: "nota" });
  const fornitore = h("input", { name: "fornitore", autocomplete: "off", placeholder: "Rossi", list: "fornitori-noti", "aria-label": "Fornitore" });
  const giorni = h("input", { name: "giorni", inputmode: "numeric", autocomplete: "off", placeholder: "7", "aria-label": "Quanti giorni resta valido" });
  const tastiCategorie = h("div", { class: "filtri tipo-articolo", role: "group", "aria-label": "Categorie" });
  function disegnaCategorie() {
    tastiCategorie.replaceChildren(...categorie.map((c) => h("button", { type: "button", class: "filtro" + (categorieScelte[c.nome] ? " attivo" : ""),
      "aria-pressed": categorieScelte[c.nome] ? "true" : "false",
      onclick: () => { categorieScelte[c.nome] = !categorieScelte[c.nome]; disegnaCategorie(); } }, c.nome + " (" + c.quante + ")")));
    const s = scelti();
    nelLink.replaceChildren(s.length
      ? h("span", {}, "Nel link (" + s.length + "): ", s.slice(0, 40).map((a, i) => [i ? ", " : "", h("span", { class: "tipo-articolo-testo" }, a.nome)]), s.length > 40 ? " e altri " + (s.length - 40) + "." : ".")
      : "Scegli almeno una categoria. Un fornitore di ortofrutta non riceve le altre.");
  }
  disegnaCategorie();
  const crea = h("button", { type: "button", class: "primario", onclick: () => prova(async () => {
    const r = await ctx.dati.creaPreventivo(fornitore.value, giorni.value.trim() === "" ? "7" : giorni.value, scelti());
    ricordaLink(r.preventivo.id, r.gettone);
    appenaCreato = { id: r.preventivo.id };
    categorieScelte = {};
  }) }, "Crea il link");

  // 3. Il link appena creato e i link in attesa
  const aperti = preventivi.filter((p) => p.stato === "aperto");
  const bloccoLink = (p) => {
    const gettone = noti[p.id];
    const scaduto = p.scade && String(p.scade).slice(0, 10) < new Date().toISOString().slice(0, 10);
    return h("li", { class: "riga" + (scaduto ? " spento" : "") },
      h("strong", {}, nomi.get(p.fornitore_id) || "Fornitore"),
      scaduto ? h("span", { class: "bollo" }, "scaduto") : null,
      gettone ? h("div", { class: "scelta-in-riga" }, tastiLink(indirizzoDi(gettone), nomi.get(p.fornitore_id) || "", p.scade, regole.articoliDi(p), ridisegna))
        : h("span", { class: "nota" }, "Link creato da un altro dispositivo: da qui non lo posso rimostrare. " + (p.scade ? "Valido fino al " + dataIt(p.scade) + "." : "")),
      conConferma("Ritira il link", "Sì, ritira: il fornitore non potrà più usarlo", () => prova(() => ctx.dati.segnaPreventivo(p.id, "chiuso"))));
  };
  const nuovo = appenaCreato ? aperti.find((p) => p.id === appenaCreato.id) : null;
  const inAttesa = aperti.filter((p) => !nuovo || p.id !== nuovo.id);

  // 4. Arrivati: i prezzi caricati dai preventivi
  const gruppi = new Map();
  prezzi.forEach((x) => { if (!gruppi.has(x.origine)) gruppi.set(x.origine, []); gruppi.get(x.origine).push(x); });
  const arrivati = Array.from(gruppi.entries()).sort((a, b) => String(b[1][0].data).localeCompare(String(a[1][0].data)));

  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "Preventivi")),
    bloccoControllo,
    h("p", { class: "nota" }, "Crei un link e lo mandi al fornitore. Lui scrive i prezzi degli articoli che usi. Il preventivo non entra nei prezzi finché non lo carichi."),
    h("div", { class: "scheda" },
      h("label", { class: "campo" }, h("span", { class: "etichetta" }, "Fornitore"), fornitore,
        h("span", { class: "aiuto" }, "Uno dei tuoi, oppure un nome nuovo: in quel caso lo aggiungo io ai fornitori.")),
      h("datalist", { id: "fornitori-noti" }, fornitori.filter((f) => f.attivo !== false).map((f) => h("option", { value: f.nome }))),
      h("label", { class: "campo" }, h("span", { class: "etichetta" }, "Quanti giorni resta valido"), giorni),
      articoli.length ? h("div", { class: "campo" }, h("span", { class: "etichetta" }, "Categorie"), tastiCategorie, nelLink)
        : h("p", { class: "errore" }, "Non c'è ancora nessun articolo di magazzino."),
      errore,
      h("div", { class: "azioni" }, crea)),
    nuovo ? [h("h3", {}, "Link per ", nomi.get(nuovo.fornitore_id) || ""), h("ul", { class: "lista" }, bloccoLink(nuovo))] : null,
    inAttesa.length ? [h("h3", {}, "Link in attesa"), h("ul", { class: "lista" }, inAttesa.map(bloccoLink))] : null,
    h("h3", {}, "Arrivati"),
    arrivati.length ? [
      h("p", { class: "nota" }, "Prezzi di preventivo già caricati. Toglierli non cambia la giacenza."),
      h("ul", { class: "lista" }, arrivati.map(([origine, righe]) => h("li", { class: "riga" },
        h("strong", {}, nomi.get(righe[0].fornitore_id) || "Fornitore"), h("span", { class: "numero" }, dataIt(righe[0].data)),
        h("ul", { class: "voci prezzi-preventivo" }, righe.slice().sort((a, b) => String((perId.get(a.articolo_id) || {}).nome).localeCompare(String((perId.get(b.articolo_id) || {}).nome), "it")).map((x) => {
          const a = perId.get(x.articolo_id) || { nome: "articolo", udm: "" };
          return h("li", { class: "voce" }, h("span", { class: "tipo-articolo-testo" }, a.nome),
            h("strong", {}, euro(x.prezzo_udm) + "/" + a.udm + (Number(x.qta_confezione) > 0 ? " · collo " + qta(x.qta_confezione) + " " + a.udm : "")));
        })),
        conConferma("Togli questo preventivo", "Sì, togli i suoi prezzi", () => prova(() => ctx.dati.togliPrezziPreventivo(origine.slice(5)))))))]
      : h("p", { class: "nota" }, "Nessun preventivo arrivato. Non è un carico: i prezzi non fanno entrare merce."));
}

// ---------- un preventivo da controllare ----------
const associazioni = new Map(); // id preventivo → { id riga alternativa → id articolo }

export async function scheda(ctx, id, ridisegna) {
  if (!ctx.titolare) return vuoto("Solo il titolare vede i preventivi.");
  const [preventivi, fornitori, tutti] = await Promise.all([ctx.dati.preventivi(), ctx.dati.fornitori(), ctx.dati.articoli()]);
  const p = preventivi.find((x) => x.id === id);
  if (!p) return vuoto("Preventivo non trovato.");
  if (p.stato !== "inviato") return h("section", {}, h("div", { class: "testata" }, h("h2", {}, "Preventivo")), vuoto("Questo preventivo non è da controllare."));
  const fornitore = fornitori.find((f) => f.id === p.fornitore_id);
  const articoli = tutti.filter((a) => a.attivo !== false && !a.prodotto_in_cucina);
  const perId = new Map(tutti.map((a) => [a.id, a]));
  if (!associazioni.has(id)) associazioni.set(id, {});
  const associa = associazioni.get(id);
  const righe = regole.righeControllate(p);
  const errore = h("p", { class: "errore", role: "alert" });
  const conto = h("p", { class: "nota", role: "status" });
  const aggiornaConto = () => {
    const piano = regole.prezziDaCaricare(p, associa, tutti);
    conto.textContent = piano.prezzi.length + (piano.prezzi.length === 1 ? " prezzo entra" : " prezzi entrano") + " nel confronto"
      + (piano.saltate.length ? " · non entrano: " + piano.saltate.join("; ") : "");
  };
  aggiornaConto();

  function riga(r) {
    const li = h("li", { class: "riga tipo-articolo" });
    function disegna() {
      const scelto = r.alternativo && associa[r.id] ? perId.get(associa[r.id]) : null;
      const guscio = h("div", { class: "scelta-in-riga" });
      if (r.alternativo && !scelto) {
        guscio.append(h("button", { type: "button", onclick: () => {
          guscio.replaceChildren(sceltaArticolo(articoli.filter((a) => a.udm === r.udm), (a) => { if (!a) return; associa[r.id] = a.id; disegna(); aggiornaConto(); }));
          const cerca = guscio.querySelector("input[type=search]");
          if (cerca) cerca.focus();
        } }, "Associa a un articolo già in magazzino"));
      }
      li.replaceChildren(...[
        h("strong", {}, r.nome), h("span", { class: "numero" }, euro(r.prezzo) + "/" + r.udm),
        r.alternativo ? h("span", { class: "nota avviso" }, "Articolo alternativo, scritto dal fornitore.") : null,
        h("span", { class: "nota" }, ["Collo " + qta(r.confezione) + " " + r.udm, r.codice ? "codice fornitore " + r.codice : null, r.note ? "note: " + r.note : null].filter(Boolean).join(" · ")),
        scelto ? h("span", { class: "scelto" }, h("span", { class: "nota" }, "→ entra come prezzo di «" + scelto.nome + "»"),
          h("button", { type: "button", class: "leggero", onclick: () => { delete associa[r.id]; disegna(); aggiornaConto(); } }, "Cambia")) : null,
        r.alternativo && !scelto ? guscio : null,
        r.alternativo && !scelto ? h("span", { class: "nota" }, "Non crea un articolo nuovo. Entra nei prezzi solo se lo associ e premi Carica.") : null].filter(Boolean));
    }
    disegna();
    return li;
  }

  const carica = h("button", { type: "button", class: "primario", onclick: async () => {
    errore.textContent = "";
    carica.disabled = true;
    try { await ctx.dati.caricaPreventivo(p, associa); associazioni.delete(id); location.hash = "#/preventivi"; }
    catch (e) { errore.textContent = e.message || "Non riuscito."; carica.disabled = false; }
  } }, "Carica");
  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, fornitore ? fornitore.nome : "Fornitore"), h("span", { class: "bollo da_completare" }, "da controllare")),
    h("p", { class: "nota" }, p.inviato_il ? "Arrivato il " + dataIt(p.inviato_il) : "Senza data"),
    p.note ? h("p", { class: "nota" }, "Note generali: " + String(p.note).slice(0, 500)) : null,
    righe.length ? h("ul", { class: "lista" }, righe.map(riga)) : vuoto("In questo preventivo non c'è nessun prezzo leggibile."),
    conto, errore,
    h("div", { class: "azioni" }, righe.length ? carica : null,
      conConferma("Scarta", "Sì, scarta questo preventivo", async () => {
        try { await ctx.dati.segnaPreventivo(p.id, "scartato"); associazioni.delete(id); location.hash = "#/preventivi"; }
        catch (e) { errore.textContent = e.message || "Non riuscito."; }
      })));
}
