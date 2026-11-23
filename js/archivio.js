// L'unico punto in cui l'app parla con l'archivio (di prova o Supabase: stesso dialetto).

export class ErroreArchivio extends Error {
  constructor(tipo, messaggio, codice) {
    super(messaggio);
    this.tipo = tipo; // "rete" | "sessione" | "permesso" | "doppione" | "dato" | "altro"
    this.codice = codice || "";
  }
}

const CHIAVE_SESSIONE = "erp.sessione";
// L'archivio online restituisce al massimo 1.000 righe per volta: le letture lunghe vanno a pagine.
const PAGINA = 1000;

function erroreDa(stato, corpo) {
  const codice = String((corpo && (corpo.code || corpo.error_code)) || stato);
  if (codice === "23505") return new ErroreArchivio("doppione", "Esiste già una riga uguale.", codice);
  if (codice === "42501" || stato === 403) {
    return new ErroreArchivio("permesso", "Non hai il permesso di fare questa operazione.", codice);
  }
  if (codice === "23503") return new ErroreArchivio("dato", "Collegamento non valido fra i dati.", codice);
  if (codice === "23514" || codice === "23502") {
    return new ErroreArchivio("dato", "Un dato non è valido: ricontrolla i campi.", codice);
  }
  return new ErroreArchivio("altro", "L'archivio ha risposto con un errore (" + codice + ").", codice);
}

export function filtriInQuery(filtri, ordine) {
  const q = new URLSearchParams();
  Object.keys(filtri || {}).forEach((k) => {
    const v = filtri[k];
    if (v && typeof v === "object") q.append(k, "gt." + v.dopo); // { dopo: n } = solo ciò che viene dopo n
    else q.append(k, v === null ? "is.null" : "eq." + v);
  });
  if (ordine) q.append("order", ordine);
  return q.toString();
}

export function creaArchivio(opzioni) {
  const base = String(opzioni.url || "").replace(/\/+$/, "");
  const chiave = opzioni.chiave || "";
  const deposito = opzioni.deposito;
  const chiama = opzioni.fetch || ((u, o) => fetch(u, o));
  // Ogni archivio ha la sua sessione: l'accesso a quello di prova non vale per quello online.
  const chiaveSessione = CHIAVE_SESSIONE + (opzioni.nome && opzioni.nome !== "prova" ? "." + opzioni.nome : "");
  let sessione = null;
  try { sessione = JSON.parse(deposito.getItem(chiaveSessione) || "null"); } catch (e) { sessione = null; }

  function ricorda(s) {
    sessione = s;
    try {
      if (s) deposito.setItem(chiaveSessione, JSON.stringify(s));
      else deposito.removeItem(chiaveSessione);
    } catch (e) { /* deposito non disponibile: la sessione vale finché la pagina è aperta */ }
  }

  async function richiesta(metodo, percorso, corpo, gettone, extra) {
    const intestazioni = Object.assign({ "Content-Type": "application/json" }, extra || {});
    if (chiave) intestazioni.apikey = chiave;
    if (gettone) intestazioni.Authorization = "Bearer " + gettone;
    let r;
    try {
      r = await chiama(base + percorso, {
        method: metodo,
        headers: intestazioni,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch (e) {
      throw new ErroreArchivio("rete", "Non riesco a raggiungere l'archivio. Controlla la connessione.");
    }
    const testo = await r.text();
    let dati = null;
    if (testo) { try { dati = JSON.parse(testo); } catch (e) { dati = null; } }
    return { stato: r.status, ok: r.ok, dati: dati };
  }

  async function rinnova() {
    if (!sessione || !sessione.refresh_token) return false;
    const r = await richiesta("POST", "/auth/v1/token?grant_type=refresh_token",
      { refresh_token: sessione.refresh_token });
    if (!r.ok || !r.dati || !r.dati.access_token) return false;
    ricorda(r.dati);
    return true;
  }

  async function conSessione(metodo, percorso, corpo, extra) {
    if (!sessione) throw new ErroreArchivio("sessione", "Devi fare l'accesso.");
    let r = await richiesta(metodo, percorso, corpo, sessione.access_token, extra);
    if (r.stato === 401) {
      // Un'altra scheda dell'app può aver già rinnovato la sessione (il rinnovo vale una volta
      // sola): prima di rinnovare si guarda se nel deposito ce n'è una più nuova, e si usa quella.
      let altra = null;
      try { altra = JSON.parse(deposito.getItem(chiaveSessione) || "null"); } catch (e) { altra = null; }
      if (altra && altra.access_token && altra.access_token !== sessione.access_token) {
        sessione = altra;
        r = await richiesta(metodo, percorso, corpo, sessione.access_token, extra);
      }
    }
    if (r.stato === 401) {
      if (!(await rinnova())) {
        ricorda(null);
        throw new ErroreArchivio("sessione", "La sessione è scaduta: rifai l'accesso.");
      }
      r = await richiesta(metodo, percorso, corpo, sessione.access_token, extra);
    }
    if (!r.ok) throw erroreDa(r.stato, r.dati);
    return r.dati;
  }

  return {
    utente() { return sessione ? sessione.user : null; },

    async entra(email, password) {
      const r = await richiesta("POST", "/auth/v1/token?grant_type=password",
        { email: String(email).trim(), password: password });
      if (!r.ok || !r.dati || !r.dati.access_token) {
        if (r.stato === 400 || r.stato === 401) {
          throw new ErroreArchivio("sessione", "Email o password non corrette.");
        }
        throw erroreDa(r.stato, r.dati);
      }
      ricorda(r.dati);
      return r.dati.user;
    },

    async esci() {
      const gettone = sessione && sessione.access_token;
      ricorda(null);
      if (gettone) { try { await richiesta("POST", "/auth/v1/logout", undefined, gettone); } catch (e) { /* già uscito qui */ } }
    },

    // Legge TUTTE le righe, anche se sono più di una pagina. Per avere pagine che non si
    // sovrappongono serve un ordine fisso: in coda all'ordine chiesto si mette sempre l'id.
    async leggi(tabella, filtri, ordine) {
      const fisso = tabella === "appartenenze" ? ordine : (ordine ? ordine + ",id.asc" : "id.asc");
      const q = filtriInQuery(filtri, fisso);
      const base = "/rest/v1/" + tabella + "?" + (q ? q + "&" : "");
      let tutte = [];
      for (let da = 0; ; da = tutte.length) {
        const pagina = await conSessione("GET", base + "limit=" + PAGINA + "&offset=" + da);
        tutte = tutte.concat(pagina || []);
        if (!pagina || pagina.length < PAGINA) return tutte;
      }
    },

    // Una sola pagina, da una certa riga in poi: per chiedere «c'è qualcosa oltre la riga N?».
    leggiPagina(tabella, filtri, ordine, limite, salto) {
      const fisso = ordine ? ordine + ",id.asc" : "id.asc";
      return conSessione("GET", "/rest/v1/" + tabella + "?" + filtriInQuery(filtri, fisso) + "&limit=" + limite + "&offset=" + salto);
    },

    // opz.saltaDoppioni: le righe che ci sono già (stessa identità) vengono saltate senza errore.
    // Serve per le operazioni che si possono rifare, come il trasloco dei dati; non restituisce le righe.
    inserisci(tabella, righe, opz) {
      const quiete = opz && opz.saltaDoppioni;
      return conSessione("POST", "/rest/v1/" + tabella, righe,
        { Prefer: quiete ? "resolution=ignore-duplicates,return=minimal" : "return=representation" });
    },

    modifica(tabella, filtri, cambi) {
      return conSessione("PATCH", "/rest/v1/" + tabella + "?" + filtriInQuery(filtri), cambi,
        { Prefer: "return=representation" });
    },

    funzione(nome, argomenti) {
      return conSessione("POST", "/rest/v1/rpc/" + nome, argomenti || {});
    },
  };
}
