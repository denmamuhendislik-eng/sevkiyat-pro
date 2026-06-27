/**
 * drive.js — Google Drive entegrasyonu (COC dokümanları otomatik öneri)
 *
 * Service Account (coc-drive-reader@sevkiyat-pro.iam) ile DENMA Workspace
 * Drive klasörlerini okur. Per-kategori arama stratejisi:
 *
 *   - Klasör tabanlı (measurement, fai): stokKodu adında alt klasörü bulur,
 *     içindeki dosyaları modifiedTime DESC sırasında döner.
 *
 *   - PDF içerik tabanlı (rawMaterialCert, surfaceTreatment): fullText
 *     araması ile stokKodu içeren PDF'leri bulur. altName (örn. "Q32 316")
 *     ile de arama yapabilir. Sadece ilgili kök klasörün içindeki dosyaları
 *     filtreler (ancestor walk).
 *
 * Driver config: Firestore appData/driveConfig dokümanı tutar.
 *   {
 *     foldersByCategory: {
 *       measurement: ["folder_id_1", "folder_id_2"],
 *       fai: ["folder_id"],
 *       rawMaterialCert: ["folder_id"],
 *       surfaceTreatment: ["folder_id"],   // hammadde ile aynı olabilir
 *     },
 *     strategyByCategory: {
 *       measurement: "folder",
 *       fai: "folder",
 *       rawMaterialCert: "fulltext",
 *       surfaceTreatment: "fulltext",
 *     },
 *   }
 */

const { google } = require("googleapis");
const { logger } = require("firebase-functions/v2");

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const MAX_RESULTS_PER_FOLDER = 10;
const MAX_RESULTS_TOTAL = 15;

// Service Account JWT auth client — secret'tan JSON key okur
function buildAuth(saKeyJson) {
  const credentials = typeof saKeyJson === "string" ? JSON.parse(saKeyJson) : saKeyJson;
  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: DRIVE_SCOPES,
  });
}

function getDrive(saKeyJson) {
  const auth = buildAuth(saKeyJson);
  return google.drive({ version: "v3", auth });
}

// Stok kodu adında alt klasörü bul (folder strategy).
// Önce direkt çocukta name='X' tam eşleşme; bulamazsa name contains 'X' ile ağaçta tüm SA-erişimli
// klasörlerde ara, sadece kök altındakileri al (yıl/tedarikçi gibi ara klasör varsa kapsar).
async function findStokSubfolders(drive, parentFolderId, stokKodu) {
  const escaped = stokKodu.replace(/'/g, "\\'");

  // 1) Direkt çocukta tam eşleşme
  try {
    const res = await drive.files.list({
      q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false`,
      fields: "files(id, name, parents)",
      pageSize: 5,
    });
    if (res.data.files?.length > 0) return res.data.files;
  } catch (e) {
    logger.debug("direct exact match hatası", { err: e.message });
  }

  // 2) Direkt çocukta substring eşleşme (boşluk/ek karakter toleranslı)
  try {
    const res = await drive.files.list({
      q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and name contains '${escaped}' and trashed=false`,
      fields: "files(id, name, parents)",
      pageSize: 10,
    });
    if (res.data.files?.length > 0) return res.data.files;
  } catch (e) {
    logger.debug("direct contains match hatası", { err: e.message });
  }

  // 3) GLOBAL Drive contains — derin hiyerarşilerde direkt çocuk araması işe yaramaz
  // (Müşteri/Yıl/Ay/Tarih/Stok gibi 5 seviye). Drive global arar, ata kontrolü kök altıyla sınırlar.
  try {
    const res = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name contains '${escaped}' and trashed=false`,
      fields: "files(id, name, parents)",
      pageSize: 100,
    });
    const candidates = res.data.files || [];
    if (candidates.length > 0) {
      const filtered = [];
      for (const f of candidates) {
        const isDescendant = await isDescendantOf(drive, f.id, [parentFolderId]);
        if (isDescendant) filtered.push(f);
      }
      if (filtered.length > 0) return filtered;
    }
  } catch (e) {
    logger.warn("global contains hatası", { err: e.message });
  }

  // 4) Son çare: BFS ile ağaç gezici (sadece global hiç bulamadıysa, 200 klasör limiti)
  try {
    const matches = await walkAndMatchFolders(drive, parentFolderId, stokKodu);
    return matches;
  } catch (e) {
    logger.warn("tree walk hatası", { err: e.message });
    return [];
  }
}

// Verilen kökten başlayarak klasör ağacını BFS ile gezer, adında stok kodu (case-insensitive
// includes) geçen tüm klasörleri döner. Eşleşen klasörün altına inmez (gereksiz).
// Güvenlik: max 200 klasör tara, max 8 seviye derine in.
async function walkAndMatchFolders(drive, rootFolderId, stokKodu) {
  const needle = String(stokKodu || "").toLowerCase();
  if (!needle) return [];
  const matches = [];
  const queue = [{ id: rootFolderId, depth: 0 }];
  const visited = new Set();
  let scanned = 0;
  while (queue.length > 0 && scanned < 200) {
    const { id, depth } = queue.shift();
    if (visited.has(id) || depth > 8) continue;
    visited.add(id);
    scanned++;
    let pageToken;
    do {
      const res = await drive.files.list({
        q: `'${id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "nextPageToken, files(id, name, parents)",
        pageSize: 100,
        pageToken,
      });
      const children = res.data.files || [];
      for (const c of children) {
        if (String(c.name || "").toLowerCase().includes(needle)) {
          matches.push(c); // eşleşen — içine inmiyoruz
        } else {
          queue.push({ id: c.id, depth: depth + 1 });
        }
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
  }
  return matches;
}

// Klasördeki dosyaları listele (PDF + diğerleri), modifiedTime DESC
async function listFolderFiles(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name, mimeType, size, modifiedTime, webViewLink)",
    orderBy: "modifiedTime desc",
    pageSize: MAX_RESULTS_PER_FOLDER,
  });
  return res.data.files || [];
}

// Strateji 1 — Klasör tabanlı arama (Ölçüm, FAİ)
// parentFolderIds dizisindeki her kökte stokKodu içeren tüm alt klasörleri bulur, dosyalarını döner
async function searchByFolder(drive, parentFolderIds, stokKodu) {
  const all = [];
  const seenFolderIds = new Set();
  for (const parentId of parentFolderIds) {
    try {
      const subs = await findStokSubfolders(drive, parentId, stokKodu);
      for (const sub of subs) {
        if (seenFolderIds.has(sub.id)) continue;
        seenFolderIds.add(sub.id);
        const files = await listFolderFiles(drive, sub.id);
        for (const f of files) {
          all.push({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            size: Number(f.size || 0),
            modifiedTime: f.modifiedTime,
            webViewLink: f.webViewLink,
            parentFolderName: sub.name,
            parentFolderId: sub.id,
          });
        }
      }
    } catch (e) {
      logger.warn("searchByFolder hatası", { parentId, stokKodu, err: e.message });
    }
  }
  all.sort((a, b) => (b.modifiedTime || "").localeCompare(a.modifiedTime || ""));
  return all.slice(0, MAX_RESULTS_TOTAL);
}

// Bir dosyanın ata zincirinde belirli bir root klasör var mı kontrol et
async function isDescendantOf(drive, fileId, rootFolderIds) {
  const rootSet = new Set(rootFolderIds);
  const visited = new Set();
  const queue = [fileId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    if (rootSet.has(id)) return true;
    try {
      const res = await drive.files.get({ fileId: id, fields: "parents" });
      const parents = res.data.parents || [];
      for (const p of parents) {
        if (rootSet.has(p)) return true;
        queue.push(p);
      }
    } catch (e) {
      // SA'nın yetkisi yok ya da silinmiş — devam
      logger.debug("isDescendantOf parents alınamadı", { id, err: e.message });
    }
  }
  return false;
}

// Strateji 2 — Full-text arama (Hammadde, Fason)
// stokKodu (ve varsa altName) için Drive'da PDF içerik aramasını kullanır,
// sonuçları kök klasörlerin altında olanlarla sınırlar
async function searchByFullText(drive, rootFolderIds, stokKodu, altName) {
  const terms = [stokKodu];
  if (altName && altName.trim()) terms.push(altName.trim());

  const allFound = [];
  const seen = new Set();
  for (const term of terms) {
    const escaped = term.replace(/'/g, "\\'");
    // fullText OR name içerebilir — birini bulmak yeter
    const q = `(fullText contains '${escaped}' or name contains '${escaped}') and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
    try {
      const res = await drive.files.list({
        q,
        fields: "files(id, name, mimeType, size, modifiedTime, webViewLink, parents)",
        orderBy: "modifiedTime desc",
        pageSize: 50, // daha fazla çek, ata kontrolü ile filtreleyeceğiz
      });
      const files = res.data.files || [];
      for (const f of files) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        allFound.push(f);
      }
    } catch (e) {
      logger.warn("searchByFullText hatası", { term, err: e.message });
    }
  }

  // Sadece kök klasörlerin altındakileri filtrele
  const filtered = [];
  for (const f of allFound) {
    const isDescendant = await isDescendantOf(drive, f.id, rootFolderIds);
    if (isDescendant) {
      filtered.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: Number(f.size || 0),
        modifiedTime: f.modifiedTime,
        webViewLink: f.webViewLink,
      });
    }
  }
  filtered.sort((a, b) => (b.modifiedTime || "").localeCompare(a.modifiedTime || ""));
  return filtered.slice(0, MAX_RESULTS_TOTAL);
}

// Ana arama fonksiyonu
async function searchDriveCategory(saKeyJson, { category, stokKodu, altName, driveConfig }) {
  if (!stokKodu) throw new Error("stokKodu zorunlu");
  if (!driveConfig?.foldersByCategory?.[category]?.length) {
    return { results: [], message: `'${category}' için Drive klasörü yapılandırılmamış` };
  }

  const drive = getDrive(saKeyJson);
  const folderIds = driveConfig.foldersByCategory[category];
  const strategy = driveConfig.strategyByCategory?.[category] || "folder";

  let results;
  if (strategy === "fulltext") {
    results = await searchByFullText(drive, folderIds, stokKodu, altName);
  } else {
    results = await searchByFolder(drive, folderIds, stokKodu);
    // Eğer folder stratejisinde bulamadıysak ve altName varsa, fulltext'e fallback (Q32 316 gibi)
    if (results.length === 0 && altName && altName.trim()) {
      results = await searchByFullText(drive, folderIds, altName.trim(), null);
    }
  }
  return { results, strategy };
}

// Dosyayı Drive'dan indir (stream → Buffer)
async function downloadDriveFile(saKeyJson, fileId) {
  const drive = getDrive(saKeyJson);
  // Önce metadata
  const meta = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, size",
  });
  // Sonra binary content
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return {
    filename: meta.data.name,
    contentType: meta.data.mimeType,
    size: Number(meta.data.size || 0),
    buffer: Buffer.from(res.data),
  };
}

module.exports = {
  searchDriveCategory,
  downloadDriveFile,
};
