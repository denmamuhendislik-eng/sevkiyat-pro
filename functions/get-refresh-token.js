/**
 * get-refresh-token.js — TEK SEFERLİK kullanılan helper script
 *
 * Amaç:
 *   denmasevkiyatpro@gmail.com hesabı için Gmail API erişimi sağlayan bir
 *   refresh token üret ve refresh-token.json dosyasına yaz.
 *
 * Çalıştırma:
 *   cd ~/sevkiyat-pro/functions
 *   node get-refresh-token.js
 *
 * Akış:
 *   1. Script bir URL bastıracak
 *   2. URL'yi tarayıcıda aç (mac'te otomatik açılmaya çalışacak)
 *   3. denmasevkiyatpro@gmail.com hesabıyla giriş yap
 *   4. Sevkiyat Pro VIO Mail Reader uygulamasına Gmail erişim izni ver
 *   5. Tarayıcı seni localhost:53682/?code=... adresine yönlendirecek
 *   6. (Sayfa yüklenemez hatası verebilir — bu NORMAL, biz code'u zaten yakalıyoruz)
 *   7. Script otomatik olarak code'u işleyip refresh token'ı dosyaya yazacak
 *
 * Çıktı:
 *   refresh-token.json — gizli, .gitignore'da, deploy'da Functions env'e aktarılacak
 *
 * Bu script SADECE 1 KEZ çalıştırılır. Refresh token expire olmaz
 * (Google manuel iptal etmedikçe).
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");
const { exec } = require("child_process");
const { google } = require("googleapis");

// Gmail readonly scope — sadece okuma yetkisi, mail silemez/gönderemez
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

const CLIENT_PATH = path.join(__dirname, "oauth-client.json");
const TOKEN_PATH = path.join(__dirname, "refresh-token.json");
const CALLBACK_PORT = 53682;
const CALLBACK_URI = `http://localhost:${CALLBACK_PORT}/`;

function loadClientSecrets() {
  if (!fs.existsSync(CLIENT_PATH)) {
    console.error("❌ oauth-client.json bulunamadı:", CLIENT_PATH);
    console.error("   Önce Google Cloud Console'dan Desktop OAuth client oluşturup");
    console.error("   indirdiğin JSON'u functions/ klasörüne taşımalısın.");
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(CLIENT_PATH, "utf8"));
  // Desktop client format: { installed: { client_id, client_secret, ... } }
  const cfg = raw.installed || raw.web;
  if (!cfg || !cfg.client_id || !cfg.client_secret) {
    console.error("❌ oauth-client.json formatı geçersiz. Desktop app türünde olmalı.");
    console.error("   Beklenen yapı: { installed: { client_id, client_secret, ... } }");
    process.exit(1);
  }
  return cfg;
}

function openInBrowser(targetUrl) {
  const platform = process.platform;
  let cmd;
  if (platform === "darwin") cmd = `open "${targetUrl}"`;
  else if (platform === "win32") cmd = `start "" "${targetUrl}"`;
  else cmd = `xdg-open "${targetUrl}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log("\n   (Tarayıcı otomatik açılamadı, URL'yi manuel kopyala-yapıştır.)");
    }
  });
}

async function main() {
  const cfg = loadClientSecrets();

  const oAuth2Client = new google.auth.OAuth2(
    cfg.client_id,
    cfg.client_secret,
    CALLBACK_URI,
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // her seferinde refresh token gönderilsin
    scope: SCOPES,
  });

  console.log("\n========================================================");
  console.log(" GMAIL OAUTH — TEK SEFERLİK REFRESH TOKEN ÜRETİCİ");
  console.log("========================================================\n");
  console.log("1) Aşağıdaki URL otomatik olarak tarayıcıda açılacak.");
  console.log("   Açılmazsa kopyala-yapıştır:\n");
  console.log("   " + authUrl + "\n");
  console.log("2) denmasevkiyatpro@gmail.com hesabıyla giriş yap.");
  console.log("3) 'Sevkiyat Pro VIO Mail Reader' uygulamasına Gmail erişimi ver.");
  console.log("4) Yönlendirme localhost:53682'ye gelecek (bu script orada dinliyor).");
  console.log("   Tarayıcı 'sayfa açılamadı' gibi bir şey gösterebilir, ÖNEMSEME —");
  console.log("   bu pencerede zaten code yakalandı.");
  console.log("\n[Script tarayıcı yönlendirmesini bekliyor... Ctrl+C ile iptal edebilirsin.]\n");

  // Yerel HTTP sunucusu — Google'ın yönlendirmesini yakalamak için
  const server = http.createServer(async (req, res) => {
    try {
      const parsed = url.parse(req.url, true);
      const code = parsed.query.code;
      const error = parsed.query.error;

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>Hata</h1><p>${error}</p><p>Bu pencereyi kapat ve script'i tekrar çalıştır.</p>`);
        console.error("\n❌ OAuth hatası:", error);
        server.close();
        process.exit(1);
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Beklenmedik istek</h1><p>code parametresi yok.</p>");
        return;
      }

      // Code'u token'a çevir
      const { tokens } = await oAuth2Client.getToken(code);

      if (!tokens.refresh_token) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Hata</h1><p>Refresh token alınamadı. Tekrar dene.</p>");
        console.error("\n❌ Refresh token gelmedi! Bu hesap için daha önce izin verilmiş olabilir.");
        console.error("   Çözüm: https://myaccount.google.com/permissions adresine git,");
        console.error("   'Sevkiyat Pro VIO Mail Reader' uygulamasının erişimini iptal et,");
        console.error("   sonra script'i tekrar çalıştır.");
        server.close();
        process.exit(1);
      }

      // Dosyaya yaz
      const tokenData = {
        refresh_token: tokens.refresh_token,
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        scope: SCOPES.join(" "),
        obtained_at: new Date().toISOString(),
      };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenData, null, 2));

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html><head><title>Başarılı</title>
        <style>body{font-family:system-ui;max-width:600px;margin:60px auto;padding:20px;background:#f5f5f5;}
        .box{background:#fff;padding:30px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);}
        h1{color:#1D9E75;margin:0 0 12px;}</style></head>
        <body><div class="box">
          <h1>✓ Refresh token alındı</h1>
          <p>Bu pencereyi kapatabilirsin. Terminale geri dön.</p>
          <p style="color:#666;font-size:13px">Token <code>functions/refresh-token.json</code> dosyasına yazıldı.</p>
        </div></body></html>
      `);

      console.log("✓ Refresh token alındı ve refresh-token.json dosyasına yazıldı.");
      console.log("  Konum:", TOKEN_PATH);
      console.log("\n→ Sonraki adım: Bu token'ı Firebase Functions ortam değişkenine aktarmak.");
      console.log("  Claude'a 'token alındı' yaz, devam edelim.\n");

      server.close();
      process.exit(0);
    } catch (err) {
      console.error("\n❌ Token değişimi hatası:", err.message);
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Hata</h1><pre>" + err.message + "</pre>");
      server.close();
      process.exit(1);
    }
  });

  server.listen(CALLBACK_PORT, () => {
    openInBrowser(authUrl);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${CALLBACK_PORT} zaten kullanılıyor.`);
      console.error("   Başka bir terminal'de bu script açık olabilir, kapatıp tekrar dene.");
    } else {
      console.error("\n❌ Server hatası:", err);
    }
    process.exit(1);
  });
}

main().catch((err) => {
  console.error("\n❌ Fatal:", err);
  process.exit(1);
});
