// «Fatture dalla posta»: collegare la casella di posta del locale e vedere cosa è arrivato.
import { h, vuoto, conConferma } from "../dom.js";
import { CONFIG } from "../config.js";
import { programma, manifesto, mittenteBreve } from "../posta.js";

const quando = (t) => (t ? new Date(t).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "mai");

// La chiave appena creata: si vede solo finché si resta in questa pagina, poi non è più recuperabile.
let appenaCreata = null;

function daCopiare(titolo, testo) {
  const esito = h("span", { class: "nota", role: "status" });
  const riquadro = h("textarea", { class: "codice", readonly: true, rows: "6", "aria-label": titolo });
  riquadro.value = testo;
  return h("div", { class: "blocco-codice" },
    h("div", { class: "azioni" }, h("strong", {}, titolo),
      h("button", { type: "button", class: "primario", onclick: async () => {
        try { await navigator.clipboard.writeText(testo); esito.textContent = "Copiato."; }
        catch (e) { riquadro.focus(); riquadro.select(); esito.textContent = "Selezionato: copia con il tasto Copia del telefono o Cmd+C."; }
      } }, "Copia"), esito),
    riquadro);
}

export async function pagina(ctx, nomeArchivio, ridisegna) {
  if (!ctx.titolare) return vuoto("Solo il titolare può collegare la posta.");
  const errore = h("p", { class: "errore", role: "alert" });
  let chiave = null, arrivi = [];
  try { chiave = await ctx.dati.chiavePosta(); arrivi = await ctx.dati.posta(); }
  catch (e) { return vuoto("Per questa pagina serve la rete (" + e.message + ")."); }
  const archivio = CONFIG.archivi[nomeArchivio];
  const url = archivio.url || location.origin;
  const prova = async (azione) => { errore.textContent = ""; try { await azione(); ridisegna(); } catch (e) { errore.textContent = e.message; } };
  const crea = () => prova(async () => { appenaCreata = await ctx.dati.creaChiavePosta(); });
  if (appenaCreata && !chiave) appenaCreata = null;

  const stato = chiave
    ? h("ul", { class: "voci" },
        h("li", { class: "voce" }, h("span", {}, "Posta"), h("strong", {}, chiave.ultimo_uso ? "collegata" : "chiave creata, raccoglitore non ancora partito")),
        h("li", { class: "voce" }, h("span", {}, "Ultima consegna del raccoglitore"), h("strong", {}, quando(chiave.ultimo_uso))),
        h("li", { class: "voce" }, h("span", {}, "Chiave creata"), h("strong", {}, quando(chiave.creato_il))))
    : h("p", { class: "nota avviso" }, "La posta non è collegata: le fatture le carichi a mano da Fatture.");

  const istruzioni = appenaCreata ? h("div", { class: "scheda-confronto" },
    h("h3", {}, "Come collegare la posta (una volta sola)"),
    h("p", { class: "nota avviso" }, "Questa pagina mostra il programma con dentro la chiave: resta visibile solo finché non esci da qui. Se la perdi, crei una chiave nuova."),
    h("ol", { class: "passi" },
      h("li", {}, "Dal computer apri ", h("strong", {}, "script.google.com"), " entrando con l'account di posta del locale, e premi «Nuovo progetto». Dagli un nome, per esempio «Raccoglitore magazzino»."),
      h("li", {}, "A sinistra apri ", h("strong", {}, "Impostazioni progetto"), " (la rotella) e metti la spunta a «Mostra il file manifest appsscript.json nell'editor»."),
      h("li", {}, "Torna all'", h("strong", {}, "Editor"), ". Apri il file ", h("strong", {}, "appsscript.json"), ", cancella tutto e incolla questo:")),
    daCopiare("Permessi (appsscript.json)", manifesto()),
    h("ol", { class: "passi", start: "4" },
      h("li", {}, "Apri il file ", h("strong", {}, "Codice.gs"), ", cancella tutto e incolla questo:")),
    daCopiare("Programma (Codice.gs)", programma(url, archivio.chiave, appenaCreata)),
    h("ol", { class: "passi", start: "5" },
      h("li", {}, "Premi il dischetto per salvare. In alto, nel menu delle funzioni, scegli ", h("strong", {}, "installa"), " e premi ", h("strong", {}, "Esegui"), "."),
      h("li", {}, "Google chiede il permesso: scegli l'account, poi «Avanzate» → «Vai a … (non sicuro)» → «Consenti». L'avviso è normale per un programma fatto in casa. Il permesso richiesto è di sola lettura della posta."),
      h("li", {}, "Fatto. Torna qui e riapri questa pagina: dopo il primo giro leggerai «collegata», e in Fatture compariranno le fatture arrivate."))) : null;

  const scartate = arrivi.filter((p) => p.stato === "scartata");
  const riga = (p) => h("li", { class: "riga" + (p.stato === "scartata" ? " spento" : "") },
    h("strong", {}, p.nome_file || "allegato"),
    h("span", { class: "bollo " + (p.stato === "fattura" ? "attivo" : p.stato === "nuova" ? "da_completare" : "") },
      p.stato === "fattura" ? "fattura" : p.stato === "nuova" ? "da guardare" : "scartato"),
    h("span", { class: "nota" }, [mittenteBreve(p.mittente), quando(p.ricevuta_il), p.stato === "scartata" ? p.nota : null].filter(Boolean).join(" · ")),
    p.stato === "fattura" && p.fattura_id ? h("a", { href: "#/fatture/" + p.fattura_id }, "Apri la fattura") : null,
    null);

  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "Fatture dalla posta")),
    h("p", { class: "nota" }, "Un piccolo programma dentro l'account di posta del locale guarda le email ogni quarto d'ora, in sola lettura, e consegna qui gli allegati PDF e XML. Le fatture riconosciute compaiono in Fatture come «arrivate, da caricare»."),
    stato, errore,
    h("div", { class: "azioni" },
      chiave ? conConferma("Crea una chiave nuova (la vecchia smette di funzionare)", "Sì, crea la chiave nuova", crea)
        : h("button", { type: "button", class: "primario", onclick: crea }, "Collega la posta: crea la chiave"),
      chiave ? conConferma("Scollega la posta", "Sì, scollega", () => prova(async () => { appenaCreata = null; await ctx.dati.spegniChiavePosta(chiave.id); })) : null),
    istruzioni,
    h("h3", {}, "Arrivati per posta (" + arrivi.length + ")"),
    arrivi.length ? h("ul", { class: "lista" }, arrivi.slice(0, 40).map(riga)) : vuoto("Ancora niente."),
    scartate.length ? h("p", { class: "nota" }, "Gli allegati scartati sono quelli che non so leggere come fattura: PDF che non sono di Metro, altri documenti. Il loro contenuto viene cancellato dal magazzino: qui restano solo nome, mittente e motivo. L'email originale resta nella tua posta.") : null);
}
