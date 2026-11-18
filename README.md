# Peron

PWA panduan stasiun MRT Jakarta (Lin Utara–Selatan): pintu keluar, peron, kereta berikutnya.

```sh
npm install
npm run data          # fetch OSM + jadwal MRT → public/data/mrt.json (pakai cache bila gagal)
npm run data:offline  # pakai scripts/.cache-*.json saja
npm test && npm run build && npm run preview
```

- Data lapangan (tujuan pintu, lift, catatan) diisi di `scripts/manual.json`, lalu `npm run data:offline`.
- Atribusi: peta © OpenFreeMap, data © OpenStreetMap contributors (ODbL), jadwal dari web MRT Jakarta (tidak resmi).
