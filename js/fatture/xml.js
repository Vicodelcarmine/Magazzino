// Lettore delle fatture elettroniche in XML (il formato di Stato «FatturaPA»), quelle che arrivano
// dal Sistema di Interscambio e che si trovano nel cassetto fiscale. Vale per qualunque fornitore.
//
// Restituisce la stessa forma del lettore Metro (metro.js), così tutto ciò che viene dopo
// (rivedere, abbinare, caricare) è uguale. Qui c'è molto meno da indovinare che in un PDF:
// quantità, prezzo e totale di riga sono campi scritti, non testo da interpretare.

const TOL = 0.05;
const soldi = (n) => Math.round(n * 100) / 100;

function numero(testo) {
  if (testo == null) return null;
  const t = String(testo).trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// I nomi dei campi si cercano senza badare al prefisso (alcuni programmi lo mettono, altri no).
function figli(el, nome) {
  return el ? Array.from(el.children).filter((c) => c.localName === nome) : [];
}
function figlio(el, percorso) {
  let qui = el;
  for (const nome of percorso.split("/")) {
    qui = figli(qui, nome)[0];
    if (!qui) return null;
  }
  return qui;
}
function testo(el, percorso) {
  const f = figlio(el, percorso);
  return f ? String(f.textContent || "").trim() : "";
}

// L'unità scritta in fattura, quando dice già la misura dell'articolo.
function misura(um) {
  const u = String(um || "").trim().toUpperCase().replace(/\./g, "");
  if (["KG", "KGM", "CHILI", "CHILOGRAMMI"].indexOf(u) >= 0) return "kg";
  if (["L", "LT", "LTR", "LITRI", "LITRO"].indexOf(u) >= 0) return "L";
  if (["PZ", "NR", "N", "NUM", "PEZZI", "PCE"].indexOf(u) >= 0) return "pz";
  return "";
}

// Vero se il testo sembra una fattura elettronica XML.
export function eFatturaXml(contenuto) {
  return /<([A-Za-z0-9]+:)?FatturaElettronica[\s>]/.test(String(contenuto || "").slice(0, 4000));
}

// contenuto: il testo del file XML. analizza (facoltativo): chi trasforma il testo in documento
// (nel browser c'è già; serve solo a poterlo sostituire).
export function leggi(contenuto, analizza) {
  const fallita = (errore) => ({ ok: false, errore: errore, fornitore: "", partitaIva: "", numero: "", data: "", imponibile: null,
    righe: [], avvisi: [errore], quadra: false, sommaRighe: 0, nettoRighe: 0, totaleSconti: 0, sconti: [] });
  let doc;
  try {
    doc = analizza ? analizza(contenuto) : new DOMParser().parseFromString(String(contenuto || "").replace(/^﻿/, ""), "application/xml");
  } catch (e) { return fallita("Il file non è un XML leggibile."); }
  const radice = doc && doc.documentElement;
  if (!radice || radice.localName !== "FatturaElettronica") return fallita("Questo file non è una fattura elettronica XML.");
  const corpi = figli(radice, "FatturaElettronicaBody");
  if (!corpi.length) return fallita("Nella fattura non trovo il corpo con le righe.");
  if (corpi.length > 1) return fallita("Questo file contiene più fatture insieme (" + corpi.length + "): per ora ne leggo una per file.");
  const corpo = corpi[0];

  const cedente = figlio(radice, "FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici");
  const fornitore = testo(cedente, "Anagrafica/Denominazione")
    || (testo(cedente, "Anagrafica/Nome") + " " + testo(cedente, "Anagrafica/Cognome")).trim();
  const generali = figlio(corpo, "DatiGenerali/DatiGeneraliDocumento");
  const tipo = testo(generali, "TipoDocumento");
  const beni = figlio(corpo, "DatiBeniServizi");
  const imponibili = figli(beni, "DatiRiepilogo").map((r) => numero(testo(r, "ImponibileImporto"))).filter((n) => n != null);
  const imponibile = imponibili.length ? soldi(imponibili.reduce((s, n) => s + n, 0)) : null;

  const righe = figli(beni, "DettaglioLinee").map((l) => {
    const codici = figli(l, "CodiceArticolo").map((c) => ({ tipo: testo(c, "CodiceTipo"), valore: testo(c, "CodiceValore") })).filter((c) => c.valore);
    const ean = codici.find((c) => /EAN|GTIN/i.test(c.tipo));
    const descrizione = testo(l, "Descrizione").replace(/\s+/g, " ");
    const q = numero(testo(l, "Quantita"));
    const prezzo = numero(testo(l, "PrezzoUnitario"));
    const totale = numero(testo(l, "PrezzoTotale"));
    const um = testo(l, "UnitaMisura");
    const base = {
      // Senza codice, la riga si riconosce dalla descrizione (è meno sicuro, ma è ciò che c'è).
      codice: codici.length ? codici[0].valore : (descrizione ? "D:" + descrizione.toUpperCase().replace(/[^A-Z0-9]+/g, "") : ""),
      gtin: ean && codici[0] !== ean ? ean.valore : "", descrizione: descrizione, udmFattura: um, iva: testo(l, "AliquotaIVA"),
      scontoFattura: 0, layout: "xml",
    };
    // Righe senza quantità o con importo negativo (trasporto, bolli, note, sconti in riga propria):
    // non sono merce da caricare così com'è. Un omaggio (quantità sì, importo zero) invece è merce: entra a costo zero.
    if (!(q > 0) || totale == null || totale < 0) {
      return Object.assign(base, { anomala: true, errore: !(q > 0) ? "riga senza quantità: spese, note o altro che non è merce"
        : "riga con importo negativo o mancante", qtaFattura: null, prezzo: null, importo: null, importoNetto: null,
        udm: "", qta: null, pesoVariabile: false, valore: totale });
    }
    const m = misura(um);
    return Object.assign(base, { anomala: false, errore: "", qtaFattura: q, prezzo: prezzo, importo: soldi(totale), importoNetto: soldi(totale),
      // «kg» in fattura: la quantità è già il peso. «L» e «pz»: è già la misura, se l'articolo usa la stessa.
      pesoVariabile: m === "kg", udm: m, qta: m ? q : null });
  });

  const valide = righe.filter((r) => !r.anomala);
  const altre = soldi(righe.filter((r) => r.anomala && r.valore != null).reduce((s, r) => s + r.valore, 0));
  const somma = soldi(valide.reduce((s, r) => s + r.importo, 0));
  const tutto = soldi(somma + altre);
  const quadra = imponibile != null && valide.length > 0 && Math.abs(tutto - imponibile) <= TOL;
  const avvisi = [];
  if (tipo === "TD04") avvisi.push("È una nota di credito: per ora non si carica da qui.");
  if (imponibile == null) avvisi.push("La fattura non riporta l'imponibile: non posso fare la riprova sulla somma delle righe.");
  if (!valide.length) avvisi.push("Non ho trovato righe di merce in questa fattura.");
  if (imponibile != null && valide.length && !quadra) {
    avvisi.push("La somma delle righe (" + tutto + ") non torna con l'imponibile della fattura (" + imponibile + ").");
  }
  const ok = valide.length > 0 && tipo !== "TD04";
  return {
    ok: ok, errore: ok ? "" : avvisi[0], fornitore: fornitore, partitaIva: testo(cedente, "IdFiscaleIVA/IdCodice"),
    tipoDocumento: tipo, numero: testo(generali, "Numero"), data: testo(generali, "Data").slice(0, 10), imponibile: imponibile,
    sommaRighe: somma, sconti: [], totaleSconti: 0, nettoRighe: tutto, quadra: quadra, righe: righe, avvisi: avvisi,
  };
}
