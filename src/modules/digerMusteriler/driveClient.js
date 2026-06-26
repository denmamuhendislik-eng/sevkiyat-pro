// COC Drive entegrasyonu — Cloud Functions client wrapper'ları.
// Backend onCall fonksiyonları (functions/index.js):
//   - searchCocDrive(category, stokKodu, altName) → { results: [...] }
//   - importCocDriveFile(fileId, certNo, certYear, category, stokKodu) → { coc, master }
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase";

export async function searchCocDrive({ category, stokKodu, altName }) {
  const fn = httpsCallable(functions, "searchCocDrive");
  const res = await fn({ category, stokKodu, altName: altName || "" });
  return res.data; // { success, results, strategy, message? }
}

export async function importCocDriveFile({ fileId, certNo, certYear, category, stokKodu }) {
  const fn = httpsCallable(functions, "importCocDriveFile");
  const res = await fn({ fileId, certNo, certYear, category, stokKodu });
  return res.data; // { success, coc: {...meta}, master: {...meta} }
}
