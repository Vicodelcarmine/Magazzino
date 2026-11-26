// Controlli sui dati prima di scriverli. Funzioni pure: niente rete, niente pagina.
// Ogni funzione restituisce { ok: true, dati } oppure { ok: false, errore }.
import { parseNumero, pulisci } from "./numeri.js";

export const UNITA = ["kg", "L", "pz"];

function no(errore) { return { ok: false, errore: errore }; }

function doppio(esistenti, campo, valore, mioId) {
  const k = String(valore).toLocaleLowerCase("it");
  return (esistenti || []).some((e) => e.id !== mioId && String(e[campo] || "").toLocaleLowerCase("it") === k);
}

function numeroNonNegativo(valore) {
  if (valore == null || String(valore).trim() === "") return 0;
  const n = parseNumero(valore);
  return n == null || n < 0 ? null : n;
}

export function fornitore(input, esistenti) {
  const nome = pulisci(input.nome);
  if (!nome) return no("Scrivi il nome del fornitore.");
  if (doppio(esistenti, "nome", nome, input.id)) return no("C'è già un fornitore con questo nome.");
  // Giorni lavorativi entro cui arriva la sua fattura dopo un ordine: vuoto = termine generale, 0 = non si aspetta.
  let giorni = null;
  if (input.giorni_fattura != null && String(input.giorni_fattura).trim() !== "") {
    giorni = Number(String(input.giorni_fattura).trim());
    if (!Number.isInteger(giorni) || giorni < 0 || giorni > 60) return no("I giorni di attesa della fattura sono un numero intero fra 0 e 60.");
  }
  return { ok: true, dati: { nome: nome, note: pulisci(input.note), attivo: input.attivo !== false, giorni_fattura: giorni } };
}

// I codici non passano di qui: li assegna il sistema (codici.js, dati.js).
export function articolo(input) {
  const nome = pulisci(input.nome);
  if (!nome) return no("Scrivi il nome dell'articolo.");
  if (UNITA.indexOf(input.udm) < 0) return no("Scegli l'unità di misura.");
  const tipo = input.tipo === "tempo" ? "tempo" : "ricetta";
  const conf = numeroNonNegativo(input.qta_confezione);
  if (conf == null) return no("Il contenuto della confezione non è un numero.");
  const dati = {
    nome: nome,
    categoria: pulisci(input.categoria),
    udm: input.udm,
    tipo: tipo,
    qta_confezione: conf,
    acquisto_sfuso: !!input.acquisto_sfuso,
    attivo: input.attivo !== false,
  };
  // Il fornitore fisso si tocca solo dove lo si può scegliere: i moduli corti non lo cancellano.
  if (Object.prototype.hasOwnProperty.call(input, "fornitore_fisso_id")) dati.fornitore_fisso_id = input.fornitore_fisso_id || null;
  return { ok: true, dati: dati };
}

export function piatto(input) {
  const nome = pulisci(input.nome);
  if (!nome) return no("Scrivi il nome del piatto.");
  let prezzo = null;
  if (input.prezzo_listino != null && String(input.prezzo_listino).trim() !== "") {
    prezzo = parseNumero(input.prezzo_listino);
    if (prezzo == null || prezzo < 0) return no("Il prezzo di listino non è un numero.");
  }
  return {
    ok: true,
    // senza_merce: una voce che si vende ma non consuma magazzino (coperto, acqua alla spina).
    dati: { nome: nome, categoria: pulisci(input.categoria), prezzo_listino: prezzo, senza_merce: input.senza_merce === true },
  };
}

// Una preparazione è un articolo fatto in cucina, con una ricetta sua.
export function preparazione(input) {
  const nome = pulisci(input.nome);
  if (!nome) return no("Scrivi il nome della preparazione.");
  if (UNITA.indexOf(input.udm) < 0) return no("Scegli l'unità di misura.");
  const lotto = parseNumero(input.lotto_abituale);
  if (lotto == null || !(lotto > 0)) return no("Scrivi quanta ne prepari di solito (un numero maggiore di zero).");
  return {
    ok: true,
    dati: {
      nome: nome, categoria: pulisci(input.categoria), udm: input.udm, tipo: "ricetta",
      prodotto_in_cucina: true, lotto_abituale: lotto, attivo: input.attivo !== false,
    },
  };
}

// righePrep: le righe aperte delle ricette di TUTTE le preparazioni.
// Dice se la preparazione «da» contiene «cerca», anche attraverso altre preparazioni.
export function contiene(righePrep, da, cerca, visti) {
  const gia = visti || new Set();
  if (gia.has(da)) return false;
  gia.add(da);
  return (righePrep || []).some((r) => r.preparazione_id === da
    && (r.articolo_id === cerca || contiene(righePrep, r.articolo_id, cerca, gia)));
}

// Gli articoli che NON possono entrare nella ricetta di una preparazione:
// lei stessa e le preparazioni che la contengono già (sarebbe un giro senza fine).
export function vietatiPer(preparazioneId, righePrep) {
  const out = new Set([preparazioneId]);
  (righePrep || []).forEach((r) => {
    if (contiene(righePrep, r.preparazione_id, preparazioneId)) out.add(r.preparazione_id);
  });
  return out;
}

// righeAperte: le righe della distinta oggi valide (valida_al vuoto).
export function rigaRicetta(input, righeAperte) {
  if (!input.articolo_id) return no("Scegli l'ingrediente.");
  const q = parseNumero(input.quantita);
  if (q == null || !(q > 0)) return no("Scrivi la quantità (un numero maggiore di zero).");
  const gia = (righeAperte || []).some((r) => r.articolo_id === input.articolo_id && r.id !== input.id);
  if (gia) return no("Questo ingrediente è già nella distinta: cambia la sua quantità.");
  return { ok: true, dati: { articolo_id: input.articolo_id, quantita: q } };
}

export function righeAperte(righe) {
  return (righe || []).filter((r) => r.valida_al == null);
}
