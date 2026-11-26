// Le operazioni dell'app sui dati di UN ristorante: controlla, poi scrive nell'archivio.
import * as convalida from "./convalida.js";
import { nuovoId, parseNumero } from "./numeri.js";
import { inBase } from "./unita.js";
import { codiceNuovo } from "./codici.js";
import { datiEsempio, ORDINE_ESEMPIO } from "./demo.js";
import { COPIATE, allineaTabella } from "./allinea.js";
import { accoda, applica, inCoda, riapplica, spedisci } from "./coda.js";
import * as carico from "./fatture/carico.js";
import * as regoleOrdini from "./ordini.js";
import * as cassa from "./cassa.js";
import { leggiXls } from "./xls.js";
import * as preventivi from "./preventivi.js";

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
  const stato = { quando: null, fuoriLinea: false, inAttesa: 0, rifiutate: 0 };
  const breve = new Map(); // senza copia: le letture intere valgono per un minuto

  // ----- scritture: dirette se c'è la rete, altrimenti in coda sul dispositivo (vedi coda.js) -----
  async function contaCoda() {
    if (!copia) return;
    const c = await inCoda(copia, spazio);
    stato.inAttesa = c.attesa.length;
    stato.rifiutate = c.rifiutate.length;
  }
  // Un articolo o un piatto creato senza rete ha preso il primo codice libero che il telefono conosceva:
  // se nel frattempo l'ha preso qualcun altro, si rifà sui dati freschi.
  async function ricodifica(op) {
    await Promise.all(["articoli", "piatti"].map((t) => allineaTabella(archivioVero, copia, spazio, ristoranteId, t)));
    const mie = new Set(op.righe.map((r) => r.id));
    const articoli = (await copia.leggi(spazio, "articoli")).filter((r) => !mie.has(r.id));
    const piatti = (await copia.leggi(spazio, "piatti")).filter((r) => !mie.has(r.id));
    return op.righe.map((r) => {
      const famiglia = op.tabella === "piatti" ? "piatto" : (r.prodotto_in_cucina ? "preparazione" : "articolo");
      const codice = codiceNuovo(famiglia, r.categoria, articoli, piatti);
      (op.tabella === "piatti" ? piatti : articoli).push({ codice: codice, categoria: r.categoria });
      return Object.assign({}, r, { codice: codice });
    });
  }
  async function spedisciCoda() {
    if (!copia) return { ferme: 0, spedite: 0, rifiutate: 0 };
    const e = await spedisci(archivioVero, copia, spazio, { ricodifica: ricodifica });
    e.tabelle.forEach((t) => daRivedere.add(t));
    await contaCoda();
    return e;
  }
  async function inCodaAdesso(op) {
    stato.fuoriLinea = true;
    const righe = await accoda(copia, spazio, op);
    await contaCoda();
    return righe;
  }
  async function scrivi(op, diretta) {
    daRivedere.add(op.tabella);
    breve.delete(op.tabella);
    if (copia && (await inCoda(copia, spazio)).attesa.length) {
      // Ci sono operazioni più vecchie in attesa: partono prima loro, l'ordine conta.
      if ((await spedisciCoda()).ferme) return inCodaAdesso(op);
    }
    try {
      return await diretta();
    } catch (e) {
      if (!copia || e.tipo !== "rete") throw e; // un rifiuto vero si dice subito a chi sta scrivendo
      return inCodaAdesso(op);
    }
  }
  const archivio = Object.assign(Object.create(archivioVero), {
    inserisci(tabella, righe, opz) {
      const lista = Array.isArray(righe) ? righe : [righe];
      return scrivi({ tipo: "inserisci", tabella: tabella, righe: lista }, () => archivioVero.inserisci(tabella, righe, opz));
    },
    modifica(tabella, filtri, cambi) {
      return scrivi({ tipo: "modifica", tabella: tabella, filtri: filtri, cambi: cambi }, () => archivioVero.modifica(tabella, filtri, cambi));
    },
  });

  // Porta la copia in pari con l'archivio: subito per le tabelle appena scritte, una volta al minuto per le altre.
  // Prima di scaricare, fa partire le operazioni rimaste in coda.
  function allinea() {
    if (inCorso) return inCorso;
    const tutte = Date.now() - ultimo > OGNI;
    if (!tutte && !daRivedere.size) return Promise.resolve();
    inCorso = (async () => {
      let quali = [];
      try {
        await contaCoda();
        if (stato.inAttesa && (tutte || !stato.fuoriLinea)) await spedisciCoda();
        quali = tutte ? COPIATE.slice() : Array.from(daRivedere);
        await Promise.all(quali.map((t) => allineaTabella(archivioVero, copia, spazio, ristoranteId, t)));
        quali.forEach((t) => daRivedere.delete(t));
        if (tutte) ultimo = Date.now();
        stato.quando = Date.now();
        stato.fuoriLinea = false;
        await riapplica(copia, spazio); // ciò che è ancora in coda resta visibile sopra i dati scaricati
      } catch (e) {
        // Senza rete si va avanti con la copia, se c'è già stata almeno una volta. Si riprova fra poco.
        const maiScaricata = !(await copia.segno(spazio, "articoli")) && !(await copia.conta(spazio, "articoli"));
        if (e.tipo !== "rete" || maiScaricata) throw e;
        stato.fuoriLinea = true;
        ultimo = Date.now() - OGNI + 15000;
        daRivedere.clear();
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
    // Quando sono stati presi i dati, se manca la rete, e quante operazioni aspettano di partire.
    stato() { return Object.assign({}, stato); },
    // Le operazioni fatte senza rete: quelle in attesa e quelle che l'archivio ha rifiutato.
    async coda() { return copia ? inCoda(copia, spazio) : { attesa: [], rifiutate: [] }; },
    // Prova adesso a far partire ciò che aspetta (per esempio quando torna il segnale).
    async spedisciOra() { ultimo = 0; await allinea(); return Object.assign({}, stato); },
    // Un'operazione rifiutata si può buttare via, oppure rimettere in attesa per riprovarla.
    async scartaRifiutata(n) { await copia.codaTogli(spazio, n); await contaCoda(); },
    async riprovaRifiutata(n) {
      const op = (await copia.codaTutte(spazio)).find((o) => o.n === n);
      if (!op) return;
      await copia.codaMetti(spazio, Object.assign({}, op, { stato: "attesa", motivo: "" }));
      await applica(copia, spazio, op);
      await spedisciCoda();
    },
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
    // «Questo articolo sempre da quel fornitore» (fornitoreId vuoto = torna a vincere il prezzo migliore).
    fissaFornitore(articoloId, fornitoreId) {
      return modifica("articoli", articoloId, { fornitore_fisso_id: fornitoreId || null });
    },
    salvaPreparazione(input) {
      const dati = controlla(convalida.preparazione(input));
      return input.id ? modifica("articoli", input.id, dati) : creaConCodice("articoli", "preparazione", dati);
    },
    salvaPiatto(input) {
      const dati = controlla(convalida.piatto(input));
      if (dati.senza_merce) dati.stato = "attivo";
      return input.id ? modifica("piatti", input.id, dati) : creaConCodice("piatti", "piatto", dati);
    },
    archiviaPiatto(piatto, archiviato) {
      return modifica("piatti", piatto.id, { stato: archiviato ? "archiviato" : "da_completare" });
    },

    // Il piatto è «attivo» quando ha almeno una riga di distinta, altrimenti «da completare».
    async allineaStato(piatto, righe) {
      if (piatto.stato === "archiviato") return piatto;
      // Una voce senza merce è completa così: non le manca nessuna distinta.
      const giusto = piatto.senza_merce || convalida.righeAperte(righe).length ? "attivo" : "da_completare";
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

    // L'inventario completo: tanti conteggi insieme, tutti con la stessa ora (quella in cui lo si conferma).
    // conteggi: [{ articolo_id, quantita }]. Un articolo due volte è un errore di chi chiama: vale l'ultimo.
    async registraInventario(conteggi) {
      const ultimi = new Map();
      (conteggi || []).forEach((c) => {
        const n = Number(c.quantita);
        if (c.articolo_id && Number.isFinite(n) && n >= 0) ultimi.set(c.articolo_id, Math.round(n * 1e4) / 1e4);
      });
      if (!ultimi.size) throw new ErroreDato("Nell'inventario non c'è nessun numero.");
      const adesso = new Date().toISOString();
      const io = archivio.utente().id;
      const righe = Array.from(ultimi.entries()).map(([articoloId, q]) => Object.assign({ id: nuovoId(), tipo: "conteggio",
        articolo_id: articoloId, quantita: q, avvenuto_il: adesso, origine: "manuale", autore_id: io, nota: "inventario" }, qui));
      for (let i = 0; i < righe.length; i += 300) await archivio.inserisci("movimenti", righe.slice(i, i + 300));
      return righe.length;
    },
    // Quando è stata fatta l'ultima chiusura di cassa che è già nel registro (millisecondi), o null.
    async ultimaChiusuraCassa() {
      let ultimo = null;
      (await tutta("movimenti")).forEach((m) => {
        if (m.tipo !== "vendita" || m.origine !== "cassa") return;
        const t = Date.parse(m.avvenuto_il);
        if (Number.isFinite(t) && (ultimo == null || t > ultimo)) ultimo = t;
      });
      return ultimo;
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

    // ----- fatture dei fornitori -----
    async fatture() {
      return (await tutta("fatture")).slice().sort((x, y) => String(y.data).localeCompare(String(x.data)) || String(y.numero).localeCompare(String(x.numero)));
    },
    async abbinamenti() { return tutta("abbinamenti_fornitore"); },
    // I movimenti di carico ancora validi (non annullati) nati da una fattura.
    async carichiDiFattura(fatturaId) {
      const movimenti = await tutta("movimenti");
      const annullati = new Set(movimenti.filter((m) => m.tipo === "annullamento").map((m) => m.annulla_id));
      return movimenti.filter((m) => m.tipo === "carico" && carico.eDellaFattura(m, fatturaId) && !annullati.has(m.id));
    },
    // Carica in magazzino una fattura rivista.
    //  testata: { fornitore_id, fornitoreNome, numero, data, imponibile, impronta, origine }
    //  righe: quelle di carico.prepara(), con le decisioni prese a schermo.
    // L'ordine delle scritture è pensato perché un'interruzione a metà non faccia danni: la fattura
    // nasce «da caricare», diventa «caricata» solo alla fine, e rifacendo il carico le righe già
    // entrate non si ripetono.
    async caricaFattura(testata, righe) {
      if (!testata.fornitore_id) throw new ErroreDato("Manca il fornitore della fattura.");
      if (!String(testata.numero || "").trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(testata.data || ""))) {
        throw new ErroreDato("Non ho letto il numero o la data della fattura: senza non posso riconoscerla la prossima volta.");
      }
      const manca = righe.filter((r) => !carico.decisa(r)).length;
      if (manca) throw new ErroreDato(manca === 1 ? "Resta una riga da decidere: scegli l'articolo e la quantità, oppure saltala."
        : "Restano " + manca + " righe da decidere: per ognuna scegli l'articolo e la quantità, oppure saltala.");
      const [fatture, abbinamenti] = await Promise.all([tutta("fatture"), tutta("abbinamenti_fornitore")]);
      const gia = carico.trovaFattura(fatture, testata.fornitore_id, testata.numero, testata.data);
      if (gia && gia.stato === "caricata") throw new ErroreDato("Questa fattura è già stata caricata: non la carico due volte.");
      const id = gia ? gia.id : nuovoId();
      const fatte = new Set((gia ? await api.carichiDiFattura(id) : []).map((m) => m.riferimento));
      const piano = carico.componi({ fatturaId: id, ristoranteId: ristoranteId, fornitoreId: testata.fornitore_id,
        fornitoreNome: testata.fornitoreNome, numero: String(testata.numero).trim(), data: gia ? String(gia.data).slice(0, 10) : testata.data,
        autoreId: archivio.utente().id, nuovoId: nuovoId }, righe, abbinamenti.map((a) => Object.assign({}, a)), fatte);

      if (piano.abbinamentiNuovi.length) await archivio.inserisci("abbinamenti_fornitore", piano.abbinamentiNuovi);
      for (const c of piano.abbinamentiCambi) await archivio.modifica("abbinamenti_fornitore", { id: c.id, ristorante_id: ristoranteId }, c.cambi);
      const corpo = { imponibile: testata.imponibile == null ? null : testata.imponibile, impronta: testata.impronta || "",
        origine: testata.origine || "pdf", righe: JSON.stringify(piano.righe), stato: "da_caricare" };
      if (gia) await modifica("fatture", id, corpo);
      else await archivio.inserisci("fatture", Object.assign({ id: id, fornitore_id: testata.fornitore_id,
        numero: String(testata.numero).trim(), data: testata.data }, qui, corpo));
      if (piano.movimenti.length) await archivio.inserisci("movimenti", piano.movimenti);
      if (piano.prezzi.length) await archivio.inserisci("prezzi", piano.prezzi);
      await modifica("fatture", id, { stato: "caricata" });
      // Se c'era un ordine che aspettava la fattura di questo fornitore, ora non aspetta più.
      let ordine = null;
      try {
        ordine = regoleOrdini.ordinePerFattura(await tutta("ordini"), testata.fornitore_id, gia ? gia.data : testata.data);
        if (ordine) await modifica("ordini", ordine.id, { stato: "chiuso", fattura_id: id });
      } catch (e) { ordine = null; } // la fattura è caricata comunque; l'ordine si chiude a mano
      return { id: id, caricate: piano.movimenti.length, ordine: ordine ? ordine.id : null };
    },
    // Annulla il carico di una fattura: ogni suo movimento viene annullato (non cancellato) e i
    // prezzi che aveva portato escono dal confronto. La fattura resta in elenco, segnata «annullata».
    async annullaFattura(fattura) {
      const vivi = await api.carichiDiFattura(fattura.id);
      const adesso = new Date().toISOString();
      const io = archivio.utente().id;
      if (vivi.length) {
        await archivio.inserisci("movimenti", vivi.map((m) => Object.assign({ id: nuovoId(), tipo: "annullamento",
          annulla_id: m.id, avvenuto_il: adesso, origine: "manuale", autore_id: io, nota: "annullato il carico della fattura " + fattura.numero }, qui)));
        for (const m of vivi) {
          await archivio.modifica("prezzi", { origine: "movimento:" + m.id, ristorante_id: ristoranteId }, { annullato_il: adesso });
        }
      }
      await modifica("fatture", fattura.id, { stato: "annullata" });
      return vivi.length;
    },

    // ----- la cassetta della posta (non sta nella copia sul dispositivo: si legge dal vivo, e serve la rete) -----
    // Gli allegati arrivati per posta, dal più recente. Senza rete: nessuno, e si riprova dopo.
    async posta() {
      try { return await archivioVero.leggi("posta_arrivata", qui, "creato_il.desc"); }
      catch (e) { if (e.tipo === "rete") return []; throw e; }
    },
    async filePosta(id) {
      const r = await archivioVero.leggi("posta_file", { id: id, ristorante_id: ristoranteId });
      if (!r.length) throw new ErroreDato("Non trovo più il file di questa email.");
      return r[0].contenuto;
    },
    // Un allegato scartato non serve più: se ne cancella il contenuto (resta la riga, col motivo). «-» = svuotato.
    svuotaFilePosta(id) { return archivioVero.modifica("posta_file", { id: id, ristorante_id: ristoranteId }, { contenuto: "-" }); },
    segnaPosta(id, cambi) { return archivioVero.modifica("posta_arrivata", { id: id, ristorante_id: ristoranteId }, cambi); },
    // Una fattura riconosciuta nella posta entra in elenco come «arrivata, da caricare». Se c'è già, resta quella.
    async registraArrivata(testata) {
      const gia = carico.trovaFattura(await tutta("fatture"), testata.fornitore_id, testata.numero, testata.data);
      if (gia) return gia;
      if (!String(testata.numero || "").trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(testata.data || ""))) {
        throw new ErroreDato("Fattura senza numero o senza data: non posso riconoscerla.");
      }
      const r = await archivio.inserisci("fatture", Object.assign({ id: nuovoId(), fornitore_id: testata.fornitore_id,
        numero: String(testata.numero).trim(), data: testata.data, imponibile: testata.imponibile == null ? null : testata.imponibile,
        stato: "da_caricare", origine: "posta", impronta: testata.impronta || "", righe: "[]" }, qui));
      return r[0];
    },
    // La chiave del raccoglitore: quella attiva (senza il segreto, che l'archivio non conserva), crearla, spegnerla.
    async chiavePosta() {
      const r = await archivioVero.leggi("chiavi_posta", qui, "creato_il.desc");
      return r.find((k) => k.attiva) || null;
    },
    creaChiavePosta() { return archivioVero.funzione("crea_chiave_posta", { r: ristoranteId }); },
    spegniChiavePosta(id) { return archivioVero.modifica("chiavi_posta", { id: id, ristorante_id: ristoranteId }, { attiva: false }); },

    // ----- chiusure di cassa (come la posta: si leggono dal vivo, solo il titolare) -----
    async chiusure() {
      try { return await archivioVero.leggi("chiusure_arrivate", qui, "nome_file.asc"); }
      catch (e) { if (e.tipo === "rete") return []; throw e; }
    },
    async collegamentiCassa() { return (await tutta("collegamenti_piatto")).filter((c) => c.sistema === "cassa"); },
    // Scrive nel registro le vendite che mancano di un gruppo di chiusure, in una volta sola: il registro si legge
    // una volta, le vendite partono insieme. Le voci senza piatto restano in attesa.
    async registraChiusure(lista) {
      const esito = { vendite: 0, nuove: 0, scartate: 0, perChiusura: [] };
      if (!lista.length) return esito;
      const [collegamenti, movimenti] = await Promise.all([tutta("collegamenti_piatto"), tutta("movimenti")]);
      const extra = Object.assign({ autore_id: archivio.utente().id }, qui);
      const righe = [], daSegnare = [];
      for (const chiusura of lista) {
        const valori = cassa.grigliaDi(chiusura.valori, leggiXls);
        const voci = valori ? cassa.leggiChiusura(valori) : [];
        if (!voci.length || !cassa.quandoChiusura(chiusura.nome_file)) {
          if (chiusura.stato !== "scartata") {
            await archivioVero.modifica("chiusure_arrivate", { id: chiusura.id, ristorante_id: ristoranteId },
              { stato: "scartata", nota: !voci.length ? "Nel foglio non trovo voci vendute." : "Dal nome del file non capisco giorno e ora della chiusura." });
            chiusura.stato = "scartata";
          }
          esito.scartate += 1;
          esito.perChiusura.push({ vendite: 0, senzaPiatto: 0, scartata: true });
          continue;
        }
        const piano = cassa.daRegistrare(chiusura, voci, collegamenti, movimenti, extra);
        piano.vendite.forEach((v) => righe.push(Object.assign({ id: nuovoId() }, v)));
        if (chiusura.stato !== "registrata") daSegnare.push(chiusura);
        esito.perChiusura.push({ vendite: piano.vendite.length, senzaPiatto: piano.senzaPiatto.length, scartata: false });
      }
      for (let i = 0; i < righe.length; i += 300) await archivio.inserisci("movimenti", righe.slice(i, i + 300));
      for (const chiusura of daSegnare) {
        await archivioVero.modifica("chiusure_arrivate", { id: chiusura.id, ristorante_id: ristoranteId }, { stato: "registrata", nota: "" });
        chiusura.stato = "registrata";
      }
      esito.vendite = righe.length;
      esito.nuove = daSegnare.length;
      return esito;
    },
    async registraChiusura(chiusura) { return (await api.registraChiusure([chiusura])).perChiusura[0]; },
    // Una voce di cassa è questo piatto. Da qui in poi (e per le chiusure già arrivate) le sue vendite contano.
    async collegaVoceCassa(codice, piattoId) {
      const r = await archivio.inserisci("collegamenti_piatto", Object.assign({ id: nuovoId(), piatto_id: piattoId,
        sistema: "cassa", chiave: cassa.codiceCassa(codice) }, qui));
      return r[0];
    },
    // Una voce di cassa nuova: nasce il piatto (con la distinta da fare, oppure senza merce) e si collega.
    async creaPiattoDaVoce(voce, senzaMerce) {
      const dati = controlla(convalida.piatto({ nome: voce.descrizione || "Voce di cassa " + voce.codice, categoria: senzaMerce ? "Senza merce" : "",
        prezzo_listino: voce.quantita > 0 && voce.importo > 0 ? Math.round(voce.importo / voce.quantita * 100) / 100 : "", senza_merce: !!senzaMerce }));
      if (dati.senza_merce) dati.stato = "attivo";
      const piatto = await creaConCodice("piatti", "piatto", dati);
      await api.collegaVoceCassa(voce.codice, piatto.id);
      return piatto;
    },

    // ----- preventivi dei fornitori (si leggono dal vivo, solo il titolare) -----
    async preventivi() {
      try { return await archivioVero.leggi("preventivi", qui, "creato_il.desc"); }
      catch (e) { if (e.tipo === "rete") return []; throw e; }
    },
    // Crea la richiesta e il suo link. Il fornitore può essere uno dei propri o un nome nuovo: in quel caso nasce adesso.
    // Restituisce { preventivo, gettone }: il gettone (il link) esiste solo qui, nell'archivio va la sua impronta.
    async creaPreventivo(nomeFornitore, giorni, articoli) {
      const nome = String(nomeFornitore || "").trim();
      if (!nome) throw new ErroreDato("Scrivi a quale fornitore va il preventivo.");
      if (!articoli.length) throw new ErroreDato("Scegli almeno una categoria: il link deve avere degli articoli.");
      let scade = null;
      if (String(giorni == null ? "" : giorni).trim() !== "") {
        scade = preventivi.scadeFra(giorni);
        if (!scade) throw new ErroreDato("I giorni di validità sono un numero da 1 a 365.");
      }
      const tutti = await api.fornitori();
      const fornitore = tutti.find((f) => f.nome.trim().toLowerCase() === nome.toLowerCase()) || await api.salvaFornitore({ nome: nome }, tutti);
      const gettone = preventivi.nuovoGettone();
      const r = await archivioVero.inserisci("preventivi", Object.assign({ id: nuovoId(), fornitore_id: fornitore.id,
        impronta: await preventivi.improntaDi(gettone), stato: "aperto", scade: scade,
        articoli: JSON.stringify(articoli.map((a) => ({ id: a.id, nome: a.nome, udm: a.udm }))) }, qui));
      return { preventivo: r[0], gettone: gettone, fornitore: fornitore };
    },
    segnaPreventivo(id, stato) { return archivioVero.modifica("preventivi", { id: id, ristorante_id: ristoranteId }, { stato: stato }); },
    // «Carica»: i prezzi del preventivo entrano nel confronto prezzi (come preventivi, non come fatture) e,
    // dove il fornitore ha scritto il suo codice, lo si ricorda per riconoscere l'articolo quando arriverà la fattura.
    async caricaPreventivo(p, associa, escluse) {
      const [articoli, abbinamenti] = await Promise.all([api.articoli(), tutta("abbinamenti_fornitore")]);
      const piano = preventivi.prezziDaCaricare(p, associa, articoli, null, escluse);
      if (!piano.prezzi.length) throw new ErroreDato("In questo preventivo non c'è nessun prezzo che posso caricare." + (piano.saltate.length ? " " + piano.saltate.join("; ") + "." : ""));
      await archivio.inserisci("prezzi", piano.prezzi.map((x) => Object.assign({ id: nuovoId(), articolo_id: x.articolo_id, fornitore_id: x.fornitore_id,
        tipo: x.tipo, data: x.data, prezzo_udm: x.prezzo_udm, qta_confezione: x.qta_confezione, origine: x.origine }, qui)));
      const noti = carico.indice(abbinamenti, p.fornitore_id);
      const nuovi = [];
      piano.prezzi.forEach((x) => {
        const codice = carico.chiaveCodice(x.codice);
        if (!codice || noti.has(codice)) return;
        noti.set(codice, true);
        nuovi.push(Object.assign({ id: nuovoId(), fornitore_id: p.fornitore_id, codice: codice, descrizione: "", articolo_id: x.articolo_id }, qui));
      });
      if (nuovi.length) { try { await archivio.inserisci("abbinamenti_fornitore", nuovi); } catch (e) { /* i codici sono un di più: i prezzi sono entrati */ } }
      await api.segnaPreventivo(p.id, "caricato");
      return { caricati: piano.prezzi.length, saltate: piano.saltate };
    },
    // Toglie dal confronto i prezzi di un preventivo già caricato (non li cancella: li annulla).
    async togliPrezziPreventivo(preventivoId) {
      return archivio.modifica("prezzi", { origine: "prev:" + preventivoId, ristorante_id: ristoranteId }, { annullato_il: new Date().toISOString() });
    },
    async prezziDaPreventivi() {
      return (await tutta("prezzi")).filter((x) => String(x.origine || "").startsWith("prev:") && !x.annullato_il);
    },

    // ----- ordini ai fornitori -----
    async ordini() {
      return (await tutta("ordini")).slice().sort((x, y) => String(y.inviato_il).localeCompare(String(x.inviato_il)));
    },
    // righe: [{ articolo_id, nome, udm, quantita, colli, qtaConfezione }]. Da qui il programma aspetta la fattura.
    // opz.diPersona: la merce è già stata ritirata; la fattura si aspetta comunque, almeno un giorno lavorativo.
    async creaOrdine(fornitore, righe, nota, opz) {
      const buone = (righe || []).filter((r) => r.articolo_id && Number(r.quantita) > 0);
      if (!fornitore || !fornitore.id) throw new ErroreDato("Manca il fornitore dell'ordine.");
      if (!buone.length) throw new ErroreDato("Nell'ordine non c'è niente: scrivi almeno una quantità.");
      const adesso = new Date();
      const r = await archivio.inserisci("ordini", Object.assign({ id: nuovoId(), fornitore_id: fornitore.id, stato: "aperto",
        inviato_il: adesso.toISOString(),
        attesa_entro: regoleOrdini.scadenza(adesso, opz && opz.diPersona ? Math.max(1, regoleOrdini.giorniDi(fornitore)) : regoleOrdini.giorniDi(fornitore)),
        righe: JSON.stringify(buone.map((x) => ({ articolo_id: x.articolo_id, nome: x.nome, udm: x.udm,
          quantita: Math.round(Number(x.quantita) * 1e4) / 1e4, colli: x.colli == null ? null : Number(x.colli),
          qtaConfezione: x.qtaConfezione ? Number(x.qtaConfezione) : null }))),
        nota: (opz && opz.diPersona ? regoleOrdini.DI_PERSONA + (String(nota || "").trim() ? ": " : "") : "") + String(nota || "").trim() }, qui));
      return r[0];
    },
    chiudiOrdine(ordine) { return modifica("ordini", ordine.id, { stato: "chiuso" }); },
    annullaOrdine(ordine) { return modifica("ordini", ordine.id, { stato: "annullato" }); },
    riapriOrdine(ordine) { return modifica("ordini", ordine.id, { stato: "aperto", fattura_id: null }); },

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
