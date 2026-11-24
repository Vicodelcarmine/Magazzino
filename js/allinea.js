// Tiene la copia sul dispositivo allineata con l'archivio, scaricando solo le novità.
//
// Ogni riga dell'archivio porta «seq», un numero che cresce a ogni riga nuova o modificata.
// Il dispositivo ricorda l'ultimo numero che ha («segno») e chiede solo ciò che viene dopo.
// Nell'archivio niente si cancella mai, quindi «ciò che viene dopo» è davvero tutto ciò che manca.

// Le tabelle che si tengono in copia (ristoranti e appartenenze sono poche righe: si leggono sempre dal vivo).
export const COPIATE = ["fornitori", "articoli", "piatti", "collegamenti_piatto", "righe_ricetta", "prezzi", "movimenti", "abbinamenti_fornitore", "fatture", "ordini"];

// Due scritture quasi contemporanee possono arrivare nell'archivio in ordine diverso dai loro numeri:
// per non perdere quella «rimasta indietro» si richiede ogni volta anche un po' di ciò che si ha già
// (gli ultimi numeri). Riscaricare qualche riga in più non fa danni: ogni riga sostituisce se stessa.
// Il margine può restare piccolo perché dopo c'è comunque la riprova sul numero delle righe.
export const MARGINE = 25;

function massimo(righe, base) {
  return righe.reduce((m, r) => (Number(r.seq) > m ? Number(r.seq) : m), base);
}

export async function allineaTabella(archivio, copia, spazio, ristoranteId, tabella) {
  const filtro = { ristorante_id: ristoranteId };
  const segno = await copia.segno(spazio, tabella);
  let scaricate, rifatta = false;
  if (!segno) {
    scaricate = await archivio.leggi(tabella, filtro, "seq.asc");
    await copia.sostituisci(spazio, tabella, scaricate);
    rifatta = true;
  } else {
    scaricate = await archivio.leggi(tabella, Object.assign({ seq: { dopo: Math.max(0, segno - MARGINE) } }, filtro), "seq.asc");
    await copia.metti(spazio, tabella, scaricate);
  }
  await copia.mettiSegno(spazio, tabella, massimo(scaricate, segno));

  // Riprova: se l'archivio ha anche solo una riga oltre quelle che ho, qualcosa è sfuggito.
  // In quel caso non si indovina: si riscarica la tabella intera.
  const quante = await copia.conta(spazio, tabella);
  const oltre = await archivio.leggiPagina(tabella, filtro, "seq.asc", 1, quante);
  if (oltre.length) {
    const tutte = await archivio.leggi(tabella, filtro, "seq.asc");
    await copia.sostituisci(spazio, tabella, tutte);
    await copia.mettiSegno(spazio, tabella, massimo(tutte, 0));
    return { scaricate: tutte.length, rifatta: true };
  }
  return { scaricate: scaricate.length, rifatta: rifatta };
}

export async function allineaTutto(archivio, copia, spazio, ristoranteId) {
  const esiti = await Promise.all(COPIATE.map((t) => allineaTabella(archivio, copia, spazio, ristoranteId, t)));
  return { scaricate: esiti.reduce((s, e) => s + e.scaricate, 0), rifatte: esiti.filter((e) => e.rifatta).length };
}
