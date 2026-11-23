// Tiene da parte i file dell'app, così si apre anche senza rete.
//
// Regola: PRIMA LA RETE. Con la rete si prende sempre il file fresco (e lo si mette da parte al posto
// di quello vecchio); solo se la rete non risponde si usa quello messo da parte. Così non capita mai
// di restare bloccati su una versione vecchia dell'app, che è il guaio classico di queste installazioni,
// e non serve scrivere qui il numero di versione (che resta in un posto solo: js/versione.js).
const DEPOSITO = "magazzino-file";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => ev.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (ev) => {
  const richiesta = ev.request;
  // Solo i file dell'app (stessa origine, letture). I dati dell'archivio non passano di qui:
  // per quelli c'è la copia sul dispositivo.
  if (richiesta.method !== "GET" || new URL(richiesta.url).origin !== self.location.origin) return;
  ev.respondWith((async () => {
    const deposito = await caches.open(DEPOSITO);
    try {
      const fresca = await fetch(richiesta);
      if (fresca.ok) deposito.put(richiesta, fresca.clone());
      return fresca;
    } catch (e) {
      const messa = await deposito.match(richiesta, { ignoreSearch: true });
      if (messa) return messa;
      throw e;
    }
  })());
});
