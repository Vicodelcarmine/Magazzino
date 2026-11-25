// La posta: il programma «raccoglitore» da mettere nell'account Google del locale, e qualche attrezzo.
//
// Il raccoglitore gira dentro l'account di posta (Google Apps Script), ogni quarto d'ora, anche a computer
// spento. Legge la posta in SOLA LETTURA e consegna all'archivio gli allegati PDF e XML, niente di più:
// capire se sono fatture e leggerle resta compito dell'app. Si presenta con una chiave che può soltanto
// aggiungere allegati alla cassetta di quel ristorante (vedi archivio/migrazioni/0011).

// Il programma, con indirizzo e chiavi già scritti dentro: si copia e si incolla così com'è.
// Dalla riga dell'indirizzo di Drive («…/folders/1AbC…?usp=sharing») al solo codice della cartella.
export function codiceCartella(testo) {
  const t = String(testo || "").trim();
  const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(t) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(t);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(t) ? t : "";
}

export function programma(urlArchivio, chiavePubblica, chiaveRaccoglitore, cartellaChiusure) {
  return `// Raccoglitore delle fatture per il Magazzino.
// Legge la posta in sola lettura e consegna al magazzino gli allegati PDF e XML. Non cancella, non sposta, non invia.
// Legge anche, in sola lettura, i fogli «STAMPA ARTICOLI» che la cassa mette su Drive, e consegna le chiusure.

const ARCHIVIO = ${JSON.stringify(String(urlArchivio).replace(/\/+$/, "") + "/rest/v1/rpc/consegna_posta")};
const ARCHIVIO_CASSA = ${JSON.stringify(String(urlArchivio).replace(/\/+$/, "") + "/rest/v1/rpc/consegna_chiusura")};
// La cartella di Drive dove la cassa salva i fogli (vuoto = si cerca solo per nome).
const CARTELLA_CHIUSURE = ${JSON.stringify(codiceCartella(cartellaChiusure))};
// Le cartelle di Drive della cassa: tutte quelle il cui nome comincia così («Chiusure», «Chiusure Elaborate»).
const NOME_CARTELLA_CHIUSURE = "chiusure";
const CHIAVE_PUBBLICA = ${JSON.stringify(chiavePubblica)};
const CHIAVE = ${JSON.stringify(chiaveRaccoglitore)};
// Le email degli ultimi 15 giorni con un allegato PDF o XML.
const CERCA = "has:attachment newer_than:15d {filename:pdf filename:xml}";

// Da premere UNA volta: fa partire il raccoglitore ogni 15 minuti e fa subito un primo giro.
function installa() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "raccogli" || t.getHandlerFunction() === "tutto") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("tutto").timeBased().everyMinutes(15).create();
  tutto();
}

// Un giro completo: la posta e le chiusure di cassa. Se una delle due non riesce, l'altra si fa lo stesso.
function tutto() {
  try { raccogli(); } catch (e) { console.error("Posta: " + e); }
  try { raccogliChiusure(); } catch (e) { console.error("Chiusure di cassa: " + e); }
}

// Le chiusure della cassa degli ultimi 20 giorni: i file «STAMPA ARTICOLI» nelle cartelle delle chiusure.
// Di ogni chiusura si consegna il foglio Google, se c'è; altrimenti il file .xls della cassa così com'è
// (lo legge il magazzino). Così le chiusure arrivano anche se nessuno trasforma più i file.
// Le cartelle si cercano per nome fra quelle che questo account può vedere: se la cassa salva nel Drive di un
// altro account, quelle cartelle vanno condivise con questo, come Visualizzatore.
function raccogliChiusure() {
  const memoria = PropertiesService.getScriptProperties();
  let fatte = JSON.parse(memoria.getProperty("chiusure") || "[]");
  const limite = new Date(Date.now() - 20 * 86400000);
  const fogli = {}, xls = {}, altri = {};
  function guarda(f) {
    const nome = f.getName();
    if (nome.indexOf("STAMPA ARTICOLI") < 0 || f.getLastUpdated() < limite) return;
    const base = nome.replace(/\\.xlsx?$/i, "").trim();
    const tipo = f.getMimeType();
    if (tipo === MimeType.GOOGLE_SHEETS) fogli[base] = f;
    else if (tipo === "application/vnd.ms-excel" || /\\.xls$/i.test(nome)) xls[base] = f;
    else if (tipo !== "application/pdf") altri[tipo] = (altri[tipo] || 0) + 1;
  }
  try {
    const trovati = DriveApp.searchFiles('title contains "STAMPA ARTICOLI" and trashed = false');
    while (trovati.hasNext()) guarda(trovati.next());
  } catch (e) { console.error("Ricerca su Drive non riuscita: " + e); }
  const cartelle = [];
  if (CARTELLA_CHIUSURE) {
    try { cartelle.push(DriveApp.getFolderById(CARTELLA_CHIUSURE)); }
    catch (e) { console.error("Non riesco ad aprire la cartella indicata: è condivisa con questo account? (" + e + ")"); }
  }
  try {
    const perNome = DriveApp.searchFolders('title contains "' + NOME_CARTELLA_CHIUSURE + '" and trashed = false');
    while (perNome.hasNext()) cartelle.push(perNome.next());
  } catch (e) { console.error("Ricerca delle cartelle delle chiusure non riuscita: " + e); }
  cartelle.forEach(function (c) {
    try {
      const dentro = c.searchFiles('modifiedDate > "' + limite.toISOString().slice(0, 10) + '" and trashed = false');
      while (dentro.hasNext()) guarda(dentro.next());
    } catch (e) { console.error("Non riesco a leggere la cartella «" + c.getName() + "»: " + e); }
  });
  console.log("Cartelle guardate: " + (cartelle.map(function (c) { return c.getName(); }).join(", ") || "nessuna (solo ricerca per nome dei file)"));
  const nomi = {};
  Object.keys(fogli).forEach(function (n) { nomi[n] = true; });
  Object.keys(xls).forEach(function (n) { nomi[n] = true; });
  let nuove = 0, gia = 0, errori = 0, daFile = 0;
  Object.keys(nomi).sort().forEach(function (base) {
    if (fatte.indexOf(base) >= 0) return;
    try {
      let valori;
      if (fogli[base]) {
        // Il foglio si legge esportandolo in sola lettura (aprirlo col suo programma chiederebbe il permesso di modificarlo).
        const foglio = UrlFetchApp.fetch("https://docs.google.com/spreadsheets/d/" + fogli[base].getId() + "/export?format=csv",
          { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
        if (foglio.getResponseCode() !== 200) throw new Error("non riesco a leggere il foglio (" + foglio.getResponseCode() + ")");
        valori = JSON.stringify(Utilities.parseCsv(foglio.getContentText("UTF-8")));
      } else {
        valori = JSON.stringify({ xls: Utilities.base64Encode(xls[base].getBlob().getBytes()) });
        daFile += 1;
      }
      const risposta = UrlFetchApp.fetch(ARCHIVIO_CASSA, {
        method: "post", contentType: "application/json", muteHttpExceptions: true,
        headers: { apikey: CHIAVE_PUBBLICA },
        payload: JSON.stringify({ chiave: CHIAVE, nome_file: base, valori: valori }),
      });
      if (risposta.getResponseCode() !== 200) {
        errori += 1;
        console.error("Non consegnata " + base + ": " + risposta.getResponseCode() + " " + risposta.getContentText().slice(0, 200));
      } else {
        fatte.push(base);
        if (risposta.getContentText().indexOf("nuova") >= 0) nuove += 1; else gia += 1;
      }
    } catch (e) {
      errori += 1;
      console.error("Errore su " + base + ": " + e);
    }
  });
  memoria.setProperty("chiusure", JSON.stringify(fatte.slice(-200)));
  console.log("Chiusure di cassa: " + Object.keys(nomi).length + " trovate (" + Object.keys(fogli).length + " come foglio, "
    + Object.keys(xls).length + " come file .xls), " + nuove + " consegnate, " + gia + " c'erano già, " + errori + " non riuscite.");
  Object.keys(altri).forEach(function (tipo) {
    console.warn("Ci sono " + altri[tipo] + " file «STAMPA ARTICOLI» di un tipo che non so leggere (" + tipo + ").");
  });
}

// La posta: gli allegati PDF e XML delle email recenti.
function raccogli() {
  const memoria = PropertiesService.getScriptProperties();
  let fatti = JSON.parse(memoria.getProperty("consegnati") || "[]");
  const trovati = (Gmail.Users.Messages.list("me", { q: CERCA, maxResults: 40 }).messages || []).reverse();
  let nuove = 0, gia = 0, errori = 0;
  trovati.forEach(function (m) {
    if (fatti.indexOf(m.id) >= 0) return;
    const msg = Gmail.Users.Messages.get("me", m.id, { format: "full" });
    const testa = {};
    ((msg.payload && msg.payload.headers) || []).forEach(function (h) { testa[h.name.toLowerCase()] = h.value; });
    const allegati = [];
    (function scendi(p) {
      if (!p) return;
      if (p.filename && p.body && p.body.attachmentId && /\\.(pdf|xml)$/i.test(p.filename)) allegati.push(p);
      (p.parts || []).forEach(scendi);
    })(msg.payload);
    let tuttoBene = true;
    allegati.forEach(function (p) {
      try {
        const dati = Gmail.Users.Messages.Attachments.get("me", m.id, p.body.attachmentId).data;
        const bytes = typeof dati === "string" ? Utilities.base64DecodeWebSafe(dati) : dati;
        const risposta = UrlFetchApp.fetch(ARCHIVIO, {
          method: "post", contentType: "application/json", muteHttpExceptions: true,
          headers: { apikey: CHIAVE_PUBBLICA },
          payload: JSON.stringify({
            chiave: CHIAVE, nome_file: p.filename, mittente: testa.from || "", oggetto: testa.subject || "",
            ricevuta_il: new Date(Number(msg.internalDate)).toISOString(),
            tipo: /\\.pdf$/i.test(p.filename) ? "pdf" : "xml", contenuto: Utilities.base64Encode(bytes),
          }),
        });
        if (risposta.getResponseCode() !== 200) {
          tuttoBene = false; errori += 1;
          console.error("Non consegnato " + p.filename + ": " + risposta.getResponseCode() + " " + risposta.getContentText().slice(0, 200));
        } else if (risposta.getContentText().indexOf("nuova") >= 0) nuove += 1; else gia += 1;
      } catch (e) {
        tuttoBene = false; errori += 1;
        console.error("Errore su " + p.filename + ": " + e);
      }
    });
    if (tuttoBene) fatti.push(m.id);
  });
  memoria.setProperty("consegnati", JSON.stringify(fatti.slice(-300)));
  console.log("Consegnati " + nuove + " allegati nuovi, " + gia + " c'erano già, " + errori + " non riusciti.");
}
`;
}

// Il file dei permessi: SOLA LETTURA della posta, di Drive e dei fogli, più il minimo per consegnare e per partire da solo.
export function manifesto() {
  return JSON.stringify({
    timeZone: "Europe/Rome",
    dependencies: { enabledAdvancedServices: [{ userSymbol: "Gmail", version: "v1", serviceId: "gmail" }] },
    exceptionLogging: "STACKDRIVER",
    runtimeVersion: "V8",
    oauthScopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/script.external_request",
      "https://www.googleapis.com/auth/script.scriptapp",
    ],
  }, null, 2);
}

// Il contenuto di un allegato, com'è tenuto nell'archivio (base64), in bytes.
export function daBase64(testo) {
  const grezzo = atob(String(testo || "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(grezzo.length);
  for (let i = 0; i < grezzo.length; i += 1) bytes[i] = grezzo.charCodeAt(i);
  return bytes;
}

// Chi ha mandato l'email, in breve: «Metro Italia <fatture@metro.it>» → «Metro Italia».
export function mittenteBreve(mittente) {
  const m = /^\s*"?([^"<]*?)"?\s*<[^>]*>\s*$/.exec(String(mittente || ""));
  return (m && m[1].trim()) || String(mittente || "").trim();
}
