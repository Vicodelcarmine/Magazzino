// Piccoli aiuti per costruire la pagina senza mai incollare testo come HTML.

export function h(tag, attributi, ...figli) {
  const el = document.createElement(tag);
  Object.keys(attributi || {}).forEach((k) => {
    const v = attributi[k];
    if (v == null || v === false) return;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "disabled" || k === "selected" || k === "required") el[k] = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  });
  figli.flat(Infinity).forEach((f) => {
    if (f == null || f === false) return;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  });
  return el;
}

export function campo(etichetta, controllo, aiuto) {
  return h("label", { class: "campo" },
    h("span", { class: "etichetta" }, etichetta),
    controllo,
    aiuto ? h("span", { class: "aiuto" }, aiuto) : null);
}

export function scelta(nome, opzioni, valore) {
  return h("select", { name: nome },
    opzioni.map((o) => h("option", { value: o[0], selected: o[0] === valore }, o[1])));
}

export function spunta(nome, etichetta, attiva) {
  return h("label", { class: "spunta" },
    h("input", { type: "checkbox", name: nome, checked: attiva }), " ", etichetta);
}

export function suggerimenti(id, voci) {
  return h("datalist", { id: id }, voci.map((v) => h("option", { value: v })));
}

// Legge un modulo in un oggetto { nome: valore } (le spunte diventano vero/falso).
export function leggiModulo(modulo) {
  const out = {};
  Array.from(modulo.elements).forEach((e) => {
    if (!e.name) return;
    if (e.type === "radio") { if (e.checked) out[e.name] = e.value; else if (!(e.name in out)) out[e.name] = ""; return; }
    out[e.name] = e.type === "checkbox" ? e.checked : e.value;
  });
  return out;
}

// Modulo con messaggio d'errore e pulsante che si blocca mentre salva.
export function modulo(campi, testoPulsante, alInvio, extra) {
  const errore = h("p", { class: "errore", role: "alert" });
  const pulsante = h("button", { type: "submit", class: "primario" }, testoPulsante);
  const f = h("form", { class: "scheda", novalidate: true }, campi, errore,
    h("div", { class: "azioni" }, pulsante, extra || null));
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    errore.textContent = "";
    pulsante.disabled = true;
    try {
      await alInvio(leggiModulo(f), f);
    } catch (e) {
      errore.textContent = e.message || "Qualcosa non ha funzionato.";
    } finally {
      pulsante.disabled = false;
    }
  });
  return f;
}

export function vuoto(testo) {
  return h("p", { class: "vuoto" }, testo);
}

// Toccando un riquadro, quello che c'è dentro viene SOSTITUITO da ciò che si scrive:
// così un 15 non diventa per sbaglio 65 o 165. Vale per ogni campo di testo dell'app.
//
// Due protezioni, perché sul telefono la prima da sola non basta:
//  1. a ogni tocco il contenuto viene selezionato (si vede evidenziato);
//  2. se il telefono, col tocco, toglie la selezione e mette il cursore in mezzo,
//     il PRIMO tasto premuto sostituisce comunque tutto.
//
// NUMERI (riquadri con la tastiera numerica): OGNI tocco riparte da capo, sempre.
// Non esiste il «secondo tocco per correggere una cifra»: un numero si riscrive.
// TESTI (nomi, note): il secondo tocco dentro il riquadro mette il cursore dove si
// tocca, perché per correggere una lettera di un nome lungo non lo si riscrive tutto.
//
// In più, nei riquadri dei numeri entrano solo cifre, virgola e punto.
export function sovrascriviAlTocco(radice) {
  const fresco = new WeakSet(); // riquadri in cui il prossimo tasto sostituisce tutto

  function testuale(el) {
    return el instanceof HTMLInputElement
      && ["checkbox", "radio", "hidden", "button", "submit", "file"].indexOf(el.type) < 0;
  }
  const numerico = (el) => el.inputMode === "decimal" || el.inputMode === "numeric";
  function selezionaTutto(el) {
    try { el.setSelectionRange(0, el.value.length); } catch (e) { el.select(); } // «email» non accetta la prima
  }
  function arma(el) {
    if (!el.value) return;
    fresco.add(el);
    selezionaTutto(el);
    setTimeout(() => { if (fresco.has(el) && radice.activeElement === el) selezionaTutto(el); }, 0);
  }

  radice.addEventListener("focusin", (ev) => { if (testuale(ev.target)) arma(ev.target); });

  // Tocco dentro un riquadro in cui si è già: nei numeri riparte da capo, nei testi no.
  radice.addEventListener("pointerdown", (ev) => {
    const el = ev.target;
    if (el !== radice.activeElement || !testuale(el)) return;
    if (!numerico(el)) fresco.delete(el);
  });
  radice.addEventListener("click", (ev) => {
    const el = ev.target;
    if (el === radice.activeElement && testuale(el) && numerico(el)) arma(el);
  });

  radice.addEventListener("beforeinput", (ev) => {
    const el = ev.target;
    if (!testuale(el)) return;
    const tipo = ev.inputType || "";
    // Solo numeri dove si scrivono numeri (anche incollando o con una tastiera vera).
    if (numerico(el) && tipo.startsWith("insert") && ev.data != null && /[^0-9.,]/.test(ev.data)) {
      ev.preventDefault();
      return;
    }
    if (!fresco.has(el)) return;
    fresco.delete(el);
    // Primo tasto (una cifra, una lettera, o «cancella»): agisce su tutto il contenuto.
    if (tipo.startsWith("insert") || tipo.startsWith("delete")) selezionaTutto(el);
  });

  radice.addEventListener("focusout", (ev) => fresco.delete(ev.target));
}

// Un tasto che toglie qualcosa chiede sempre conferma, per non farlo con un tocco
// sfuggito. Al primo tocco compaiono «Annulla» (dove c'era il tasto, così un doppio
// tocco per sbaglio annulla) e, di fianco, la conferma. Dopo qualche secondo torna com'era.
export function conConferma(testo, testoConferma, azione, classe) {
  const guscio = h("span", { class: "conferma" });
  let timer = null;
  function riposo() {
    clearTimeout(timer);
    guscio.replaceChildren(h("button", { type: "button", class: classe || "leggero", onclick: chiedi }, testo));
  }
  function chiedi() {
    guscio.replaceChildren(
      h("button", { type: "button", onclick: riposo }, "Annulla"),
      h("button", { type: "button", class: "pericolo", onclick: () => { riposo(); azione(); } }, testoConferma));
    timer = setTimeout(riposo, 6000);
  }
  riposo();
  return guscio;
}

// La categoria si SCEGLIE fra quelle che esistono già: scrivendola a mano nascevano doppioni («Primi», «primi », «Primo»).
// Per crearne una nuova c'è una voce apposta in fondo all'elenco, così non capita per sbaglio.
export function sceltaCategoria(valore, esistenti) {
  const NUOVA = "\u0000nuova";
  const attuale = String(valore || "").trim();
  const voci = (esistenti || []).slice();
  if (attuale && !voci.some((v) => v.toLowerCase() === attuale.toLowerCase())) voci.unshift(attuale);
  const giusta = voci.find((v) => v.toLowerCase() === attuale.toLowerCase()) || "";
  const sel = h("select", { name: "categoria", "aria-label": "Categoria" },
    h("option", { value: "", selected: !giusta }, "— scegli la categoria —"),
    voci.map((v) => h("option", { value: v, selected: v === giusta }, v)),
    h("option", { value: NUOVA }, "＋ Nuova categoria…"));
  const nuova = h("input", { autocomplete: "off", placeholder: "Nome della nuova categoria", "aria-label": "Nuova categoria", hidden: true });
  const torna = h("button", { type: "button", class: "leggero", hidden: true, onclick: () => mostra(false) }, "‹ Scegli fra quelle che ci sono");
  function mostra(scrivo) {
    sel.hidden = scrivo; nuova.hidden = !scrivo; torna.hidden = !scrivo;
    if (scrivo) { sel.removeAttribute("name"); nuova.setAttribute("name", "categoria"); nuova.focus(); }
    else { nuova.removeAttribute("name"); nuova.value = ""; sel.setAttribute("name", "categoria"); sel.value = giusta; }
  }
  sel.addEventListener("change", () => { if (sel.value === NUOVA) mostra(true); });
  return h("span", { class: "scelta-categoria" }, sel, nuova, torna);
}
