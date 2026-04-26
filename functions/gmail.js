/**
 * gmail.js — Gmail API ile mail çekme + attachment indirme
 *
 * Bu modül VIO'nun sabah gönderdiği 3 raporu Gmail'den çeker:
 *   - "Son Stok Raporu Operasyon (Stok)"
 *   - "Bekleyen Operasyonlar (Ürünlü)"
 *   - "Sipariş Kontrol Listesi (Belge No)"
 *
 * Her rapor için son 24 saatin en son mailini bulur, attachment'ı indirir,
 * Buffer olarak döndürür. Parser'lar Buffer'ı XLSX.read ile okur.
 *
 * Refresh token Firebase Functions secret'ından alınır (REFRESH_TOKEN env).
 * Client credentials oauth-client.json'dan veya environment'tan alınır.
 */

const { google } = require("googleapis");

/**
 * VIO mail tanımları — subject pattern + Firestore doc adı eşleşmesi
 */
const VIO_REPORTS = [
  {
    type: "stock",
    docName: "mrpStock",
    // Subject'te bunun olması gerek (case-insensitive substring)
    subjectMatch: "son stok raporu",
    label: "Son Stok Raporu Operasyon (Stok)",
  },
  {
    type: "akibet",
    docName: "mrpAkibet",
    subjectMatch: "bekleyen operasyonlar",
    label: "Bekleyen Operasyonlar (Ürünlü)",
  },
  {
    type: "purchase",
    docName: "mrpPurchase",
    subjectMatch: "sipariş kontrol listesi",
    label: "Sipariş Kontrol Listesi (Belge No)",
  },
  {
    type: "salesOrders",
    docName: "salesOrders",
    subjectMatch: "sipariş raporu toplamlı",
    label: "Sipariş Raporu Toplamlı (Müşteri Alt Hesaplı)",
  },
];

/**
 * OAuth2 client kur. Refresh token ile access token otomatik yenilenir.
 */
function createOAuthClient({ clientId, clientSecret, refreshToken }) {
  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  return oAuth2Client;
}

/**
 * Gmail API client oluştur
 */
function getGmailClient(auth) {
  return google.gmail({ version: "v1", auth });
}

/**
 * Belirli bir subject pattern için son 1 günün en son mailini bul.
 * Birden fazla varsa en yenisini döndürür.
 *
 * @param {object} gmail - gmail client
 * @param {string} subjectMatch - aranacak subject substring
 * @param {number} lookbackHours - kaç saat geriye bakılacak (default 24)
 * @returns {Promise<{messageId, subject, internalDate}|null>}
 */
async function findLatestMessage(gmail, subjectMatch, lookbackHours = 24) {
  // Gmail search query: subject + son N saat
  // newer_than:1d → son 1 gün, ama biz saat bazında istiyoruz
  // Workaround: after:<unix-seconds>
  const cutoffSeconds = Math.floor((Date.now() - lookbackHours * 3600 * 1000) / 1000);
  const query = `subject:"${subjectMatch}" has:attachment after:${cutoffSeconds}`;

  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 10, // birden fazla varsa en yenisini seçeceğiz
  });

  const messages = res.data.messages || [];
  if (messages.length === 0) return null;

  // Her message için tam detay çek (internalDate için), en yenisini seç
  const detailed = await Promise.all(
    messages.map((m) =>
      gmail.users.messages.get({
        userId: "me",
        id: m.id,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      }),
    ),
  );

  const sorted = detailed
    .map((r) => ({
      messageId: r.data.id,
      subject:
        (r.data.payload?.headers || []).find((h) => h.name === "Subject")?.value || "",
      internalDate: parseInt(r.data.internalDate || "0", 10),
    }))
    .sort((a, b) => b.internalDate - a.internalDate);

  return sorted[0];
}

/**
 * Mesajdaki ilk Excel attachment'ını (.xls veya .xlsx) Buffer olarak indir.
 *
 * @param {object} gmail
 * @param {string} messageId
 * @returns {Promise<{filename, buffer, mimeType}>}
 */
async function downloadFirstExcelAttachment(gmail, messageId) {
  const msg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  // Attachment'ları parts içinde ara (recursive — multipart olabilir)
  const findAttachmentPart = (parts) => {
    if (!parts) return null;
    for (const p of parts) {
      const filename = p.filename || "";
      const isExcel = /\.xlsx?$/i.test(filename);
      if (isExcel && p.body?.attachmentId) {
        return p;
      }
      if (p.parts) {
        const inner = findAttachmentPart(p.parts);
        if (inner) return inner;
      }
    }
    return null;
  };

  const part = findAttachmentPart(msg.data.payload?.parts || []);
  if (!part) {
    throw new Error(`Mailde Excel attachment bulunamadı: messageId=${messageId}`);
  }

  const att = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: part.body.attachmentId,
  });

  // Gmail attachment data base64url encoded gelir → Buffer'a çevir
  const base64Data = att.data.data.replace(/-/g, "+").replace(/_/g, "/");
  const buffer = Buffer.from(base64Data, "base64");

  return {
    filename: part.filename,
    buffer,
    mimeType: part.mimeType || "application/octet-stream",
  };
}

/**
 * Tüm VIO raporları için son maili bulup attachment'ları indir.
 *
 * @param {object} auth - OAuth2 client
 * @param {number} lookbackHours
 * @returns {Promise<Array<{type, docName, label, status, filename?, buffer?, error?, subject?, internalDate?}>>}
 */
async function fetchAllVioReports(auth, lookbackHours = 24) {
  const gmail = getGmailClient(auth);
  const results = [];

  for (const report of VIO_REPORTS) {
    try {
      const msg = await findLatestMessage(gmail, report.subjectMatch, lookbackHours);
      if (!msg) {
        results.push({
          type: report.type,
          docName: report.docName,
          label: report.label,
          status: "not_found",
          error: `Son ${lookbackHours} saatte "${report.subjectMatch}" subject'li mail bulunamadı`,
        });
        continue;
      }

      const attachment = await downloadFirstExcelAttachment(gmail, msg.messageId);

      results.push({
        type: report.type,
        docName: report.docName,
        label: report.label,
        status: "ok",
        messageId: msg.messageId,
        subject: msg.subject,
        internalDate: msg.internalDate,
        filename: attachment.filename,
        buffer: attachment.buffer,
        mimeType: attachment.mimeType,
      });
    } catch (err) {
      results.push({
        type: report.type,
        docName: report.docName,
        label: report.label,
        status: "error",
        error: err.message,
      });
    }
  }

  return results;
}

module.exports = {
  VIO_REPORTS,
  createOAuthClient,
  getGmailClient,
  findLatestMessage,
  downloadFirstExcelAttachment,
  fetchAllVioReports,
};
