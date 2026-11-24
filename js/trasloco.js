// Porta un ristorante dall'archivio di prova (su questo Mac) all'archivio online.
// Legge da una parte e scrive dall'altra con gli accessi di chi sta usando l'app:
// nessuna chiave segreta, nessuna password di mezzo.
//
// Si può rifare senza danni: le righe già arrivate vengono saltate (ogni riga ha la sua identità).

// L'ordine conta: prima ciò a cui le altre righe si collegano.
export const TABELLE = ["fornitori", "articoli", "piatti", "collegamenti_piatto", "righe_ricetta", "prezzi", "movimenti", "abbinamenti_fornitore", "fatture", "ordini"];
const BLOCCO = 500;

// da, a: due archivi (creaArchivio). ristorante: la riga del ristorante di partenza.
// avanza(testo): chiamata a ogni passo, per far vedere a che punto si è.
export async function trasloca(da, a, ristorante, nome, avanza) {
  const dice = avanza || (() => {});
  const filtro = { ristorante_id: ristorante.id };
  const io = a.utente().id;

  // 1. Il ristorante di arrivo: stessa identità di quello di partenza, così i collegamenti restano validi.
  const gia = await a.leggi("ristoranti", { id: ristorante.id });
  if (!gia.length) {
    dice("Creo il ristorante online…");
    await a.funzione("crea_ristorante", { id: ristorante.id, nome: nome, demo: false });
  } else {
    dice("Il ristorante online esiste già: aggiungo solo quello che manca…");
  }

  const esito = {};
  for (const tabella of TABELLE) {
    dice("Leggo " + tabella + " dall'archivio di prova…");
    let righe = await da.leggi(tabella, filtro);
    if (tabella === "movimenti") {
      // Online ogni movimento deve avere un autore: chi fa il trasloco. L'origine dice che è importato.
      // Gli annullamenti vanno dopo i movimenti che annullano.
      righe = righe.map((r) => Object.assign({}, r, { autore_id: io }))
        .sort((x, y) => (x.tipo === "annullamento") - (y.tipo === "annullamento"));
    }
    for (let i = 0; i < righe.length; i += BLOCCO) {
      dice("Scrivo " + tabella + ": " + Math.min(i + BLOCCO, righe.length) + " di " + righe.length + "…");
      await a.inserisci(tabella, righe.slice(i, i + BLOCCO), { saltaDoppioni: true });
    }
    const arrivate = await a.leggi(tabella, filtro);
    esito[tabella] = { partenza: righe.length, arrivo: arrivate.length };
  }
  return esito;
}

// Vero se ogni tabella ha online almeno le righe di partenza.
export function completo(esito) {
  return TABELLE.every((t) => esito[t] && esito[t].arrivo >= esito[t].partenza);
}
