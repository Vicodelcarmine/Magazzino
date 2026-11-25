// Lo sfondo del programma. Si sceglie dalla Home; la scelta resta sul dispositivo.
// I colori di ogni sfondo stanno in css/stile.css (html[data-sfondo="…"]).
export const SFONDI = [
  ["notte", "Blu notte", "#1a3a5c", "#0a1628"],
  ["oceano", "Blu oceano", "#17558f", "#071a2e"],
  ["indaco", "Blu indaco", "#1c2466", "#090b22"],
  ["petrolio", "Blu petrolio", "#0f3b44", "#061417"],
  ["nero", "Nero (com'era)", "#181d22", "#0e1114"],
];
const PREDEFINITO = "nero";
const CHIAVE = "erp.sfondo";

export function sfondoScelto() {
  let v = null;
  try { v = localStorage.getItem(CHIAVE); } catch (e) { v = null; }
  return SFONDI.some((s) => s[0] === v) ? v : PREDEFINITO;
}

export function applicaSfondo(nome) {
  const s = SFONDI.find((x) => x[0] === nome) || SFONDI.find((x) => x[0] === PREDEFINITO);
  document.documentElement.setAttribute("data-sfondo", s[0]);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", s[3]); // la barra del telefono prende il colore del fondo
  return s[0];
}

export function scegliSfondo(nome) {
  const messo = applicaSfondo(nome);
  try { localStorage.setItem(CHIAVE, messo); } catch (e) { /* vale finché l'app resta aperta */ }
  return messo;
}
