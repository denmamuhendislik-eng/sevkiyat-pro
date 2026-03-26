# Sevkiyat Pro — Kurulum ve Deploy Rehberi

## 1. Firebase Güvenlik Kuralları (ÖNEMLİ!)

Firebase Console → Firestore Database → **Rules** sekmesine gidin ve şunu yapıştırın:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if request.auth != null;
    }
    match /appData/{document=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

**Publish** tıklayın.

---

## 2. İlk Admin Hesabı

Firebase Console → Authentication → **Users** sekmesinde:
1. **Add user** tıklayın
2. Email ve şifre girin → **Add user**
3. Oluşturulan kullanıcının **UID**'sini kopyalayın (User UID sütunu)

Firebase Console → Firestore Database → **Data** sekmesinde:
1. **Start collection** → Collection ID: **users** → Next
2. Document ID: kopyaladığınız UID
3. Alanlar ekleyin:
   - email (string) → admin emailiniz
   - role (string) → **admin**
   - name (string) → adınız
4. **Save**

---

## 3. Bilgisayar Kurulumu

- https://nodejs.org → LTS indirip kurun
- https://git-scm.com → Git indirip kurun
- Bilgisayarı yeniden başlatın

---

## 4. Deploy

1. GitHub'da "sevkiyat-pro" repo oluşturun
2. ZIP'i masaüstüne açın, CMD açın:

```
cd Desktop\sevkiyat-pro
npm install
git init
git add .
git commit -m "ilk versiyon"
git branch -M main
git remote add origin https://github.com/ADINIZ/sevkiyat-pro.git
git push -u origin main
```

3. vercel.com → Add New → Project → repo seçin → Deploy

---

## 5. İlk Giriş

1. Vercel URL'nizi açın
2. Admin email/şifre ile giriş yapın
3. "Verileri Yükle" butonuna tıklayın → Excel verileri yüklenir
4. Sistem hazır!

---

## Roller

| Özellik | Admin | Görüntüleyici |
|---------|-------|---------------|
| Görüntüleme + Dashboard | ✅ | ✅ |
| PDF / Mail | ✅ | ✅ |
| Sevkiyat/sipariş ekleme | ✅ | ❌ |
| Hücre/tarih düzenleme | ✅ | ❌ |
| Kombine kural yönetimi | ✅ | ❌ |
| Kapasite ayarları | ✅ | ❌ |
| Kullanıcı yönetimi | ✅ | ❌ |
