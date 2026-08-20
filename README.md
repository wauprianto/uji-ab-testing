# UJI — A/B Testing & Experiment Analysis Toolkit

Toolkit web untuk menjalankan dan menyimpan analisis eksperimen A/B: uji signifikansi,
sample size / power calculator, upload CSV data mentah, dan riwayat eksperimen tersimpan.

**Stack:** React + Vite, Tailwind CSS v4, Supabase (Auth + Postgres). Semua perhitungan
statistik (two-proportion z-test, Welch's t-test, sample size calculator) diimplementasi
manual di `src/lib/stats.js` — tidak pakai library black-box, jadi setiap angka bisa
ditelusuri ke rumusnya.

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

## 2. Jalankan secara lokal

```bash
npm install
npm run dev
```

Buka `http://localhost:5173`.

## 3. Deploy ke Vercel

```bash
npm install -g vercel   # kalau belum ada
vercel
```

Saat deploy, tambahkan environment variables yang sama (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`) di dashboard Vercel → Project Settings → Environment Variables.

## 4. Format CSV untuk fitur Upload

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

## Kalau kamu sudah pernah setup Supabase sebelumnya

Project ini menambah 4 tipe test baru (`chisquare`, `anova`, `mannwhitney`, `bayesian`).
Kalau tabel `experiments` kamu sudah dibuat dari versi sebelumnya, jalankan
`supabase/migration_001_add_test_types.sql` di SQL Editor supaya constraint-nya
mengizinkan tipe-tipe baru ini — kalau tidak, penyimpanan hasil test baru akan gagal.


