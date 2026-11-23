// Grafici disegnati a mano in SVG, senza librerie. Poche regole fisse:
//  - una sola serie e un solo asse per grafico (due misure diverse = due grafici);
//  - colonne sottili (al massimo 24 px) con la punta arrotondata, linee da 2 px;
//  - griglia e assi appena visibili; le scritte hanno il colore del testo, mai quello dei dati;
//  - passando col dito o col mouse si legge il valore preciso; sotto c'è sempre la tabella dei numeri.
import { h } from "./dom.js";

const NS = "http://www.w3.org/2000/svg";

function s(tag, attributi, ...figli) {
  const el = document.createElementNS(NS, tag);
  Object.keys(attributi || {}).forEach((k) => { if (attributi[k] != null) el.setAttribute(k, attributi[k]); });
  figli.flat().forEach((f) => { if (f != null) el.append(f instanceof Node ? f : document.createTextNode(String(f))); });
  return el;
}

// Tacche «tonde» per l'asse: 0, 1000, 2000… Mai più di quattro o cinque.
export function tacche(massimo, quante) {
  if (!(massimo > 0)) return [0, 1];
  const grezzo = massimo / (quante || 4);
  const potenza = Math.pow(10, Math.floor(Math.log10(grezzo)));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * potenza).find((p) => p >= grezzo);
  const out = [];
  for (let v = 0; v < massimo + passo - 1e-9; v += passo) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function tabella(dati, intestazioni, formato) {
  return h("details", { class: "numeri" }, h("summary", {}, "Vedi i numeri"),
    h("table", {}, h("thead", {}, h("tr", {}, intestazioni.map((t) => h("th", {}, t)))),
      h("tbody", {}, dati.map((d) => h("tr", {}, h("td", {}, d.etichetta), h("td", { class: "num" }, formato(d.valore)))))));
}

// dati: [{ etichetta, valore }]; opz: { tipo: "colonne" | "linea", colore, formato, formatoAsse, intestazioni }
export function nelTempo(dati, opz) {
  const L = 720, A = 240, sx = 56, dx = 16, su = 14, giu = 30;
  const larg = L - sx - dx, alt = A - su - giu;
  const validi = dati.filter((d) => d.valore != null);
  if (!validi.length) return h("p", { class: "nota" }, "Non ci sono ancora dati per questo grafico.");
  const assi = tacche(Math.max(...validi.map((d) => d.valore)), 4);
  const tetto = assi[assi.length - 1];
  const passo = larg / dati.length;
  const x = (i) => sx + passo * (i + 0.5);
  const y = (v) => su + alt - (v / tetto) * alt;
  const fAsse = opz.formatoAsse || opz.formato;

  const svg = s("svg", { viewBox: "0 0 " + L + " " + A, role: "img", "aria-label": opz.titolo || "", class: "grafico" });
  assi.forEach((v) => {
    svg.append(s("line", { x1: sx, x2: L - dx, y1: y(v), y2: y(v), class: v === 0 ? "base" : "griglia" }),
      s("text", { x: sx - 8, y: y(v) + 4, "text-anchor": "end", class: "asse" }, fAsse(v)));
  });
  const ogni = Math.max(1, Math.ceil(dati.length / 8));
  dati.forEach((d, i) => { if (i % ogni === 0) svg.append(s("text", { x: x(i), y: A - 10, "text-anchor": "middle", class: "asse" }, d.etichetta)); });

  if (opz.tipo === "linea") {
    const punti = dati.map((d, i) => (d.valore == null ? null : [x(i), y(d.valore)])).filter(Boolean);
    svg.append(s("polyline", { points: punti.map((p) => p.join(",")).join(" "), fill: "none", stroke: opz.colore,
      "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    const fine = punti[punti.length - 1], ultimo = validi[validi.length - 1];
    svg.append(s("circle", { cx: fine[0], cy: fine[1], r: 5, fill: opz.colore, class: "anello" }),
      s("text", { x: Math.min(fine[0], L - dx - 4), y: fine[1] - 10, "text-anchor": "end", class: "valore" }, opz.formato(ultimo.valore)));
  } else {
    const w = Math.max(2, Math.min(24, passo - 2)); // sottili, con un filo d'aria fra una e l'altra
    dati.forEach((d, i) => {
      if (d.valore == null || d.valore <= 0) return;
      const top = y(d.valore), base = y(0), r = Math.min(4, w / 2, base - top);
      const a = x(i) - w / 2, b = x(i) + w / 2;
      svg.append(s("path", { fill: opz.colore, d: "M" + a + "," + base + " V" + (top + r) + " Q" + a + "," + top + " " + (a + r) + "," + top
        + " H" + (b - r) + " Q" + b + "," + top + " " + b + "," + (top + r) + " V" + base + " Z" }));
    });
  }

  // Lettura del valore: una fascia invisibile larga quanto la colonna, per tutta l'altezza.
  const guida = s("line", { y1: su, y2: su + alt, class: "guida", visibility: "hidden" });
  const fumetto = h("div", { class: "fumetto", hidden: true });
  svg.append(guida);
  dati.forEach((d, i) => {
    const fascia = s("rect", { x: sx + passo * i, y: su, width: passo, height: alt, fill: "transparent", tabindex: 0,
      "aria-label": d.etichetta + ": " + (d.valore == null ? "nessun dato" : opz.formato(d.valore)) });
    const mostra = () => {
      guida.setAttribute("x1", x(i)); guida.setAttribute("x2", x(i)); guida.setAttribute("visibility", "visible");
      fumetto.hidden = false;
      fumetto.replaceChildren(h("span", {}, d.titolo || d.etichetta), h("strong", {}, d.valore == null ? "nessun dato" : opz.formato(d.valore)));
      fumetto.style.left = (x(i) / L * 100) + "%";
    };
    const nascondi = () => { guida.setAttribute("visibility", "hidden"); fumetto.hidden = true; };
    ["pointerenter", "focus"].forEach((e) => fascia.addEventListener(e, mostra));
    ["pointerleave", "blur"].forEach((e) => fascia.addEventListener(e, nascondi));
    svg.append(fascia);
  });
  return h("div", { class: "grafico-guscio" }, h("div", { class: "grafico-area" }, svg, fumetto),
    tabella(dati.map((d) => ({ etichetta: d.titolo || d.etichetta, valore: d.valore })), opz.intestazioni,
      (v) => (v == null ? "—" : opz.formato(v))));
}

// Classifica a barre orizzontali, col valore in punta. dati: [{ etichetta, valore, nota }]
export function classifica(dati, opz) {
  if (!dati.length) return h("p", { class: "nota" }, opz.vuoto || "Niente da mostrare.");
  const massimo = Math.max(...dati.map((d) => Math.abs(d.valore))) || 1;
  return h("div", { class: "grafico-guscio" },
    h("ul", { class: "classifica" }, dati.map((d) =>
      h("li", { title: d.etichetta + ": " + opz.formato(d.valore) + (d.nota ? " — " + d.nota : "") },
        h("span", { class: "chi" }, d.etichetta),
        h("span", { class: "pista" }, h("span", { class: "barra", style: "width:" + Math.max(1, Math.abs(d.valore) / massimo * 100) + "%;background:" + opz.colore })),
        h("span", { class: "quanto" }, opz.formato(d.valore)),
        d.nota ? h("span", { class: "nota" }, d.nota) : null))));
}
