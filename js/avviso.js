// Avvisi dentro l'app: un suono e un riquadro che compare in alto (per esempio quando arriva una fattura per posta).
// Funzionano finché l'app è aperta. Ad app chiusa il telefono non suona: per quello servirebbero le notifiche
// del sistema, che sono un lavoro a parte.

let audio = null;
// I telefoni fanno suonare una pagina solo dopo che la si è toccata almeno una volta: ci si prepara al primo tocco.
export function preparaSuono(radice) {
  const sblocca = () => {
    try {
      const Classe = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!audio && Classe) audio = new Classe();
      if (audio && audio.state === "suspended") audio.resume();
    } catch (e) { audio = null; }
  };
  radice.addEventListener("pointerdown", sblocca, { passive: true });
  radice.addEventListener("keydown", sblocca, { passive: true });
}

// Due note brevi, tipo campanello. Se il telefono non lo permette, niente suono e nessun errore.
export function suona() {
  try {
    if (!audio || audio.state !== "running") return false;
    const adesso = audio.currentTime;
    [[880, 0], [1175, 0.18]].forEach(([nota, quando]) => {
      const voce = audio.createOscillator(), volume = audio.createGain();
      voce.type = "sine";
      voce.frequency.value = nota;
      volume.gain.setValueAtTime(0.0001, adesso + quando);
      volume.gain.exponentialRampToValueAtTime(0.25, adesso + quando + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, adesso + quando + 0.35);
      voce.connect(volume).connect(audio.destination);
      voce.start(adesso + quando);
      voce.stop(adesso + quando + 0.4);
    });
    return true;
  } catch (e) { return false; }
}

// Il riquadro in alto: testo, un tasto per andare a vedere, e la X. Sparisce da solo dopo un po'.
export function mostraAvviso(testo, etichetta, vai) {
  const vecchio = document.getElementById("avviso-volante");
  if (vecchio) vecchio.remove();
  const el = document.createElement("div");
  el.id = "avviso-volante";
  el.setAttribute("role", "status");
  const scritta = document.createElement("strong");
  scritta.textContent = testo;
  const apri = document.createElement("button");
  apri.type = "button"; apri.className = "primario"; apri.textContent = etichetta;
  apri.addEventListener("click", () => { el.remove(); vai(); });
  const chiudi = document.createElement("button");
  chiudi.type = "button"; chiudi.className = "leggero"; chiudi.textContent = "✕";
  chiudi.setAttribute("aria-label", "Chiudi l'avviso");
  chiudi.addEventListener("click", () => el.remove());
  el.append(scritta, apri, chiudi);
  document.body.append(el);
  setTimeout(() => { if (el.isConnected) el.remove(); }, 20000);
  return el;
}
