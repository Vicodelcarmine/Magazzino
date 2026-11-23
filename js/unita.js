// Unità comode per scrivere le ricette: grammi e centilitri.
// Nell'archivio le quantità restano SEMPRE nell'unità dell'articolo (kg, L, pz):
// qui si converte soltanto quello che si scrive e quello che si mostra.

const TABELLA = {
  kg: [["kg", 1], ["g", 0.001]],
  L: [["L", 1], ["cl", 0.01]],
  pz: [["pz", 1]],
};

// Le unità in cui si può scrivere una quantità di un articolo: ["kg", "g"].
export function unitaPer(udm) {
  return (TABELLA[udm] || [[udm || "", 1]]).map((u) => u[0]);
}

function fattore(udm, unita) {
  const u = (TABELLA[udm] || []).find((x) => x[0] === unita);
  return u ? u[1] : 1;
}

// Da quello che si scrive (145 g) all'unità dell'articolo (0,145 kg).
export function inBase(valore, unita, udm) {
  return valore * fattore(udm, unita);
}

export function daBase(quantita, unita, udm) {
  return quantita / fattore(udm, unita);
}

// Come mostrare una quantità: sotto 1 kg in grammi, sotto 1 L in centilitri.
export function comoda(quantita, udm) {
  const piccola = (TABELLA[udm] || [])[1];
  if (piccola && Math.abs(quantita) < 1) return { valore: quantita / piccola[1], unita: piccola[0] };
  return { valore: quantita, unita: udm };
}

// L'unità proposta quando si aggiunge un ingrediente a una porzione: la piccola, se c'è.
export function piccolaDi(udm) {
  const u = unitaPer(udm);
  return u[u.length - 1];
}
