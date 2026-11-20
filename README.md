# The Grammar Surgery — Situs Baca (Frontend GitHub Pages)

Situs baca daring untuk buku **The Grammar Surgery: Membedah Logika 360 Kesalahan Tata Bahasa Inggris Pembelajar Indonesia** karya Bahruddin.

> **Penting — repositori ini TIDAK berisi naskah buku.**
> Folder ini hanya berisi *tampilan* (HTML, CSS, JavaScript, gambar). Seluruh isi bab disimpan di **Google Apps Script** milik penulis dan baru dikirim ke pembaca setelah kode akses diperiksa oleh server. Karena itu repositori ini aman dibuat **publik**.
> Jangan pernah mengunggah file `Data_*.html` ke repositori ini.

## Arsitektur singkat

```
Pembaca ──► GitHub Pages (repositori ini: tampilan saja)
                │  fetch POST (JSON)
                ▼
          Google Apps Script Web App  ──► Google Sheet "Data Pembaca"
          (isi bab, kode akses,             (tab Akses & Komentar)
           komentar, pengaturan)
```

## Langkah deploy

### 1. Siapkan backend Apps Script (sekali saja)
Ikuti `PANDUAN_Deploy.md` yang ada di paket **apps-script**. Di akhir langkah itu Anda mendapat URL Web App berbentuk:
```
https://script.google.com/macros/s/AKfycb…/exec
```

### 2. Isi alamat API
Buka `assets/js/config.js`, ganti teks `TEMPEL_URL_WEB_APP_APPS_SCRIPT_DI_SINI` dengan URL di atas:
```js
window.TGS_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycb…/exec"
};
```

### 3. Unggah ke GitHub
1. Buat repositori baru di GitHub, misalnya `grammar-surgery` (boleh publik).
2. Unggah **seluruh isi folder ini** (termasuk file tersembunyi `.nojekyll`) ke cabang `main`:
   - lewat web: **Add file → Upload files**, seret semua file dan folder; atau
   - lewat terminal:
     ```bash
     git init && git add . && git commit -m "Situs The Grammar Surgery"
     git branch -M main
     git remote add origin https://github.com/USERNAME/grammar-surgery.git
     git push -u origin main
     ```
3. Buka **Settings → Pages**. Pada *Build and deployment*, pilih **Source: Deploy from a branch**, cabang **main**, folder **/ (root)**, lalu **Save**.
4. Tunggu 1–2 menit. Situs tampil di `https://USERNAME.github.io/grammar-surgery/`.

### 4. (Opsional) Domain sendiri
Di **Settings → Pages → Custom domain**, isi misalnya `grammarsurgery.id`, lalu buat record DNS `CNAME` ke `USERNAME.github.io`. Centang **Enforce HTTPS**.

## Memperbarui situs
- **Info buku, harga, nomor WA, pengumuman, proteksi**: ubah dari panel admin (ketuk logo 5×). Tidak perlu mengubah repositori.
- **Tampilan/kode**: ubah file di repositori lalu *commit*; GitHub Pages memperbarui otomatis.
- **Gambar QRIS baru**: ganti `assets/img/qris.png` (nama file sama), atau isi kolom *URL gambar QRIS lain* di panel admin.

## Struktur folder
```
index.html              halaman utama
404.html                pengalihan ke beranda
site.webmanifest        ikon & nama saat dipasang di layar utama ponsel
assets/css/style.css    gaya tampilan
assets/js/config.js     ← ALAMAT API (wajib diisi)
assets/js/manifest.js   daftar isi buku (judul bab & subbab, tanpa isi)
assets/js/app.js        logika situs
assets/img/             logo, ikon, QRIS
```

## Pemecahan masalah
| Gejala | Penyebab & solusi |
|---|---|
| “Alamat API belum diatur” | `config.js` belum diisi URL `/exec`. |
| “Koneksi ke server gagal” | Web App belum di-deploy dengan akses **Anyone**, atau URL salah. Coba buka `URL?action=ping` di peramban; harus muncul `{"ok":true,…}`. |
| Perubahan kode Apps Script tidak terlihat | Setelah mengubah `Code.gs`, buat **New version** di *Manage deployments* (URL tetap sama). |
| Pembaca kehilangan akses setelah ganti ponsel | Di panel admin → Kode Akses → **Reset perangkat**, lalu pembaca memasukkan kode lagi. |

© 2027 Bahruddin. Seluruh isi buku dilindungi Undang-Undang Nomor 28 Tahun 2014 tentang Hak Cipta. Lihat `LICENSE.txt`.
