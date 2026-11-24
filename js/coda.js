// La coda delle operazioni fatte senza rete.
//
// Quando una scrittura non riesce a partire perché manca la rete, non si perde e non blocca:
//  1. viene messa in coda sul dispositivo (resta anche se si chiude l'app);
//  2. viene applicata subito alla copia locale, così a schermo si vede già;
//  3. appena la rete torna, parte verso l'archivio, nell'ordine in cui è stata fatta.
//
// Rispedire la stessa operazione due volte non crea doppioni: ogni riga ha un'identità creata
// dal dispositivo, e l'archivio salta quelle che ha già.
//
// Se l'archivio RIFIUTA un'operazione (non per la rete: per esempio un permesso che manca),
// non la si riprova all'infinito e non la si butta: resta in coda segnata «rifiutata», col motivo,
// e la decide chi usa l'app.

// Quello che l'archivio mette da solo su una riga nuova: qui serve per mostrarla subito a schermo.
const PREDEFINITI = {
  fornitori: { note: "", attivo: true, giorni_fattura: null },
  ordini: { stato: "aperto", attesa_entro: null, fattura_id: null, righe: "[]", nota: "" },
  articoli: { categoria: "", tipo: "ricetta", qta_confezione: 0, acquisto_sfuso: false, prodotto_in_cucina: false,
    consumo_stimato: null, giorni_copertura: null, lotto_abituale: null, attivo: true },
  piatti: { categoria: "", prezzo_listino: null, stato: "da_completare", senza_merce: false },
  collegamenti_piatto: {},
  righe_ricetta: { piatto_id: null, preparazione_id: null, valida_al: null },
  prezzi: { qta_confezione: 0, valido_fino: null, origine: "", annullato_il: null },
  movimenti: { articolo_id: null, piatto_id: null, annulla_id: null, quantita: null, importo_unitario: null,
    fornitore_id: null, qta_confezione: null, acquisto_diretto: false, origine: "manuale", riferimento: "", nota: "",
    dispositivo: "" },
  abbinamenti_fornitore: { descrizione: "", articolo_id: null, salta: false, contenuto: null },
  fatture: { imponibile: null, stato: "da_caricare", origine: "pdf", impronta: "", righe: "[]", nota: "" },
};
const DATE = { fornitori: ["creato_il", "aggiornato_il"], articoli: ["creato_il", "aggiornato_il"],
  piatti: ["creato_il", "aggiornato_il"], collegamenti_piatto: ["creato_il"], prezzi: ["creato_il"],
  righe_ricetta: ["valida_dal", "creato_il"], movimenti: ["registrato_il"],
  abbinamenti_fornitore: ["creato_il", "aggiornato_il"], fatture: ["creato_il", "aggiornato_il"],
  ordini: ["creato_il", "aggiornato_il"] };

export function conPredefiniti(tabella, riga, quando) {
  const out = Object.assign({}, PREDEFINITI[tabella] || {}, riga);
  (DATE[tabella] || []).forEach((c) => { if (out[c] == null) out[c] = quando; });
  return out;
}

// Applica un'operazione alla copia locale, come farà l'archivio quando la riceverà.
export async function applica(copia, spazio, op) {
  if (op.tipo === "inserisci") {
    await copia.metti(spazio, op.tabella, op.righe.map((r) => conPredefiniti(op.tabella, r, op.quando)));
    return op.righe.map((r) => conPredefiniti(op.tabella, r, op.quando));
  }
  const campi = Object.keys(op.filtri);
  const toccate = (await copia.leggi(spazio, op.tabella))
    .filter((r) => campi.every((c) => r[c] === op.filtri[c]))
    .map((r) => Object.assign({}, r, op.cambi));
  await copia.metti(spazio, op.tabella, toccate);
  return toccate;
}

let contatore = 0;
// Mette un'operazione in coda e la applica alla copia. Restituisce le righe come si vedono ora.
export async function accoda(copia, spazio, op) {
  contatore = (contatore + 1) % 1000;
  const completa = Object.assign({}, op, { n: Date.now() * 1000 + contatore, stato: "attesa", quando: new Date().toISOString() });
  await copia.codaMetti(spazio, completa);
  return applica(copia, spazio, completa);
}

export async function inCoda(copia, spazio) {
  const tutte = await copia.codaTutte(spazio);
  return { attesa: tutte.filter((o) => o.stato === "attesa"), rifiutate: tutte.filter((o) => o.stato === "rifiutata") };
}

// Dopo aver riscaricato dall'archivio, le operazioni ancora in attesa vanno rimesse sopra la copia,
// altrimenti a schermo sparirebbero finché non partono.
export async function riapplica(copia, spazio) {
  for (const op of (await inCoda(copia, spazio)).attesa) await applica(copia, spazio, op);
}

async function manda(archivio, op) {
  if (op.tipo === "inserisci") await archivio.inserisci(op.tabella, op.righe, { saltaDoppioni: true });
  else await archivio.modifica(op.tabella, op.filtri, op.cambi);
}

// Spedisce le operazioni in attesa, in ordine. Si ferma alla prima che non parte per la rete.
// opz.ricodifica(op) → righe col codice rifatto, per quando il codice scelto senza rete è già stato preso.
export async function spedisci(archivio, copia, spazio, opz) {
  const esito = { spedite: 0, rifiutate: 0, ferme: 0, tabelle: new Set() };
  const attese = (await inCoda(copia, spazio)).attesa;
  for (let i = 0; i < attese.length; i += 1) {
    const op = attese[i];
    let tentativi = 0;
    for (;;) {
      try {
        await manda(archivio, op);
        await copia.codaTogli(spazio, op.n);
        esito.spedite += 1;
        esito.tabelle.add(op.tabella);
        break;
      } catch (e) {
        if (e.tipo === "rete" || e.tipo === "sessione") { // non è un no: è che non si riesce a parlare con l'archivio
          esito.ferme = attese.length - i;
          return esito;
        }
        const codicePreso = e.tipo === "doppione" && op.tipo === "inserisci" && opz && opz.ricodifica
          && (op.tabella === "articoli" || op.tabella === "piatti") && tentativi < 3;
        if (codicePreso) {
          tentativi += 1;
          op.righe = await opz.ricodifica(op);
          await copia.codaMetti(spazio, op);
          await applica(copia, spazio, op);
          continue;
        }
        op.stato = "rifiutata";
        op.motivo = e.message || "L'archivio ha rifiutato l'operazione.";
        await copia.codaMetti(spazio, op);
        // Quello che si era mostrato a schermo non è vero: la tabella va riscaricata da capo.
        await copia.mettiSegno(spazio, op.tabella, 0);
        esito.rifiutate += 1;
        esito.tabelle.add(op.tabella);
        break;
      }
    }
  }
  return esito;
}

// Una frase che dice cos'è un'operazione, per mostrarla in elenco.
export function descrivi(op) {
  const r = op.tipo === "inserisci" ? op.righe[0] || {} : op.cambi || {};
  if (op.tabella === "movimenti") {
    const nomi = { conteggio: "Conteggio", carico: "Arrivo di merce", correzione: "Merce buttata o corretta", annullamento: "Annullamento di un movimento" };
    return (nomi[r.tipo] || "Movimento") + (r.quantita != null ? " (" + Math.abs(r.quantita) + ")" : "");
  }
  const cosa = { articoli: "articolo", piatti: "piatto", fornitori: "fornitore", righe_ricetta: "riga di ricetta", prezzi: "prezzo", collegamenti_piatto: "codice di cassa",
    abbinamenti_fornitore: "codice di un fornitore", fatture: "fattura", ordini: "ordine" }[op.tabella] || op.tabella;
  return (op.tipo === "inserisci" ? "Nuovo " : "Modifica a ") + cosa + (r.nome ? " «" + r.nome + "»" : "");
}
