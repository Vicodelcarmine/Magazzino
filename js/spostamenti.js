// Lo striscio verso destra col dito, usato nella Spesa per passare un articolo (o tutta la lista di un fornitore)
// a un altro fornitore. Lo spostamento in sé è una regola dell'articolo (articoli.fornitore_fisso_id): resta
// finché il titolare non lo rimette a posto, e vale su tutti i dispositivi.
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
