// Pagina di servizio: porta un ristorante dall'archivio di prova a quello online.
// Si apre da #/trasloco stando dentro l'archivio online. Non è nel menu: si usa una volta.
import { h, campo, modulo, scelta, vuoto } from "../dom.js";
import { creaArchivio } from "../archivio.js";
import { CONFIG } from "../config.js";
import { trasloca, completo, TABELLE } from "../trasloco.js";

const NOMI = { fornitori: "Fornitori", articoli: "Articoli", piatti: "Piatti", collegamenti_piatto: "Codici della cassa",
  righe_ricetta: "Righe di ricetta", prezzi: "Prezzi", movimenti: "Movimenti",
  abbinamenti_fornitore: "Codici dei fornitori", fatture: "Fatture", ordini: "Ordini" };

export async function pagina(ctx, archivioOnline, nomeArchivio) {
  if (nomeArchivio !== "online") {
    return vuoto("Questa pagina si usa stando dentro l'archivio online: esci, scegli «Archivio online» ed entra col tuo utente.");
  }
  if (!CONFIG.archivi.prova) return vuoto("Questa pagina funziona solo dal Mac dove sta l'archivio di prova.");
  const prova = creaArchivio({ nome: "prova", deposito: localStorage, url: CONFIG.archivi.prova.url, chiave: CONFIG.archivi.prova.chiave });
  if (!prova.utente()) {
    return vuoto("Per leggere i dati di prova serve essere entrati anche nell'archivio di prova, su questo Mac, almeno una volta.");
  }
  let ristoranti;
  try { ristoranti = await prova.leggi("ristoranti", {}, "nome.asc"); } catch (e) {
    return vuoto("Non riesco a leggere l'archivio di prova (" + e.message + "). È acceso? Si avvia con: python3 avvia.py");
  }
  if (!ristoranti.length) return vuoto("Nell'archivio di prova non c'è nessun ristorante.");
  const stato = h("p", { class: "nota avviso", role: "status" });
  const risultato = h("div", {});

  return h("section", {},
    h("div", { class: "testata" }, h("h2", {}, "Porta online i dati di prova")),
    h("p", { class: "nota" }, "Copia un ristorante dall'archivio di prova di questo Mac all'archivio online, a nome di "
      + archivioOnline.utente().email + ". L'archivio di prova non viene toccato. Se si interrompe, basta rifarlo: riprende da dove era arrivato."),
    modulo([
      campo("Ristorante da portare", scelta("da", ristoranti.map((r) => [r.id, r.nome]),
        (ristoranti.find((r) => r.nome.includes("dati veri")) || ristoranti[0]).id)),
      campo("Come si chiamerà online", h("input", { name: "nome", value: "Vico del Carmine", autocomplete: "off" })),
    ], "Porta online", async (d) => {
      const origine = ristoranti.find((r) => r.id === d.da);
      if (!String(d.nome).trim()) throw new Error("Scrivi il nome che avrà online.");
      risultato.replaceChildren();
      const esito = await trasloca(prova, archivioOnline, origine, String(d.nome).trim(), (t) => { stato.textContent = t; });
      stato.textContent = completo(esito) ? "Fatto: online c'è tutto." : "Finito, ma i numeri non tornano tutti: guarda la tabella.";
      risultato.replaceChildren(h("ul", { class: "voci" }, TABELLE.map((t) =>
        h("li", { class: "voce" }, h("span", {}, NOMI[t]),
          h("strong", { class: esito[t].arrivo >= esito[t].partenza ? "" : "rosso" },
            esito[t].arrivo + " online su " + esito[t].partenza + " di prova")))),
        h("p", {}, h("a", { href: "#/magazzino", onclick: (ev) => { ev.preventDefault(); ctx.cambiaRistorante(origine.id); } }, "Apri il ristorante online")));
    }),
    stato, risultato);
}
