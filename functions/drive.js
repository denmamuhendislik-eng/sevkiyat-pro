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
const MAX_RESULTS_PER_FOLDER = 100; // klasör başına dosya tavanı (paginate ile)
const MAX_RESULTS_TOTAL = 50;       // tüm sonuç tavanı

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
    const t0 = Date.now();
    const res = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name contains '${escaped}' and trashed=false`,
      fields: "files(id, name, parents)",
      pageSize: 100,
    });
    const candidates = res.data.files || [];
    console.log(`[drive] global contains '${stokKodu}' → ${candidates.length} aday (${Date.now() - t0}ms)`);
    if (candidates.length > 0) {
      // Ata kontrolleri paralel — hintedParents ile direkt çocuk ise tek API çağrısı bile yok
      const checks = await Promise.all(
        candidates.map(async (f) => ({
          f,
          ok: await isDescendantOf(drive, f.id, [parentFolderId], f.parents),
        })),
      );
      const filtered = checks.filter((x) => x.ok).map((x) => x.f);
      console.log(`[drive] ata filtresi sonrası ${filtered.length} klasör (${Date.now() - t0}ms toplam)`);
      if (filtered.length > 0) return filtered;
    }
  } catch (e) {
    console.warn("[drive] global contains hatası", e.message);
  }

  // BFS fallback kapatıldı (timing analizi: tek bir negatif kökte 40s+ harcıyordu).
  // Global contains derin hiyerarşileri kapsıyor; bulunamayan klasör için boş döner.
  console.log(`[drive] '${stokKodu}' için '${parentFolderId}' kökünde bulunamadı`);
  return [];
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

// Klasördeki TÜM dosyaları listele (paginate edilir), modifiedTime DESC.
async function listFolderFiles(drive, folderId) {
  const out = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink)",
      orderBy: "modifiedTime desc",
      pageSize: MAX_RESULTS_PER_FOLDER,
      pageToken,
    });
    out.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken && out.length < 500); // güvenlik tavanı 500
  return out;
}

// Strateji 1 — Klasör tabanlı arama (Ölçüm, FAİ)
// parentFolderIds dizisindeki her kökte stokKodu içeren tüm alt klasörleri PARALEL arar,
// dosyalarını PARALEL listeler, birleştirir.
async function searchByFolder(drive, parentFolderIds, stokKodu) {
  const tStart = Date.now();
  const perRootSubs = await Promise.all(
    parentFolderIds.map(async (parentId) => {
      try {
        return await findStokSubfolders(drive, parentId, stokKodu);
      } catch (e) {
        console.warn("[drive] searchByFolder kök hatası", parentId, e.message);
        return [];
      }
    }),
  );
  const allSubs = [];
  const seenFolderIds = new Set();
  for (const subs of perRootSubs) {
    for (const sub of subs) {
      if (seenFolderIds.has(sub.id)) continue;
      seenFolderIds.add(sub.id);
      allSubs.push(sub);
    }
  }
  console.log(`[drive] toplam ${allSubs.length} benzersiz alt klasör bulundu (${Date.now() - tStart}ms)`);

  // Dosya listeleme paralel + relative path
  const fileLists = await Promise.all(
    allSubs.map(async (sub) => {
      try {
        const files = await listFolderFiles(drive, sub.id);
        // Sub klasörünün kendi path'i (kökten sub'a kadar)
        const subPath = await buildRelativePath(drive, sub.id, sub.parents, parentFolderIds);
        const fullSubPath = subPath ? `${subPath} / ${sub.name}` : sub.name;
        return files.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: Number(f.size || 0),
          modifiedTime: f.modifiedTime,
          webViewLink: f.webViewLink,
          parentFolderName: sub.name,
          parentFolderId: sub.id,
          relativePath: fullSubPath,
        }));
      } catch (e) {
        console.warn("[drive] listFolderFiles hatası", sub.id, e.message);
        return [];
      }
    }),
  );
  const all = fileLists.flat();
  all.sort((a, b) => (b.modifiedTime || "").localeCompare(a.modifiedTime || ""));
  console.log(`[drive] toplam ${all.length} dosya (${Date.now() - tStart}ms toplam)`);
  return all.slice(0, MAX_RESULTS_TOTAL);
}

// Çağrı başına parents/name cache — aynı kök/yıl/ay/tarih klasörleri birden çok yol paylaşır,
// 100 adayın hepsi aynı 5-6 ara klasörü tekrar tekrar sorgulamasın diye memoize ediyoruz.
const _parentsCache = new Map();
const _folderNameCache = new Map(); // klasör adı için ayrı cache
function _resetParentsCache() { _parentsCache.clear(); _folderNameCache.clear(); }

async function _getParents(drive, fileId) {
  if (_parentsCache.has(fileId)) return _parentsCache.get(fileId);
  try {
    const res = await drive.files.get({ fileId, fields: "parents" });
    const parents = res.data.parents || [];
    _parentsCache.set(fileId, parents);
    return parents;
  } catch (e) {
    _parentsCache.set(fileId, []);
    return [];
  }
}

async function _getFolderName(drive, folderId) {
  if (_folderNameCache.has(folderId)) return _folderNameCache.get(folderId);
  try {
    const res = await drive.files.get({ fileId: folderId, fields: "name, parents" });
    const name = res.data.name || "";
    _folderNameCache.set(folderId, name);
    // parents'i de cache'le (bedava)
    if (res.data.parents) _parentsCache.set(folderId, res.data.parents);
    return name;
  } catch (e) {
    _folderNameCache.set(folderId, "");
    return "";
  }
}

// Bir dosyanın kök altındaki path'ini döner ("Müşteri / Yıl / Ay / Tarih" gibi)
// rootFolderIds zincirinin son üyesinden başlayıp dosyanın direkt parent'ına kadar.
async function buildRelativePath(drive, fileId, hintedParents, rootFolderIds, maxDepth = 8) {
  const rootSet = new Set(rootFolderIds);
  const chain = [];
  const visited = new Set();
  let current = Array.isArray(hintedParents) && hintedParents.length > 0 ? hintedParents[0] : null;
  if (!current) {
    const parents = await _getParents(drive, fileId);
    current = parents[0] || null;
  }
  while (current && !visited.has(current) && chain.length < maxDepth) {
    visited.add(current);
    if (rootSet.has(current)) break;
    const name = await _getFolderName(drive, current);
    if (name) chain.unshift(name);
    const parents = await _getParents(drive, current);
    current = parents[0] || null;
  }
  return chain.join(" / ");
}

// Bir dosyanın ata zincirinde belirli bir root klasör var mı kontrol et.
// hintedParents: ilk seviye direkt parent ID'leri (Drive search response'tan gelir, ekstra API çağrısı kazandırır)
async function isDescendantOf(drive, fileId, rootFolderIds, hintedParents) {
  const rootSet = new Set(rootFolderIds);
  // Fast path 1: kendisi kök mü?
  if (rootSet.has(fileId)) return true;
  // Fast path 2: hint olarak direkt parent verilmişse, hemen kontrol et
  if (Array.isArray(hintedParents) && hintedParents.length > 0) {
    for (const p of hintedParents) {
      if (rootSet.has(p)) return true;
    }
  }
  // Walk up
  const visited = new Set([fileId]);
  const queue = Array.isArray(hintedParents) && hintedParents.length > 0
    ? [...hintedParents]
    : [fileId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    if (rootSet.has(id)) return true;
    const parents = await _getParents(drive, id);
    for (const p of parents) {
      if (rootSet.has(p)) return true;
      queue.push(p);
    }
  }
  return false;
}

// Terimi Drive'ın istediği şekilde 'name contains' sorgusuna çevir.
// Hyphen'lı stok kodları (MM-9111-2765) için: 'name contains "MM-9111-2765"' yanı sıra
// 'name contains "MM" and name contains "9111" and name contains "2765"' (token bazlı AND).
// Drive tokenizer hyphen'da split ettiği için ikinci sorgu daha güvenilir match yakalar.
function buildNameContainsQueries(term) {
  const escaped = term.replace(/'/g, "\\'");
  const queries = [`name contains '${escaped}'`];
  // Token bazlı: hyphen/space ile böl, 3+ karakterlik tokenları AND ile birleştir.
  // (Drive 2 karakterli token'ları indekslemiyor — 'MM' query'yi sıfırlardı)
  const tokens = term.split(/[\s\-_]+/).filter((t) => t.length >= 3);
  if (tokens.length >= 1) {
    const tokenQuery = tokens
      .map((t) => `name contains '${t.replace(/'/g, "\\'")}'`)
      .join(" and ");
    queries.push(tokenQuery);
  }
  return queries;
}

// Strateji 2 — Full-text arama (Hammadde, Fason)
// stokKodu (ve varsa altName) için Drive'da PDF içerik aramasını PARALEL yapar,
// sonuçları kök klasörlerin altında olanlarla sınırlar (hint'li ata + paralel filtre)
async function searchByFullText(drive, rootFolderIds, stokKodu, altName) {
  const tStart = Date.now();
  const terms = [stokKodu];
  if (altName && altName.trim()) terms.push(altName.trim());

  // Her terim için 1-2 sorgu üret (name substring + token-AND), hepsini paralel çalıştır
  const allQueries = [];
  for (const term of terms) {
    const escaped = term.replace(/'/g, "\\'");
    // FullText contains (PDF içerik) — substring olarak çalışır
    allQueries.push({
      term,
      q: `fullText contains '${escaped}' and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
      kind: "fullText",
    });
    // Name contains (dosya adı) — Drive tokenizer, hem substring hem token-AND varyasyonları
    for (const nq of buildNameContainsQueries(term)) {
      allQueries.push({
        term,
        q: `${nq} and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
        kind: "name",
      });
    }
  }
  const perTermResults = await Promise.all(
    allQueries.map(async ({ term, q, kind }) => {
      try {
        const res = await drive.files.list({
          q,
          fields: "files(id, name, mimeType, size, modifiedTime, webViewLink, parents)",
          orderBy: "modifiedTime desc",
          pageSize: 50,
        });
        const files = res.data.files || [];
        console.log(`[drive] ${kind} '${term}' → ${files.length} aday`);
        return files;
      } catch (e) {
        console.warn("[drive] searchByFullText sorgu hatası", term, kind, e.message);
        return [];
      }
    }),
  );
  const seen = new Set();
  const allFound = [];
  for (const list of perTermResults) {
    for (const f of list) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      allFound.push(f);
    }
  }
  console.log(`[drive] fullText '${stokKodu}' → ${allFound.length} aday (${Date.now() - tStart}ms)`);

  // Ata kontrolleri paralel + hint'li (direkt parent verisi kullanılır)
  const checks = await Promise.all(
    allFound.map(async (f) => ({
      f,
      ok: await isDescendantOf(drive, f.id, rootFolderIds, f.parents),
    })),
  );
  const filteredRaw = checks.filter((x) => x.ok).map((x) => x.f);
  // Her sonuç için relative path (kökten dosyaya kadar klasör zinciri)
  const filtered = await Promise.all(
    filteredRaw.map(async (f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: Number(f.size || 0),
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
      relativePath: await buildRelativePath(drive, f.id, f.parents, rootFolderIds),
    })),
  );
  filtered.sort((a, b) => (b.modifiedTime || "").localeCompare(a.modifiedTime || ""));
  console.log(`[drive] fullText ata filtresi sonrası ${filtered.length} (${Date.now() - tStart}ms toplam)`);
  return filtered.slice(0, MAX_RESULTS_TOTAL);
}

// Ana arama fonksiyonu
async function searchDriveCategory(saKeyJson, { category, stokKodu, altName, driveConfig }) {
  if (!stokKodu) throw new Error("stokKodu zorunlu");
  if (!driveConfig?.foldersByCategory?.[category]?.length) {
    return { results: [], message: `'${category}' için Drive klasörü yapılandırılmamış` };
  }

  _resetParentsCache(); // çağrı başına temiz başla
  const drive = getDrive(saKeyJson);
  const folderIds = driveConfig.foldersByCategory[category];
  const strategy = driveConfig.strategyByCategory?.[category] || "folder";
  console.log(`[drive] arama başladı: ${category}/${stokKodu} (strateji: ${strategy}, ${folderIds.length} kök)`);

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
