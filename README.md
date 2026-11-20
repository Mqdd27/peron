# Peron

Panduan transportasi umum Jakarta dalam bentuk PWA. Peron menggabungkan MRT, KRL, KA Bandara, LRT Jakarta, LRT Jabodebek, dan Transjakarta dalam satu peta skema interaktif dan satu peta jalan, lengkap dengan jadwal, pintu keluar stasiun, dan posisi kendaraan.

Bisa dipasang di layar utama HP. Setelah dibuka sekali saat online, Skema, jadwal, dan data stasiun tetap bisa dipakai tanpa internet. Peta jalan hanya menampilkan area yang pernah dibuka.

## Fitur

**Peta skema (Skema)**
- Peta integrasi seluruh jaringan: semua lin KRL, KA Bandara, LRT, MRT, dan koridor Transjakarta 1–14
- Tata letak dibuat otomatis dari koordinat asli (bukan salinan peta resmi), dengan garis oktilinear dan jalur bersama digambar berdampingan
- Transfer antarmoda: konektor dalam satu kompleks dan zona transfer jalan kaki
- Kendaraan bergerak di peta: MRT dari jadwal, moda lain berupa simulasi berdasarkan interval
- 33 landmark 3D (Monas, GBK, mal, terminal bus, dan lainnya) yang bisa disembunyikan

**Peta jalan (Peta)**
- Peta MapLibre dengan semua stasiun dan halte, pintu keluar MRT, dan lokasi GPS pengguna
- Pindah dari Skema ke Peta langsung fokus ke stasiun atau halte yang sedang dibuka

**Panel detail**
- Stasiun MRT: kereta berikutnya per arah, peta pintu keluar, info peron dan integrasi
- Stasiun KRL/LRT dan halte Transjakarta: jalur yang lewat, interval bus per jam, pintu masuk, transit terdekat
- Jalur: ketuk garis di Skema atau Peta untuk melihat semua layanan di ruas itu, jadwal, dan daftar halte/stasiun, sementara jalur lain diredupkan

**Lainnya**
- Filter fokus per moda (MRT, KRL, LRT, TJ)
- Pencarian stasiun dan halte
- Lokasi GPS dan stasiun terdekat

## Menjalankan

Butuh Node.js 20+ dan CLI `unzip` (untuk membaca GTFS Transjakarta).

Repo ini monorepo [Turborepo](https://turbo.build) dengan npm workspaces. Semua perintah dijalankan dari root.

```sh
npm install
npm run data:offline   # bangun apps/web/public/data/* dari cache
npm run dev            # http://localhost:5173
```

Build produksi:

```sh
npm test
npm run build
npm run preview
```

Hasil build ada di `apps/web/dist/` dan bisa di-host di layanan statis mana pun. Untuk Vercel, `vercel.json` di root sudah mengatur perintah build dan folder output.

## Data

Semua data dibangun saat build oleh `apps/web/scripts/build-data.mjs` dan disajikan sebagai JSON statis. Aplikasi tidak memanggil API apa pun saat berjalan, selain tile peta.

```sh
npm run data                             # ambil ulang semua sumber, fallback ke cache bila gagal
npm run data:offline                     # pakai cache saja
npm run data -- -- --only=osm-network    # ambil ulang satu cache saja
```

| File | Isi |
| --- | --- |
| `apps/web/public/data/mrt.json` | Stasiun MRT, jadwal, pintu keluar, geometri jalur |
| `apps/web/public/data/network.json` | Stasiun dan halte moda lain, jalur, interval Transjakarta dan KRL |
| `apps/web/public/data/krl.json` | Keberangkatan KRL per stasiun (hari kerja), dimuat saat panel stasiun KRL dibuka |
| `apps/web/public/data/schematic.json` | Tata letak peta skema hasil `scripts/schematic.mjs` |

Data lapangan yang tidak ada di sumber terbuka (tujuan pintu keluar, lift, catatan) diisi manual di `apps/web/scripts/manual.json`, lalu jalankan `npm run data:offline`.

Cache sumber ada di `apps/web/scripts/.cache-*.json` dan ikut di-commit supaya build tetap bisa jalan tanpa jaringan. Respons Overpass yang datanya lebih tua dari 30 hari ditolak.

## Struktur

```
turbo.json              pipeline task (build, test, dev, data)
vercel.json             konfigurasi deploy Vercel
apps/
  web/                  PWA Peron (Svelte + Vite)
    scripts/
      build-data.mjs      ambil OSM, jadwal MRT, GTFS Transjakarta → public/data
      schematic.mjs       generator tata letak peta skema
      manual.json         data lapangan yang diisi manual
    src/
      App.svelte          shell, pencarian, filter moda, GPS
      Schematic.svelte    peta skema (SVG) dan animasi kendaraan
      Map.svelte          peta jalan (MapLibre)
      StationPanel.svelte panel stasiun MRT
      StopPanel.svelte    panel stasiun KRL/LRT dan halte Transjakarta
      LinePanel.svelte    panel jalur
      lib/                state, waktu, geometri, metadata jalur, model landmark
    test/                 unit test (node --test)
```

## Batasan

- Jadwal KRL diambil dari GTFS [Open-KRL](https://github.com/open-krl/pipeline), yang disusun dari papan jadwal KAI Commuter. Data ini tidak resmi, hanya untuk hari kerja (akhir pekan bisa berbeda), dan berlaku sampai tanggal `validUntil` di `krl.json`. Ganti tag rilis di `KRL_GTFS` bila Open-KRL menerbitkan versi baru. `kci.id` sendiri memblokir akses dari script.
- KA antar kota hanya berupa daftar KA dan relasinya di panel stasiun (Gambir, Pasar Senen, Jatinegara, Bekasi, dll.), diambil dari relasi `route=train` OpenStreetMap. Daftarnya bisa belum lengkap. Jam keberangkatan tidak ditampilkan karena KAI tidak membuka data jadwal; panel menautkan ke Access by KAI.
- Posisi KRL dan LRT di peta skema masih simulasi. Untuk KRL, simulasinya memakai interval per jam dari jadwal di atas. LRT belum membuka data jadwal.
- Transjakarta hanya mempublikasikan interval per jam, bukan jam kedatangan per bus.
- Jadwal MRT diambil dari situs MRT Jakarta, tidak resmi dan bisa berubah.
- Peta skema dibuat otomatis, jadi tata letaknya belum serapi peta yang digambar tangan.

## Atribusi

- Data stasiun, jalur, dan pintu: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL)
- Tile peta: [OpenFreeMap](https://openfreemap.org) © OpenMapTiles
- Halte dan interval Transjakarta: GTFS Transjakarta
- Jadwal KRL: GTFS Open-KRL (data KAI Commuter, tidak resmi)
- Jadwal MRT: situs MRT Jakarta (tidak resmi)

Peron bukan aplikasi resmi dan tidak berafiliasi dengan MRT Jakarta, KAI Commuter, LRT Jakarta, LRT Jabodebek, atau Transjakarta.
