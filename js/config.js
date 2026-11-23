// Dove sta l'archivio.
//  online = il progetto Supabase. Qui va la chiave PUBBLICA (comincia per sb_publishable_):
//           è fatta per stare nell'app. Mai la chiave segreta (sb_secret_…) né la service_role.
//  prova  = l'archivio di prova avviato sul Mac di sviluppo (python3 avvia.py). Esiste solo
//           quando l'app è aperta da quel Mac: all'indirizzo pubblico non compare nemmeno.
const online = {
  nome: "Archivio online",
  url: "https://zpzdtpiafmxabemmedmj.supabase.co",
  chiave: "sb_publishable_91p4RLC3npwPkxsB16DMEw_7Dmzbans",
};
const prova = { nome: "Archivio di prova (solo questo Mac)", url: "", chiave: "" };

// Vero quando l'app è aperta dal Mac di sviluppo, falso quando è pubblicata.
export function inSviluppo(host) {
  const h = String(host == null ? (typeof location !== "undefined" ? location.hostname : "") : host);
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

export function configPer(host) {
  return inSviluppo(host)
    ? { archivi: { prova: prova, online: online }, predefinito: "prova" }
    : { archivi: { online: online }, predefinito: "online" };
}

export const CONFIG = configPer();
