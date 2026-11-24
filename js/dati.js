// Le operazioni dell'app sui dati di UN ristorante: controlla, poi scrive nell'archivio.
import * as convalida from "./convalida.js";
import { nuovoId, parseNumero } from "./numeri.js";
import { inBase } from "./unita.js";
import { codiceNuovo } from "./codici.js";
import { datiEsempio, ORDINE_ESEMPIO } from "./demo.js";
import { COPIATE, allineaTabella } from "./allinea.js";
import { accoda, applica, inCoda, riapplica, spedisci } from "./coda.js";
import * as carico from "./fatture/carico.js";

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
      return { id: id, caricate: piano.movimenti.length };
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
