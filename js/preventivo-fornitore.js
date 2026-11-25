// La pagina che vede il FORNITORE quando apre il link di un preventivo.
//
// Aspetto e comportamento sono quelli di ERP leggero (riferimenti/erp-leggero/servi.py), portati qui tali e quali.
// È cambiato solo ciò che sta sotto: prima la pagina la serviva il computer del locale, raggiungibile da Internet;
// ora è una pagina ferma, e parla con l'archivio attraverso tre funzioni che accettano soltanto il link
// (archivio/migrazioni/0016). Il link sta dopo il cancelletto dell'indirizzo: così non finisce nei registri di chi
// ospita la pagina. Con il link si legge quella richiesta e si consegna quella risposta, nient'altro.
import { CONFIG } from "./config.js";

const GETTONE = decodeURIComponent((location.hash || "").replace(/^#\/?/, "")).trim();
const scelto = new URLSearchParams(location.search).get("archivio");
const ARCHIVIO = CONFIG.archivi[scelto] || CONFIG.archivi[CONFIG.predefinito];

// tollerante: per la bozza, se manca la rete si risponde «non salvata» invece di dare errore.
function chiama(funzione, corpo, tollerante) {
  const intestazioni = { "Content-Type": "application/json" };
  if (ARCHIVIO.chiave) intestazioni.apikey = ARCHIVIO.chiave;
  return fetch((ARCHIVIO.url || "") + "/rest/v1/rpc/" + funzione, { method: "POST", headers: intestazioni, keepalive: true, body: JSON.stringify(corpo) })
    .then(function (res) {
      return res.json().catch(function () { return null; }).then(function (dati) {
        if (!res.ok) {
          if (tollerante) return false;
          throw new Error((dati && dati.message) || "Non riuscito.");
        }
        return dati;
      });
    }, function (e) { if (tollerante) return false; throw new Error("Non riesco a raggiungere il locale: controlla la connessione e riprova."); });
}

// Tutto ciò che arriva dall'archivio viene scritto nella pagina passando di qui: mai come codice.
function h(testo) {
  return String(testo == null ? "" : testo).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function testo(valore, n) { return String(valore == null ? "" : valore).trim().slice(0, n); }
const udmDi = (v) => (v === "L" || v === "pz" ? v : "kg");
const unitaScelta = (v) => (["g", "kg", "L", "PZ"].indexOf(String(v || "").trim()) >= 0 ? String(v).trim() : "");
const udmDaUnita = (u) => (u === "L" ? "L" : (u === "PZ" ? "pz" : "kg"));
const prezzoEtichetta = (udm) => (udm === "L" ? "Prezzo €/L" : (udm === "pz" ? "Prezzo €/pz" : "Prezzo €/kg"));
const aiutoCollo = (udm) => (udm === "L" ? "5 L si scrive 5 e L." : (udm === "pz" ? "6 bottiglie si scrive 6 e PZ." : "30 kg si scrive 30 e kg, non 30000."));
function euroCifre(n) {
  if (typeof n !== "number" || !(n > 0)) return "";
  const cent = Math.round(n * 100);
  if (cent <= 0) return "";
  const s = String(cent).padStart(3, "0");
  return s.slice(0, -2) + "," + s.slice(-2);
}
function qtaTesto(n) {
  if (typeof n !== "number" || !(n > 0)) return "";
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
}
function tastiUnita(sceltaUnita) {
  return ["g", "kg", "L", "PZ"].map((u) => '<button type="button" class="unita-tasto" data-unita="' + u + '" aria-pressed="'
    + (u === sceltaUnita ? "true" : "false") + '">' + u + "</button>").join("");
}
function formatoCampo(udm, qta, unita) {
  unita = unitaScelta(unita);
  const segna = unita === "g" ? "500" : (unita === "L" || (!unita && udm === "L") ? "5" : (unita === "PZ" || (!unita && udm === "pz") ? "6" : "15"));
  const modo = unita === "g" || unita === "PZ" ? "numeric" : "decimal";
  return '<div class="formato-box" role="group" aria-label="Formato confezione">'
    + '<input class="conf" data-unita="' + h(unita) + '" inputmode="' + modo + '" autocomplete="off" placeholder="' + segna + '" value="' + h(qtaTesto(qta)) + '">'
    + '<div class="formato-unita">' + tastiUnita(unita) + "</div></div>";
}
const ALT = /^alt-[A-Za-z0-9_-]{4,40}$/;
function rigaHtml(art, salvata, alternativa) {
  salvata = salvata || {};
  const udm = alternativa ? udmDaUnita(unitaScelta(salvata.unita)) : udmDi(art.udm);
  const nome = alternativa ? testo(salvata.nome, 80) : String(art.nome || art.id || "");
  const unita = unitaScelta(salvata.unita);
  const ident = alternativa ? String(salvata.id || "") : String(art.id || "");
  const nomeCampo = alternativa ? '<div class="prev-field span-2"><label>Nome</label>'
    + '<input class="campo-editabile-listino nome-alt" autocomplete="off" maxlength="80" placeholder="Come lo chiami tu" value="' + h(nome) + '"></div>' : "";
  return '<article class="card-prev-riga scheda" data-id="' + h(ident) + '" data-udm="' + h(udm) + '"' + (alternativa ? ' data-alt="1"' : "") + ">"
    + '<div class="prev-riga-nome nome-articolo-magazzino nome-visibile">' + h(nome || "Articolo alternativo") + "</div>"
    + '<div class="prev-fields-grid">' + nomeCampo
    + '<div class="prev-field span-2"><label>Cod. fornitore</label>'
    + '<input class="campo-editabile-listino codice" autocomplete="off" placeholder="Il tuo codice" maxlength="40" value="' + h(salvata.codice || "") + '">'
    + '<p class="aiuto">Il codice che usi tu. Non il nostro.</p></div>'
    + '<div class="prev-field span-2"><label>Formato conf.</label>' + formatoCampo(udm, salvata.qta, unita)
    + '<p class="aiuto aiuto-collo">' + h(aiutoCollo(udm)) + "</p>"
    + '<p class="aiuto formato-avviso" hidden></p></div>'
    + '<div class="prev-field span-2"><label class="etichetta-prezzo">' + h(prezzoEtichetta(udm)) + "</label>"
    + '<input class="inp-prev text-end prezzo" inputmode="numeric" autocomplete="off" placeholder="110" value="' + h(euroCifre(salvata.prezzo)) + '">'
    + '<p class="aiuto aiuto-prezzo">110 diventa 1,10 € per ' + h(udm) + ".</p></div>"
    + '<div class="prev-field span-2"><label>Note</label>'
    + '<input class="campo-editabile-listino nota-riga" autocomplete="off" placeholder="Opzionale" maxlength="240" value="' + h(salvata.note || "") + '"></div>'
    + "</div>" + (alternativa ? '<button type="button" class="togli-alt">Togli questo articolo</button>' : "") + "</article>";
}
function dataIt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? m[3] + "/" + m[2] + "/" + m[1] : "";
}

function corpoPagina(link) {
  const bozza = link.bozza && typeof link.bozza === "object" ? link.bozza : {};
  const salvate = {};
  (Array.isArray(bozza.righe) ? bozza.righe : []).forEach((r) => { if (r && r.id) salvate[String(r.id)] = r; });
  const slides = [], tasti = [];
  (Array.isArray(link.articoli) ? link.articoli : []).forEach((art, i) => {
    const sid = "slide-prev-" + i;
    slides.push('<div class="carousel-slide-prev" id="' + sid + '" data-carousel-slide>' + rigaHtml(art, salvate[String(art.id)], false) + "</div>");
    tasti.push('<button type="button" class="btn-articolo-grid-prev" data-slide="' + sid + '">' + h(art.nome || art.id || "") + "</button>");
  });
  (Array.isArray(bozza.alternativi) ? bozza.alternativi : []).forEach((raw, j) => {
    if (!raw || !ALT.test(String(raw.id || ""))) return;
    slides.push('<div class="carousel-slide-prev" id="slide-alt-' + j + '" data-carousel-slide>' + rigaHtml({}, raw, true) + "</div>");
  });
  const fino = dataIt(link.scade);
  return "<h1>" + h(link.fornitore || "Preventivo") + "</h1>"
    + '<p class="prev-lead">Prezzi per ' + h(link.locale || "il locale") + ". Lascia vuoto un articolo che non tratti.</p>"
    + (fino ? '<p class="rq-online-countdown">Valido fino al ' + h(fino) + "</p>" : '<p class="rq-online-countdown">Senza scadenza</p>')
    + '<div class="progress-wrap"><div class="label"><span>Avanzamento</span>'
    + '<span id="testoProgresso">0 di ' + slides.length + " pronti</span></div>"
    + '<div class="progress"><div class="progress-bar" id="barraProgresso"></div></div></div>'
    + '<p class="errore" id="errore" hidden></p>'
    + '<div class="prev-categoria-body" id="sezione-prev">'
    + '<div class="griglia-articoli-prev" role="list">' + tasti.join("") + "</div>"
    + '<aside class="pannello-laterale-prev">'
    + '<div class="pannello-placeholder-prev">Seleziona una riga del listino</div>'
    + '<div class="carousel-prev-wrap">'
    + '<div class="carousel-prev-viewport" id="vista-carousel">'
    + '<div class="carousel-prev-track">' + slides.join("") + "</div></div>"
    + '<div class="carousel-prev-nav">'
    + '<button type="button" class="btn-nav-prev" id="prec" aria-label="Precedente">‹</button>'
    + '<div class="carousel-prev-counter"><span class="carousel-counter-text">—</span>'
    + '<small class="carousel-counter-nome"></small></div>'
    + '<button type="button" class="btn-nav-prev" id="succ" aria-label="Successivo">›</button>'
    + "</div>"
    + '<p class="carousel-prev-hint">← scorri con il dito →</p>'
    + "</div></aside></div>"
    + '<button type="button" id="aggiungi-alt">Aggiungi articolo alternativo</button>'
    + '<p class="aiuto" id="stato-bozza"></p>'
    + '<div class="prev-field span-2 note-generali"><label>Note generali</label>'
    + '<textarea id="note" rows="3" maxlength="500" placeholder="Opzionale">' + h(testo(bozza.note, 500)) + "</textarea></div>"
    + '<button type="button" id="invia">Invia il preventivo</button>'
    + '<template id="modello-alt"><div class="carousel-slide-prev" data-carousel-slide>' + rigaHtml({}, { id: "" }, true) + "</div></template>";
}

function messaggio(titolo, frase) {
  document.querySelector("main").innerHTML = "<h1>" + h(titolo) + "</h1><p>" + h(frase) + "</p>";
}

function avvia() {
    // Da qui in giù è il comportamento della pagina com'era in ERP leggero, riga per riga.
    function cifreEuro(digits) {
      digits = String(digits || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
      if (!digits) return "";
      while (digits.length < 3) digits = "0" + digits;
      return digits.slice(0, -2) + "," + digits.slice(-2);
    }
    function sistema(el) {
      var v = el.value;
      if (el.classList.contains("prezzo")) v = cifreEuro(v);
      else if (el.classList.contains("conf")) {
        var u = el.dataset.unita || "";
        if (u === "g" || u === "PZ") v = v.replace(/\D/g, "");
        else {
          v = v.replace(/\./g, ",").replace(/[^\d,]/g, "");
          var i = v.indexOf(",");
          if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, "");
        }
      }
      if (v !== el.value) el.value = v;
    }
    document.addEventListener("input", function (e) {
      var t = e.target;
      if (!t) return;
      if (t.matches && t.matches("input")) sistema(t);
      if (t.classList && t.classList.contains("nome-alt")) {
        var vis = t.closest(".scheda") && t.closest(".scheda").querySelector(".nome-visibile");
        if (vis) vis.textContent = (t.value || "").trim() || "Articolo alternativo";
      }
      aggiornaAvanzamento();
      aggiornaContatore();
      salvaBozza();
    });
    function stessaFamiglia(udm, unita) {
      if (udm === "L") return unita === "L";
      if (udm === "pz") return unita === "PZ";
      return unita === "g" || unita === "kg";
    }
    function testoUnita(udm, unita) {
      if (!unita || stessaFamiglia(udm, unita)) return "";
      if (udm === "L") return "Questo articolo è a litri: scegli L.";
      if (udm === "pz") return "Questo articolo è a pezzi: scegli PZ.";
      return "Questo articolo è a kg: scegli g o kg.";
    }
    function famigliaUnita(unita) {
      if (unita === "L") return "L";
      if (unita === "PZ") return "pz";
      if (unita === "g" || unita === "kg") return "kg";
      return "";
    }
    function leggiCollo(box) {
      var confEl = box.querySelector(".conf");
      var unita = confEl.dataset.unita || "";
      var confRaw = confEl.value.trim().replace(",", ".");
      var qta = confRaw ? Number(confRaw) : 0;
      var avviso = box.querySelector(".formato-avviso");
      var alt = box.getAttribute("data-alt") === "1";
      var udm = alt ? (famigliaUnita(unita) || "kg") : (box.getAttribute("data-udm") || "kg");
      var testo = alt ? "" : testoUnita(udm, unita);
      if (alt && unita) box.setAttribute("data-udm", udm);
      if (avviso) {
        avviso.hidden = !testo;
        avviso.textContent = testo;
      }
      if (!(qta > 0) || !unita || testo) return null;
      return unita === "g" ? qta / 1000 : qta;
    }
    function rigaPronta(box) {
      var nomeEl = box.querySelector(".nome-alt");
      var nomeOk = !nomeEl || !!(nomeEl.value || "").trim();
      var prezzo = box.querySelector(".prezzo").value.replace(/\D/g, "");
      return nomeOk && Number(prezzo) > 0 && leggiCollo(box) != null;
    }
    function aggiornaAvanzamento() {
      var schede = document.querySelectorAll(".scheda");
      var pronti = 0;
      schede.forEach(function (box) {
        if (rigaPronta(box)) pronti += 1;
      });
      var testo = document.getElementById("testoProgresso");
      var barra = document.getElementById("barraProgresso");
      if (testo) testo.textContent = pronti + " di " + schede.length + " pronti";
      if (barra) barra.style.width = (schede.length ? Math.round(pronti / schede.length * 100) : 0) + "%";
    }
    function elencoSlide() {
      return Array.prototype.slice.call(document.querySelectorAll(".carousel-slide-prev"));
    }
    function indiceVisibile() {
      var viewport = document.getElementById("vista-carousel");
      var elenco = elencoSlide();
      if (!viewport || !elenco.length) return 0;
      var idx = Math.round(viewport.scrollLeft / (viewport.clientWidth || 1));
      return Math.max(0, Math.min(idx, elenco.length - 1));
    }
    function aggiornaContatore() {
      var elenco = elencoSlide();
      var idx = indiceVisibile();
      var text = document.querySelector(".carousel-counter-text");
      var nome = document.querySelector(".carousel-counter-nome");
      if (text) text.textContent = elenco.length ? (idx + 1) + " / " + elenco.length : "—";
      if (nome) {
        var slide = elenco[idx];
        var campo = slide && slide.querySelector(".nome-alt");
        var t = campo && campo.value.trim();
        if (!t) {
          var n = slide && slide.querySelector(".prev-riga-nome");
          t = n ? n.textContent.trim() : "";
        }
        nome.textContent = t.length > 34 ? t.slice(0, 32) + "…" : t;
      }
      var prec = document.getElementById("prec");
      var succ = document.getElementById("succ");
      if (prec) prec.disabled = idx <= 0;
      if (succ) succ.disabled = !elenco.length || idx >= elenco.length - 1;
    }
    function vaiSlide(delta) {
      var elenco = elencoSlide();
      if (!elenco.length) return;
      var viewport = document.getElementById("vista-carousel");
      var idx = Math.max(0, Math.min(indiceVisibile() + delta, elenco.length - 1));
      if (viewport) viewport.scrollTo({ left: idx * viewport.clientWidth, behavior: "smooth" });
      setTimeout(aggiornaContatore, 320);
    }
    var vista = document.getElementById("vista-carousel");
    if (vista) vista.addEventListener("scroll", aggiornaContatore, { passive: true });
    var prec = document.getElementById("prec");
    var succ = document.getElementById("succ");
    if (prec) prec.addEventListener("click", function () { vaiSlide(-1); });
    if (succ) succ.addEventListener("click", function () { vaiSlide(1); });
    aggiornaContatore();
    aggiornaAvanzamento();
    function euroDaMaschera(v) {
      var cifre = String(v || "").replace(/\D/g, "");
      if (!cifre) return null;
      var n = Number(cifre) / 100;
      return n > 0 ? n : null;
    }
    function qtaDaTesto(v) {
      var s = String(v || "").trim().replace(",", ".");
      if (!s) return null;
      var n = Number(s);
      return n > 0 ? n : null;
    }
    function raccogliBozza() {
      var righe = [];
      var alternativi = [];
      document.querySelectorAll(".scheda").forEach(function (box) {
        var prezzo = euroDaMaschera(box.querySelector(".prezzo").value);
        var confEl = box.querySelector(".conf");
        var unita = confEl.dataset.unita || "";
        var qta = qtaDaTesto(confEl.value);
        var codice = (box.querySelector(".codice").value || "").trim();
        var nota = (box.querySelector(".nota-riga").value || "").trim();
        if (box.getAttribute("data-alt") === "1") {
          alternativi.push({
            id: box.getAttribute("data-id"),
            nome: (box.querySelector(".nome-alt").value || "").trim(),
            prezzo: prezzo,
            unita: unita,
            qta: qta,
            codice: codice,
            note: nota
          });
          return;
        }
        if (prezzo == null && !unita && qta == null && !codice && !nota) return;
        righe.push({ id: box.getAttribute("data-id"), prezzo: prezzo, unita: unita, qta: qta, codice: codice, note: nota });
      });
      var noteEl = document.getElementById("note");
      return { righe: righe, alternativi: alternativi, note: noteEl ? (noteEl.value || "").trim() : "" };
    }
    var bozzaTimer = null;
    var bozzaInCorso = false;
    var bozzaDiNuovo = false;
    function salvaBozza(subito) {
      clearTimeout(bozzaTimer);
      var parti = function () {
        if (bozzaInCorso) { bozzaDiNuovo = true; return; }
        bozzaInCorso = true;
        var stato = document.getElementById("stato-bozza");
        chiama("preventivo_bozza", { gettone: GETTONE, bozza: JSON.stringify(raccogliBozza()) }, true        ).then(function (salvata) {
          if (stato) stato.textContent = salvata === true ? "Bozza salvata" : "Bozza non salvata";
        }).catch(function () {
          if (stato) stato.textContent = "Bozza non salvata";
        }).then(function () {
          bozzaInCorso = false;
          if (bozzaDiNuovo) { bozzaDiNuovo = false; salvaBozza(true); }
        });
      };
      if (subito) parti();
      else bozzaTimer = setTimeout(parti, 400);
    }
    window.addEventListener("pagehide", function () { salvaBozza(true); });
    var aggiungi = document.getElementById("aggiungi-alt");
    if (aggiungi) aggiungi.addEventListener("click", function () {
      var modello = document.getElementById("modello-alt");
      var track = document.querySelector(".carousel-prev-track");
      if (!modello || !track) return;
      var slide = modello.content.firstElementChild.cloneNode(true);
      var id = "alt-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      slide.id = id;
      slide.querySelector(".scheda").setAttribute("data-id", id);
      track.appendChild(slide);
      var viewport = document.getElementById("vista-carousel");
      var elenco = elencoSlide();
      if (viewport) viewport.scrollTo({ left: (elenco.length - 1) * viewport.clientWidth, behavior: "smooth" });
      setTimeout(aggiornaContatore, 320);
      aggiornaAvanzamento();
      var nome = slide.querySelector(".nome-alt");
      if (nome) nome.focus();
      salvaBozza(true);
    });
    document.addEventListener("click", function (e) {
      var togli = e.target.closest && e.target.closest(".togli-alt");
      if (togli) {
        var slide = togli.closest(".carousel-slide-prev");
        if (slide) slide.remove();
        aggiornaContatore();
        aggiornaAvanzamento();
        salvaBozza(true);
        return;
      }
      var g = e.target.closest && e.target.closest(".btn-articolo-grid-prev");
      if (g) {
        var id = g.getAttribute("data-slide");
        document.querySelectorAll(".btn-articolo-grid-prev").forEach(function (b) {
          b.classList.toggle("active", b === g);
        });
        document.querySelectorAll(".carousel-slide-prev").forEach(function (s) {
          s.classList.toggle("is-active-slide", s.id === id);
        });
        var ph = document.querySelector(".pannello-placeholder-prev");
        if (ph) ph.classList.add("nascosto");
        return;
      }
      var b = e.target.closest && e.target.closest(".unita-tasto");
      if (!b) return;
      var box = b.closest(".scheda");
      box.querySelectorAll(".unita-tasto").forEach(function (x) {
        x.setAttribute("aria-pressed", x === b ? "true" : "false");
      });
      var input = box.querySelector(".conf");
      var u = b.getAttribute("data-unita") || "";
      input.dataset.unita = u;
      input.setAttribute("inputmode", u === "g" || u === "PZ" ? "numeric" : "decimal");
      input.placeholder = u === "g" ? "500" : (u === "kg" ? "15" : (u === "L" ? "5" : "6"));
      sistema(input);
      if (box.getAttribute("data-alt") === "1") {
        var fam = u === "L" ? "L" : (u === "PZ" ? "pz" : "kg");
        var et = box.querySelector(".etichetta-prezzo");
        var aiutoPrezzo = box.querySelector(".aiuto-prezzo");
        var aiutoCollo = box.querySelector(".aiuto-collo");
        if (et) et.textContent = fam === "L" ? "Prezzo €/L" : (fam === "pz" ? "Prezzo €/pz" : "Prezzo €/kg");
        if (aiutoPrezzo) aiutoPrezzo.textContent = "110 diventa 1,10 € per " + fam + ".";
        if (aiutoCollo) aiutoCollo.textContent = fam === "L" ? "5 L si scrive 5 e L." : (fam === "pz" ? "6 bottiglie si scrive 6 e PZ." : (u === "g" ? "500 g si scrive 500 e g." : "30 kg si scrive 30 e kg, non 30000."));
      }
      input.focus();
      aggiornaAvanzamento();
      salvaBozza(true);
    });
    var tasto = document.getElementById("invia");
    if (tasto) tasto.addEventListener("click", function () {
      var errore = document.getElementById("errore");
      var righe = [];
      var problema = "";
      document.querySelectorAll(".scheda").forEach(function (box) {
        var prezzo = box.querySelector(".prezzo").value.replace(/\D/g, "");
        var confEl = box.querySelector(".conf");
        var confRaw = confEl.value.trim();
        var unita = confEl.dataset.unita || "";
        var codice = (box.querySelector(".codice").value || "").trim();
        var nota = (box.querySelector(".nota-riga").value || "").trim();
        var alt = box.getAttribute("data-alt") === "1";
        var nomeAlt = alt ? (box.querySelector(".nome-alt").value || "").trim() : "";
        var nome = alt ? (nomeAlt || "Articolo alternativo") : box.querySelector(".prev-riga-nome").textContent;
        var salvato = leggiCollo(box);
        if (!prezzo && !confRaw && !unita && !codice && !nota && !nomeAlt) return;
        var euro = prezzo ? Number(prezzo) / 100 : 0;
        var famigliaSbagliata = alt ? "" : testoUnita(box.getAttribute("data-udm") || "kg", unita);
        if (alt && !nomeAlt) problema = problema || "Scrivi il nome dell'articolo alternativo.";
        else if (!(euro > 0)) problema = problema || (nome + ": scrivi il prezzo.");
        else if (!unita) problema = problema || (nome + ": scegli l'unità della confezione.");
        else if (famigliaSbagliata) problema = problema || (nome + ": " + famigliaSbagliata);
        else if (!(salvato > 0)) problema = problema || (nome + ": scrivi quanto contiene un collo.");
        else {
          var riga = {
            id: box.getAttribute("data-id"),
            prezzo: euro,
            confezione: salvato,
            unita: unita,
            qta: Number(confRaw.replace(",", ".")),
            codice: codice,
            note: nota
          };
          if (alt) {
            riga.alternativo = true;
            riga.nome = nomeAlt;
          }
          righe.push(riga);
        }
      });
      if (!problema && !righe.length) problema = "Inserisci almeno un prezzo prima di inviare.";
      if (problema) {
        errore.hidden = false;
        errore.textContent = problema;
        return;
      }
      tasto.disabled = true;
      var noteGenerali = "";
      var noteEl = document.getElementById("note");
      if (noteEl) noteGenerali = (noteEl.value || "").trim();
      chiama("preventivo_invia", { gettone: GETTONE, righe: JSON.stringify(righe), note: noteGenerali })
        .then(function (fatto) {
          if (fatto !== true) throw new Error("Invio non riuscito.");
          document.querySelector("main").innerHTML = "<h1>Preventivo inviato</h1><p>Grazie. Il locale lo ha ricevuto.</p>";
        })
        .catch(function (err) {
          tasto.disabled = false;
          errore.hidden = false;
          errore.textContent = err.message || "Non riesco a inviare: controlla la connessione e riprova.";
        });
    });
}

if (!GETTONE) messaggio("Link non valido", "Questo indirizzo non corrisponde a un preventivo.");
else chiama("preventivo_apri", { gettone: GETTONE }).then(function (link) {
  const stato = link && link.stato;
  if (stato === "aperto") { document.querySelector("main").innerHTML = corpoPagina(link); avvia(); }
  else if (stato === "inviato") messaggio(link.fornitore || "Preventivo", "Preventivo già inviato. Non puoi più modificarlo: chiedi un link nuovo al locale.");
  else if (stato === "scaduto") messaggio(link.fornitore || "Preventivo", "Link scaduto. Non puoi più inviare il preventivo: chiedi un link nuovo al locale.");
  else if (stato === "chiuso") messaggio(link.fornitore || "Preventivo", "Questo link è stato ritirato dal locale. Chiedine uno nuovo.");
  else messaggio("Link non valido", "Questo indirizzo non corrisponde a un preventivo.");
}).catch(function (e) { messaggio("Non riesco ad aprire il preventivo", e.message || "Controlla la connessione e riprova."); });
