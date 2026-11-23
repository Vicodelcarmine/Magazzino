// Numeri come li scrive il locale: virgola decimale, euro.
// (parseNumero viene dal vecchio gemello, js/format.js.)

export function parseNumero(valore) {
  if (typeof valore === "number") return Number.isFinite(valore) ? valore : null;
  if (valore == null) return null;
  let t = String(valore).trim().replace(/\s/g, "").replace("€", "");
  if (!t) return null;
  if (t.indexOf(",") >= 0 && t.indexOf(".") >= 0) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (t.indexOf(",") >= 0) {
    t = t.replace(",", ".");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function qta(n) {
  const x = Number(n);
  if (n == null || n === "" || !Number.isFinite(x)) return "—";
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 }).format(x);
}

// Per rimettere un numero dentro un campo: virgola decimale, nessun punto delle migliaia
// (altrimenti «1.500» riletto diventerebbe 1,5).
export function perCampo(n, decimali) {
  const x = Number(n);
  if (n == null || n === "" || !Number.isFinite(x)) return "";
  const p = Math.pow(10, decimali == null ? 6 : decimali);
  return String(Math.round(x * p) / p).replace(".", ",");
}

export function euro(n) {
  const x = Number(n);
  if (n == null || n === "" || !Number.isFinite(x)) return "—";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(x);
}

export function pulisci(testo) {
  return String(testo == null ? "" : testo).trim().replace(/\s+/g, " ");
}

export function nuovoId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const e = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return e.slice(0, 8) + "-" + e.slice(8, 12) + "-" + e.slice(12, 16) + "-" + e.slice(16, 20) + "-" + e.slice(20);
}
