// Dati di esempio: una Margherita con i suoi ingredienti, più un detersivo «a tempo».
// Stesso esempio del vecchio gemello (js/demo.js), nella forma del nuovo archivio.
// Funzione pura: restituisce le righe da scrivere, non scrive niente.

function giorno(oggi, delta) {
  const d = new Date(oggi.getTime() + delta * 86400000);
  return d.toISOString().slice(0, 10);
}

export function datiEsempio(ristoranteId, nuovoId, oggi) {
  const r = ristoranteId;
  const f = { metro: nuovoId(), bianca: nuovoId() };
  const a = { pelati: nuovoId(), fior: nuovoId(), farina: nuovoId(), olio: nuovoId(), det: nuovoId() };
  const margherita = nuovoId();

  const articolo = (id, codice, nome, categoria, udm, conf, tipo) => ({
    id: id, ristorante_id: r, codice: codice, nome: nome, categoria: categoria, udm: udm,
    tipo: tipo || "ricetta", qta_confezione: conf,
  });
  const prezzo = (articoloId, fornitoreId, tipo, delta, euroUdm, conf) => ({
    id: nuovoId(), ristorante_id: r, articolo_id: articoloId, fornitore_id: fornitoreId,
    tipo: tipo, data: giorno(oggi, delta), prezzo_udm: euroUdm, qta_confezione: conf, origine: "esempio",
  });
  const riga = (articoloId, quantita) => ({
    id: nuovoId(), ristorante_id: r, piatto_id: margherita, articolo_id: articoloId, quantita: quantita,
  });

  return {
    fornitori: [
      { id: f.metro, ristorante_id: r, nome: "Metro" },
      { id: f.bianca, ristorante_id: r, nome: "Biancalani" },
    ],
    articoli: [
      articolo(a.pelati, "LAT-009", "Pelati", "Dispensa", "kg", 15),
      articolo(a.fior, "LAT-003", "Fior di latte", "Latticini", "kg", 3),
      articolo(a.farina, "FAR-001", "Farina 00", "Dispensa", "kg", 25),
      articolo(a.olio, "OLI-001", "Olio EVO", "Dispensa", "L", 5),
      articolo(a.det, "DET-001", "Detersivo lavastoviglie", "Pulizia", "L", 5, "tempo"),
    ],
    prezzi: [
      prezzo(a.pelati, f.metro, "fattura", -70, 0.9, 15),
      prezzo(a.pelati, f.metro, "fattura", -20, 1.2, 15),
      prezzo(a.pelati, f.bianca, "preventivo", -50, 1.4, 15),
      prezzo(a.pelati, f.bianca, "fattura", -3, 1.1, 15),
      prezzo(a.fior, f.metro, "fattura", -15, 6.8, 3),
      prezzo(a.farina, f.metro, "fattura", -15, 0.85, 25),
      prezzo(a.olio, f.metro, "fattura", -15, 9.2, 5),
      prezzo(a.det, f.metro, "fattura", -20, 1.8, 5),
    ],
    piatti: [
      { id: margherita, ristorante_id: r, codice: "PIZ-001", nome: "Margherita", categoria: "Pizza",
        prezzo_listino: 8, stato: "attivo" },
    ],
    righe_ricetta: [
      riga(a.pelati, 0.145), riga(a.fior, 0.125), riga(a.farina, 0.18), riga(a.olio, 0.01),
    ],
  };
}

// L'ordine conta: prima ciò a cui le altre righe si collegano.
export const ORDINE_ESEMPIO = ["fornitori", "articoli", "prezzi", "piatti", "righe_ricetta"];
