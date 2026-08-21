# UJI — A/B Testing & Experiment Analysis Toolkit

Toolkit web untuk menjalankan dan menyimpan analisis eksperimen A/B: uji signifikansi,
sample size / power calculator, upload CSV data mentah, analisis hasil pakai AI (Gemini),
dan riwayat eksperimen tersimpan.

**Stack:** React + Vite, Tailwind CSS v4, Supabase (Auth + Postgres), Vercel Serverless
Function + Gemini API (analisis AI). Semua perhitungan statistik (6 metode uji + sample
size calculator) diimplementasi manual di `src/lib/stats.js` — tidak pakai library
black-box, jadi setiap angka bisa ditelusuri ke rumusnya.

---

## 1. Setup Supabase (± 5 menit)

1. Buat project baru di [supabase.com](https://supabase.com) (gratis).
2. Masuk ke **SQL Editor** → **New query**, paste isi file `supabase/schema.sql`, lalu **Run**.
   Ini akan membuat tabel `experiments` lengkap dengan Row Level Security (RLS) — setiap
   user hanya bisa lihat/edit/hapus eksperimen miliknya sendiri.
3. Masuk ke **Project Settings → API**, salin `Project URL` dan `anon public` key.
4. Di root project, copy `.env.example` jadi `.env`, lalu isi:
   ```
   VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=isi-anon-key-kamu
   ```
5. **Opsional tapi disarankan:** di **Authentication → Providers**, matikan "Confirm email"
   kalau mau testing cepat tanpa verifikasi email dulu.

## 2. Setup Fitur Analisis AI (Gemini)

Fitur ini (tombol "Analisis dengan AI" di tiap hasil uji) jalan lewat Vercel Serverless
Function (`api/analyze.js`) yang manggil Gemini API di sisi server — jadi API key-nya
**tidak pernah** sampai ke browser. Kalau kamu skip bagian ini, sisa aplikasi tetap
berfungsi normal, cuma tombol "Analisis dengan AI" yang gak akan jalan.

1. Buka [Google AI Studio](https://aistudio.google.com/apikey), sign in, klik **Create API key**.
   Key baru yang dibuat sekarang otomatis jadi "auth key" (bukan "standard key" lama yang
   mulai September 2026 diblokir Google) — jadi gak perlu langkah migrasi tambahan.
2. Simpan API key itu. **Jangan** taruh di `.env` biasa dengan prefix `VITE_` — itu akan
   ke-bundle ke JS dan kelihatan siapa saja yang buka DevTools browser.
3. **Untuk deploy (Vercel):** masuk ke Project Settings → Environment Variables, tambahkan:
   ```
   GEMINI_API_KEY=isi-api-key-kamu
   ```
   (Opsional) `GEMINI_MODEL` kalau mau override model default — lihat catatan di bawah.
4. **Untuk testing lokal:** buat file `.env.local` di root project (terpisah dari `.env`,
   sudah otomatis di-gitignore), isi:
   ```
   GEMINI_API_KEY=isi-api-key-kamu
   ```
   Lalu jalankan pakai **Vercel CLI**, bukan `npm run dev` biasa — soalnya `/api/analyze`
   itu serverless function yang cuma dikenali Vercel, Vite gak tau route itu ada:
   ```bash
   npm install -g vercel
   vercel link      # sekali saja, hubungkan folder ini ke project Vercel kamu
   vercel dev
   ```

**Catatan soal nama model:** Google sering ganti-ganti nama model Gemini (dalam beberapa
bulan terakhir saja sudah dari `gemini-2.0-flash` → `gemini-2.5-flash` → seri `gemini-3.x-flash`).
Kalau default di kode (`gemini-3.5-flash`) sudah usang pas kamu baca ini, override lewat
env var `GEMINI_MODEL` tanpa perlu ubah kode — cek nama model terbaru di
[ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models).

## 3. Jalankan secara lokal

```bash
npm install
npm run dev
```

Buka `http://localhost:5173`. (Tombol "Analisis dengan AI" tidak akan berfungsi lewat cara
ini — perlu `vercel dev`, lihat bagian 2 di atas.)

## 4. Deploy ke Vercel

```bash
npm install -g vercel   # kalau belum ada
vercel
```

Saat deploy, tambahkan environment variables di dashboard Vercel → Project Settings →
Environment Variables:
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — wajib
- `GEMINI_API_KEY` — wajib kalau mau fitur Analisis AI aktif (opsional: `GEMINI_MODEL`)

## 5. Format CSV untuk fitur Upload

Data level-user, satu baris per user/sesi:

```csv
group,converted
control,0
control,1
variant,1
variant,1
```

atau untuk metrik kontinu (revenue, waktu, dsb):

```csv
group,value
control,45000
control,52000
variant,61000
```

`group` menerima: `control`/`variant`, `a`/`b`, atau `0`/`1`.

## Struktur Project

```
src/
  App.jsx              # seluruh UI: auth, 4 tab (kalkulator, sample size, upload, riwayat)
  lib/
    stats.js           # engine statistik (6 metode uji + sample size + CSV summarizer)
    supabaseClient.js  # koneksi Supabase
api/
  analyze.js           # Vercel Serverless Function — proxy ke Gemini API (server-side)
supabase/
  schema.sql                        # skema tabel + RLS policies (project baru)
  migration_001_add_test_types.sql  # jalankan ini kalau project Supabase-nya sudah lama ada
```

## Metode Statistik

**2 grup:**
- **Uji Proporsi** — two-proportion z-test dengan pooled SE untuk statistik uji, unpooled SE
  untuk confidence interval (pendekatan standar).
- **Uji Rata-rata** — Welch's t-test (tidak asumsi varians sama antar grup) dengan derajat
  bebas Welch–Satterthwaite.
- **Non-Parametrik** — Mann-Whitney U test, membandingkan ranking bukan rata-rata. Tidak
  butuh asumsi normalitas, tahan outlier. Pakai koreksi ties di varians.
- **Bayesian A/B Test** — model konjugat Beta-Binomial, probabilitas variant mengalahkan
  control dihitung lewat simulasi Monte Carlo (40.000 sampel) atas kedua posterior.

**Multi-varian (3+ grup):**
- **Chi-Square Test of Independence** — bandingkan conversion rate di banyak varian sekaligus.
- **One-Way ANOVA** — bandingkan rata-rata metrik kontinu di banyak varian sekaligus.

**Sample Size** — formula standar power analysis dua-proporsi, alokasi seimbang per arm.

Semua formula numerik (normal CDF, inverse normal, t-distribution, chi-square, incomplete
beta/gamma function) diimplementasi dari nol di `src/lib/stats.js` dan divalidasi terhadap
nilai referensi standar serta konsistensi matematis (mis. chi-square 2-grup = z², ANOVA
2-grup = t² pada varians sama).

## Grafik

Semua grafik dibuat pakai SVG murni (tanpa library charting) di `src/App.jsx`:
- **Kurva Distribusi** — normal approximation (frequentist) atau posterior Beta asli (Bayesian)
- **Forest Plot** — titik estimasi + confidence/credible interval, dipakai di semua metode
- **Strip Plot** — sebaran data mentah untuk Mann-Whitney (sesuai prinsip non-parametrik: tidak mengasumsikan bentuk kurva)
- **Trend Chart** — riwayat p-value dari eksperimen tersimpan dari waktu ke waktu (tab Riwayat)

## Analisis AI

Tombol "Analisis dengan AI" di tiap hasil uji mengirim ringkasan hasil (bukan data mentah)
ke Gemini lewat `/api/analyze.js`, minta interpretasi bisnis singkat dalam Bahasa Indonesia
(maks. 120 kata): apa artinya hasil ini, rekomendasi tindakan, dan catatan kehati-hatian
kalau relevan. Ini pelengkap opsional di atas interpretasi rule-based yang sudah selalu
tampil otomatis di tiap panel — bukan pengganti, karena rule-based tidak butuh API call
dan selalu tersedia meski `GEMINI_API_KEY` belum di-setup.

## Kalau kamu sudah pernah setup Supabase sebelumnya

Project ini menambah 4 tipe test baru (`chisquare`, `anova`, `mannwhitney`, `bayesian`).
Kalau tabel `experiments` kamu sudah dibuat dari versi sebelumnya, jalankan
`supabase/migration_001_add_test_types.sql` di SQL Editor supaya constraint-nya
mengizinkan tipe-tipe baru ini — kalau tidak, penyimpanan hasil test baru akan gagal.


