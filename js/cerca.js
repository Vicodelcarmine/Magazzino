// Ricerca «a imbuto»: a ogni lettera scritta restano meno voci.
// Funzioni pure, senza pagina. Le voci hanno { nome, codice, categoria, prodotto_in_cucina }.

// Categoria speciale: tutte le preparazioni di cucina insieme.
export const PREPARAZIONI = "\u0000preparazioni";

// Minuscole, senza accenti: «caffe» trova «Caffè».
export function semplice(testo) {
  return String(testo == null ? "" : testo).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("it").trim();
}

// Le categorie da proporre come filtro, in ordine alfabetico, ognuna con quante voci ha.
export function categorieCon(lista) {
  const conta = new Map();
  let preparazioni = 0;
  (lista || []).forEach((a) => {
    if (a.prodotto_in_cucina) { preparazioni += 1; return; }
    const nome = String(a.categoria || "").trim() || "Senza categoria";
    const k = semplice(nome);
    if (!conta.has(k)) conta.set(k, { chiave: k, nome: nome, quante: 0 });
    conta.get(k).quante += 1;
  });
  const out = Array.from(conta.values()).sort((x, y) => x.nome.localeCompare(y.nome, "it"));
  if (preparazioni) out.push({ chiave: PREPARAZIONI, nome: "Preparazioni", quante: preparazioni });
  return out;
}

function categoriaDi(a) {
  if (a.prodotto_in_cucina) return PREPARAZIONI;
  return semplice(String(a.categoria || "").trim() || "Senza categoria");
}

// categoria: una «chiave» di categorieCon, oppure vuoto per tutte.
// Ogni parola scritta deve essere l'INIZIO di una parola del nome, oppure del codice
// («fa» trova «Farina» e «Pane con farina», non «Caffè»). La categoria non si cerca
// scrivendo: si sceglie coi pulsanti, così scrivere stringe davvero.
// Prima le voci il cui nome comincia con ciò che si è scritto.
export function filtra(lista, testo, categoria) {
  const parole = semplice(testo).split(/\s+/).filter(Boolean);
  const prima = parole[0] || "";
  return (lista || [])
    .filter((a) => !categoria || categoriaDi(a) === categoria)
    .filter((a) => {
      const codice = semplice(a.codice);
      const pezzi = semplice(a.nome).split(/[^a-z0-9]+/).concat(codice, codice.split(/[^a-z0-9]+/));
      return parole.every((p) => pezzi.some((x) => x.startsWith(p)));
    })
    .map((a) => ({ a: a, inizia: prima && semplice(a.nome).startsWith(prima) ? 0 : 1 }))
    .sort((x, y) => x.inizia - y.inizia || x.a.nome.localeCompare(y.a.nome, "it"))
    .map((x) => x.a);
}
