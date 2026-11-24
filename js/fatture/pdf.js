// Testo di un PDF nel browser, con la libreria pdf.js (Mozilla, licenza Apache 2.0) tenuta in app/vendor/.
// Le righe si ricostruiscono dalla posizione delle parole. La libreria pesa: si carica solo quando serve.

export function testoDaElementi(items) {
  const punti = [];
  (items || []).forEach(function (it) {
    if (!it || !it.str || !String(it.str).trim()) return;
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    punti.push({ x: tr[4], y: tr[5], w: it.width || 0, s: String(it.str) });
  });
  punti.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
  const righe = [];
  punti.forEach(function (p) {
    const ultima = righe[righe.length - 1];
    if (!ultima || Math.abs(ultima.y - p.y) > 3) righe.push({ y: p.y, pezzi: [p] });
    else ultima.pezzi.push(p);
  });
  return righe.map(function (r) {
    r.pezzi.sort(function (a, b) { return a.x - b.x; });
    let s = "";
    let fine = null;
    r.pezzi.forEach(function (p) {
      if (fine != null && p.x - fine > 1.5) s += " ";
      else if (s && !/\s$/.test(s) && !/^\s/.test(p.s)) s += " ";
      s += p.s;
      fine = p.x + (p.w || 0);
    });
    return s.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  }).filter(Boolean).join("\n");
}

let caricata = null;
function libreria() {
  if (globalThis.pdfjsLib) return Promise.resolve(globalThis.pdfjsLib);
  if (!caricata) {
    caricata = new Promise((ok, no) => {
      const s = document.createElement("script");
      s.src = "vendor/pdf.min.js";
      s.onload = () => (globalThis.pdfjsLib ? ok(globalThis.pdfjsLib) : no(new Error("Libreria PDF non disponibile.")));
      s.onerror = () => no(new Error("Non riesco a caricare la libreria per leggere i PDF."));
      document.head.append(s);
    });
  }
  return caricata;
}

// buffer: il contenuto del file PDF (ArrayBuffer). Restituisce il testo, pagina per pagina.
export async function leggiTesto(buffer) {
  const lib = await libreria();
  if (lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  const doc = await lib.getDocument({ data: buffer }).promise;
  const parti = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const pagina = await doc.getPage(i);
    const contenuto = await pagina.getTextContent();
    parti.push("--- PAGINA " + i + " ---");
    parti.push(testoDaElementi(contenuto.items));
  }
  if (doc.destroy) doc.destroy();
  return parti.join("\n");
}
