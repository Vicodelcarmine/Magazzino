// Spostamenti della spesa: «oggi questo articolo lo prendo da un altro fornitore».
//
// La Spesa propone ogni articolo al fornitore col prezzo migliore. Ma il titolare sa cose che i prezzi non dicono
// (la mozzarella di quello è meno buona; con quell'altro non arrivo all'ordine minimo), e allora sposta un articolo,
// o tutta la lista di un fornitore, su un altro. Lo spostamento vale per la spesa in corso: resta finché l'articolo
// non finisce in un ordine salvato, oppure finché non lo si rimette a posto. Sta su questo dispositivo.
const chiave = (ristoranteId) => "erp.spesa.spostati." + ristoranteId;
export const SENZA = "Senza fornitore";

export function leggi(ristoranteId) {
  try { const m = JSON.parse(localStorage.getItem(chiave(ristoranteId)) || "{}"); return m && typeof m === "object" ? m : {}; }
  catch (e) { return {}; }
}
function salva(ristoranteId, mappa) {
  try { localStorage.setItem(chiave(ristoranteId), JSON.stringify(mappa)); return true; } catch (e) { return false; }
}

// righe: quelle della Spesa (id, fornitore…). Restituisce le stesse righe, con quelle spostate sotto il fornitore
// nuovo e il ricordo di dov'erano («spostatoDa»). Uno spostamento non vale più se nel frattempo la Spesa propone
// l'articolo a un fornitore diverso da quello da cui era stato tolto (i prezzi sono cambiati: si ridecide).
export function applica(righe, mappa) {
  return righe.map((r) => {
    const m = mappa && mappa[r.id];
    const suo = r.fornitore || SENZA;
    if (!m || m.da !== suo || m.a === suo) return r;
    return Object.assign({}, r, { fornitore: m.a, spostatoDa: suo });
  });
}

// Sposta gli articoli (righe già passate da «applica») sul fornitore «a». Rimetterli da dove venivano toglie lo spostamento.
export function sposta(ristoranteId, righe, a) {
  const mappa = leggi(ristoranteId);
  righe.forEach((r) => {
    const origine = r.spostatoDa || r.fornitore || SENZA;
    if (a === origine) delete mappa[r.id]; else mappa[r.id] = { da: origine, a: a };
  });
  return salva(ristoranteId, mappa);
}
export function rimetti(ristoranteId, righe) {
  const mappa = leggi(ristoranteId);
  righe.forEach((r) => { delete mappa[r.id]; });
  return salva(ristoranteId, mappa);
}
// Dopo un ordine salvato: per quegli articoli lo spostamento ha fatto il suo lavoro.
export function ordinati(ristoranteId, articoloIds) {
  const mappa = leggi(ristoranteId);
  let tolti = 0;
  articoloIds.forEach((id) => { if (mappa[id]) { delete mappa[id]; tolti += 1; } });
  if (tolti) salva(ristoranteId, mappa);
  return tolti;
}

// Lo strisciare verso destra col dito. Sopra la soglia parte l'azione; il tocco che segue non apre niente.
export function strisciabile(el, azione) {
  let x0 = null, y0 = 0, dx = 0, deciso = "";
  el.classList.add("strisciabile");
  const molla = () => { el.style.transform = ""; el.classList.remove("in-striscio"); };
  el.addEventListener("touchstart", (ev) => { if (ev.touches.length !== 1) return; x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; dx = 0; deciso = ""; }, { passive: true });
  el.addEventListener("touchmove", (ev) => {
    if (x0 == null) return;
    const mx = ev.touches[0].clientX - x0, my = ev.touches[0].clientY - y0;
    if (!deciso && (Math.abs(mx) > 12 || Math.abs(my) > 12)) deciso = mx > 0 && Math.abs(mx) > Math.abs(my) * 1.5 ? "striscio" : "scorro";
    if (deciso !== "striscio") return;
    dx = Math.max(0, Math.min(mx, 140));
    el.classList.add("in-striscio");
    el.style.transform = "translateX(" + dx + "px)";
  }, { passive: true });
  const fine = () => {
    const fatto = deciso === "striscio" && dx > 80;
    x0 = null; molla();
    if (fatto) {
      // Il «tocco» che il telefono manda subito dopo non deve aprire la scheda o la tendina.
      const ferma = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
      el.addEventListener("click", ferma, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", ferma, { capture: true }), 400);
      azione();
    }
  };
  el.addEventListener("touchend", fine);
  el.addEventListener("touchcancel", () => { x0 = null; deciso = ""; molla(); });
  return el;
}
