// Le operazioni dell'app sui dati di UN ristorante: controlla, poi scrive nell'archivio.
import * as convalida from "./convalida.js";
import { nuovoId, parseNumero } from "./numeri.js";
import { inBase } from "./unita.js";
import { codiceNuovo } from "./codici.js";
import { datiEsempio, ORDINE_ESEMPIO } from "./demo.js";
import { COPIATE, allineaTabella } from "./allinea.js";

export class ErroreDato extends Error {}

function controlla(esito) {
  if (!esito.ok) throw new ErroreDato(esito.errore);
  return esito.dati;
}

// Ogni quanto si richiedono le novità all'archivio, se nel frattempo non si è scritto niente.
const OGNI = 60000;
const perNome = (a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "it");
const perNascita = (a, b) => String(a.creato_il || "").localeCompare(String(b.creato_il || ""));

// copia e spazio (facoltativi): la copia dei dati sul dispositivo e lo spazio di questo utente e
// ristorante. Con la copia, le letture non scaricano più tutto: si chiedono solo le novità, e senza
// rete si legge quello che c'è. Senza copia (prove, browser senza disco) si legge dall'archivio.
export function creaDati(archivioVero, ristoranteId, copia, spazio) {
  const qui = { ristorante_id: ristoranteId };
  const daRivedere = new Set(COPIATE); // tabelle in cui si è appena scritto: da riallineare subito
  let ultimo = 0, inCorso = null;
  const stato = { quando: null, fuoriLinea: false };
  const breve = new Map(); // senza copia: le letture intere valgono per un minuto
  const archivio = Object.assign(Object.create(archivioVero), {
    inserisci(tabella, ...a) { daRivedere.add(tabella); breve.delete(tabella); return archivioVero.inserisci(tabella, ...a); },
    modifica(tabella, ...a) { daRivedere.add(tabella); breve.delete(tabella); return archivioVero.modifica(tabella, ...a); },
  });

  // Porta la copia in pari con l'archivio: subito per le tabelle appena scritte, una volta al minuto per le altre.
  function allinea() {
    if (inCorso) return inCorso;
    const tutte = Date.now() - ultimo > OGNI;
    const quali = tutte ? COPIATE.slice() : Array.from(daRivedere);
    if (!quali.length) return Promise.resolve();
    inCorso = (async () => {
      try {
        await Promise.all(quali.map((t) => allineaTabella(archivioVero, copia, spazio, ristoranteId, t)));
        quali.forEach((t) => daRivedere.delete(t));
        if (tutte) ultimo = Date.now();
        stato.quando = Date.now();
        stato.fuoriLinea = false;
      } catch (e) {
        // Senza rete si va avanti con la copia, se c'è già stata almeno una volta. Si riprova fra poco.
        const maiScaricata = !(await copia.segno(spazio, "articoli")) && !(await copia.conta(spazio, "articoli"));
        if (e.tipo !== "rete" || maiScaricata) throw e;
        stato.fuoriLinea = true;
        ultimo = Date.now() - OGNI + 15000;
        quali.forEach((t) => daRivedere.delete(t));
      } finally { inCorso = null; }
    })();
    return inCorso;
  }

  // Tutte le righe di una tabella per questo ristorante.
  async function tutta(tabella) {
    if (copia) {
      await allinea();
      return copia.leggi(spazio, tabella);
    }
    const c = breve.get(tabella);
    if (c && Date.now() - c.quando < OGNI) return c.lettura;
    const lettura = archivio.leggi(tabella, qui);
    const questa = { quando: Date.now(), lettura: lettura };
    breve.set(tabella, questa);
    lettura.catch(() => { if (breve.get(tabella) === questa) breve.delete(tabella); });
    return lettura;
  }

  async function modifica(tabella, id, dati) {
    const r = await archivio.modifica(tabella, { id: id, ristorante_id: ristoranteId }, dati);
    if (!r.length) throw new ErroreDato("La riga non è stata salvata: forse non hai il permesso.");
    return r[0];
  }

  // Una cosa nuova riceve il codice dal sistema, mai da chi scrive. Il codice si
  // calcola sui dati freschi dell'archivio; se nel frattempo un altro telefono ha
  // preso lo stesso numero, l'archivio rifiuta il doppione e si riprova col successivo.
  async function creaConCodice(tabella, famiglia, dati) {
    for (let tentativo = 0; ; tentativo += 1) {
      const [articoli, piatti] = await Promise.all([api.articoli(), api.piatti()]);
      const codice = codiceNuovo(famiglia, dati.categoria, articoli, piatti);
      try {
        const r = await archivio.inserisci(tabella, Object.assign({ id: nuovoId(), codice: codice }, qui, dati));
        return r[0];
      } catch (e) {
        if (e.tipo !== "doppione" || tentativo >= 3) throw e;
      }
    }
  }

  const api = {
    // Quando sono stati presi i dati e se in questo momento manca la rete.
    stato() { return Object.assign({}, stato); },
    async articoli() { return (await tutta("articoli")).slice().sort(perNome); },
    async fornitori() { return (await tutta("fornitori")).slice().sort(perNome); },
    async piatti() { return (await tutta("piatti")).slice().sort(perNome); },
    // chiave: { piatto_id } oppure { preparazione_id }
    async righeDi(chiave) {
      const campo = chiave.piatto_id ? "piatto_id" : "preparazione_id";
      return (await tutta("righe_ricetta")).filter((r) => r[campo] === chiave[campo]).sort(perNascita);
    },
    // Le righe aperte delle ricette di tutte le preparazioni (per evitare i giri).
    async righePreparazioni() {
      return (await tutta("righe_ricetta")).filter((r) => r.piatto_id == null && r.valida_al == null);
    },
    // I piatti e le preparazioni che oggi contengono questo articolo.
    async usiDi(articoloId) {
      return (await tutta("righe_ricetta")).filter((r) => r.articolo_id === articoloId && r.valida_al == null);
    },

    async salvaFornitore(input, esistenti) {
      const dati = controlla(convalida.fornitore(input, esistenti));
      if (input.id) return modifica("fornitori", input.id, dati);
      return (await archivio.inserisci("fornitori", Object.assign({ id: nuovoId() }, qui, dati)))[0];
    },
    // Modificare non tocca mai il codice: resta quello assegnato alla nascita.
    salvaArticolo(input) {
      const dati = controlla(convalida.articolo(input));
      return input.id ? modifica("articoli", input.id, dati) : creaConCodice("articoli", "articolo", dati);
    },
    salvaPreparazione(input) {
      const dati = controlla(convalida.preparazione(input));
      return input.id ? modifica("articoli", input.id, dati) : creaConCodice("articoli", "preparazione", dati);
    },
    salvaPiatto(input) {
      const dati = controlla(convalida.piatto(input));
      return input.id ? modifica("piatti", input.id, dati) : creaConCodice("piatti", "piatto", dati);
    },
    archiviaPiatto(piatto, archiviato) {
      return modifica("piatti", piatto.id, { stato: archiviato ? "archiviato" : "da_completare" });
    },

    // Il piatto è «attivo» quando ha almeno una riga di distinta, altrimenti «da completare».
    async allineaStato(piatto, righe) {
      if (piatto.stato === "archiviato") return piatto;
      const giusto = convalida.righeAperte(righe).length ? "attivo" : "da_completare";
      if (piatto.stato === giusto) return piatto;
      return modifica("piatti", piatto.id, { stato: giusto });
    },

    // chiave: { piatto_id } oppure { preparazione_id }; la quantità è sempre «per 1».
    async aggiungiRiga(chiave, input, righe) {
      const dati = controlla(convalida.rigaRicetta(input, convalida.righeAperte(righe)));
      if (chiave.preparazione_id && chiave.preparazione_id === dati.articolo_id) {
        throw new ErroreDato("Una preparazione non può contenere se stessa.");
      }
      const r = await archivio.inserisci("righe_ricetta",
        Object.assign({ id: nuovoId() }, chiave, qui, dati));
      return r[0];
    },

    // Una riga non si cancella: si chiude. I consumi passati restano com'erano.
    async togliRiga(riga) {
      const r = await archivio.modifica("righe_ricetta", { id: riga.id, ristorante_id: ristoranteId },
        { valida_al: new Date().toISOString() });
      if (!r.length) throw new ErroreDato("La riga non è stata tolta: forse non hai il permesso.");
    },

    // Cambiare dose = chiudere la riga vecchia e aprirne una nuova.
    async cambiaQuantita(riga, quantita, righe) {
      const altre = convalida.righeAperte(righe).filter((x) => x.id !== riga.id);
      const dati = controlla(convalida.rigaRicetta({ articolo_id: riga.articolo_id, quantita: quantita }, altre));
      if (Math.abs(dati.quantita - Number(riga.quantita)) < 5e-7) return;
      const padrone = riga.piatto_id ? { piatto_id: riga.piatto_id } : { preparazione_id: riga.preparazione_id };
      await api.togliRiga(riga);
      try {
        await archivio.inserisci("righe_ricetta",
          Object.assign({ id: nuovoId() }, padrone, qui, dati));
      } catch (e) {
        // La nuova non è entrata: riapro la vecchia, così l'ingrediente non sparisce.
        await archivio.modifica("righe_ricetta", { id: riga.id, ristorante_id: ristoranteId }, { valida_al: null });
        throw e;
      }
    },

    // «Vendilo così com'è»: un piatto nuovo con una sola riga di distinta, questo articolo.
    // input: i campi del piatto più quantita e unita (g, cl, pz…).
    async vendiArticolo(articolo, input) {
      // Tutti i controlli PRIMA di scrivere, così non nasce un piatto a metà.
      const datiPiatto = controlla(convalida.piatto(input));
      const n = parseNumero(input.quantita);
      if (n == null || !(n > 0)) throw new ErroreDato("Scrivi quanto ne va in una porzione (un numero maggiore di zero).");
      const quantita = Math.round(inBase(n, input.unita || articolo.udm, articolo.udm) * 1e6) / 1e6;
      const riga = controlla(convalida.rigaRicetta({ articolo_id: articolo.id, quantita: quantita }, []));
      const piatto = await creaConCodice("piatti", "piatto", datiPiatto);
      const fatta = await api.aggiungiRiga({ piatto_id: piatto.id }, riga, []);
      return api.allineaStato(piatto, [fatta]);
    },

    // Un conteggio e un arrivo sono righe nuove del registro: non si correggono, si aggiungono.
    // Portano sempre chi li ha fatti.
    //
    // Se lo stesso articolo è già stato contato OGGI (giaContato = { id, quantita }) bisogna dire
    // cosa si intende, perché il caso tipico è «ne ho trovate altre in un altro frigo»:
    //   modo "aggiungi"    → il numero si somma a quello di prima (24 + 12 = 36);
    //   modo "sostituisci" → il numero è il totale giusto, quello di prima era sbagliato.
    // In tutti e due i casi il conteggio di prima viene ANNULLATO (con una riga di annullamento,
    // non cancellato) e ne nasce uno solo col totale: così un conteggio a metà non falsa lo sfrido.
    async registraConteggio(articoloId, quantita, giaContato, modo) {
      const n = parseNumero(quantita);
      if (n == null || n < 0) throw new ErroreDato("Scrivi quanto ce n'è (un numero, anche zero).");
      if (giaContato && modo !== "aggiungi" && modo !== "sostituisci") {
        throw new ErroreDato("Oggi l'hai già contato: scegli se questo numero si aggiunge o sostituisce quello di prima.");
      }
      const totale = giaContato && modo === "aggiungi" ? Number(giaContato.quantita) + n : n;
      const adesso = new Date().toISOString();
      const io = archivio.utente().id;
      const r = await archivio.inserisci("movimenti", Object.assign({
        id: nuovoId(), tipo: "conteggio", articolo_id: articoloId, quantita: totale, avvenuto_il: adesso,
        origine: "manuale", autore_id: io,
        nota: giaContato ? (modo === "aggiungi" ? "aggiunti " + n + " ai " + giaContato.quantita + " già contati" : "corregge il conteggio di prima (" + giaContato.quantita + ")") : "",
      }, qui));
      if (giaContato) {
        await archivio.inserisci("movimenti", Object.assign({
          id: nuovoId(), tipo: "annullamento", annulla_id: giaContato.id, avvenuto_il: adesso,
          origine: "manuale", autore_id: io, nota: "sostituito dal conteggio completo" }, qui));
      }
      return r[0];
    },
    // input: { quantita, fornitore_id (vuoto = acquisto diretto), prezzo (facoltativo, € per unità) }
    async registraCarico(articoloId, input) {
      const n = parseNumero(input.quantita);
      if (n == null || !(n > 0)) throw new ErroreDato("Scrivi quanta merce è arrivata (un numero maggiore di zero).");
      let prezzo = null;
      if (input.prezzo != null && String(input.prezzo).trim() !== "") {
        prezzo = parseNumero(input.prezzo);
        if (prezzo == null || !(prezzo > 0)) throw new ErroreDato("Il prezzo non è un numero.");
      }
      const fornitore = input.fornitore_id || null;
      const adesso = new Date().toISOString();
      const mov = (await archivio.inserisci("movimenti", Object.assign({
        id: nuovoId(), tipo: "carico", articolo_id: articoloId, quantita: n, importo_unitario: prezzo,
        fornitore_id: fornitore, acquisto_diretto: !fornitore, avvenuto_il: adesso, origine: "manuale",
        autore_id: archivio.utente().id }, qui)))[0];
      // Solo un arrivo da fornitore, col prezzo, entra nel confronto dei prezzi. L'acquisto diretto no.
      if (fornitore && prezzo) {
        await archivio.inserisci("prezzi", Object.assign({
          id: nuovoId(), articolo_id: articoloId, fornitore_id: fornitore, tipo: "fattura",
          data: adesso.slice(0, 10), prezzo_udm: prezzo, origine: "movimento:" + mov.id }, qui));
      }
      return mov;
    },

    // Merce buttata o rotta: una correzione in meno, col motivo. Entra negli sprechi.
    async registraSpreco(articoloId, quantita, motivo) {
      const n = parseNumero(quantita);
      if (n == null || !(n > 0)) throw new ErroreDato("Scrivi quanta merce hai buttato (un numero maggiore di zero).");
      const r = await archivio.inserisci("movimenti", Object.assign({
        id: nuovoId(), tipo: "correzione", articolo_id: articoloId, quantita: -n,
        avvenuto_il: new Date().toISOString(), origine: "manuale", autore_id: archivio.utente().id,
        nota: String(motivo || "").trim() || "buttato" }, qui));
      return r[0];
    },
    // Un movimento sbagliato non si cancella: si aggiunge una riga che lo annulla.
    // Se era un arrivo col prezzo, anche quel prezzo esce dal confronto.
    async annullaMovimento(movimentoId) {
      await archivio.inserisci("movimenti", Object.assign({
        id: nuovoId(), tipo: "annullamento", annulla_id: movimentoId, avvenuto_il: new Date().toISOString(),
        origine: "manuale", autore_id: archivio.utente().id, nota: "annullato a mano" }, qui));
      await archivio.modifica("prezzi", { origine: "movimento:" + movimentoId, ristorante_id: ristoranteId },
        { annullato_il: new Date().toISOString() });
    },

    // Tutto ciò che serve al motore dei conti, in una volta.
    async perIConti(impostazioni) {
      const [articoli, piatti, righe, movimenti, prezzi, fornitori] = await Promise.all(
        ["articoli", "piatti", "righe_ricetta", "movimenti", "prezzi", "fornitori"].map(tutta));
      return { articoli: articoli, piatti: piatti, righe: righe, movimenti: movimenti, prezzi: prezzi,
        fornitori: fornitori, impostazioni: impostazioni || {}, adesso: Date.now() };
    },

    async caricaEsempio() {
      const dati = datiEsempio(ristoranteId, nuovoId, new Date());
      for (const tabella of ORDINE_ESEMPIO) await archivio.inserisci(tabella, dati[tabella]);
    },
  };
  return api;
}
