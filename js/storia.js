// La strada fatta dentro l'app, per il tasto «Indietro». Funzioni pure, senza pagina.
// Un indirizzo è il pezzo dopo il cancelletto: "#/piatti", "#/piatti/<id>", "#/articoli/nuovo".

export function creaStoria() {
  let pila = [];
  const cima = () => pila[pila.length - 1];

  // La pagina-elenco da cui dipende una scheda: "#/piatti/<id>" → "#/piatti".
  function genitore(indirizzo) {
    const pezzi = String(indirizzo || "").split("/");
    return pezzi.length > 2 ? pezzi.slice(0, 2).join("/") : null;
  }

  return {
    // Da chiamare ogni volta che si mostra una pagina.
    visita(indirizzo) {
      if (cima() === indirizzo) return; // stessa pagina ridisegnata
      // Un modulo «nuovo» appena salvato non è un posto dove tornare: si rivedrebbe vuoto.
      if (pila.length && cima().endsWith("/nuovo")) pila.pop();
      if (cima() !== indirizzo) pila.push(indirizzo);
    },

    // Dove porta «Indietro» dalla pagina corrente, oppure null se non c'è dove tornare.
    // Senza strada alle spalle (app appena aperta su una scheda) si torna al suo elenco.
    precedente(corrente) {
      if (cima() === corrente && pila.length > 1) return pila[pila.length - 2];
      return genitore(corrente);
    },

    // Fa il passo indietro e restituisce l'indirizzo dove andare (o null).
    indietro(corrente) {
      const dove = this.precedente(corrente);
      if (dove == null) return null;
      if (cima() === corrente) pila.pop();
      if (cima() !== dove) pila.push(dove);
      return dove;
    },

    azzera() { pila = []; },
  };
}
