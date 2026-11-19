// Fixed metadata for the generated schematic (scripts/schematic.mjs → public/data/schematic.json).
// Positions are not hand-drawn any more: everything else comes from OSM/GTFS geography.

// Which mode chip (MRT/KRL/LRT/TJ) each rail line belongs to. Order = side-by-side order on shared track.
export const LINE_MODE = { A: 'krl', B: 'krl', C: 'krl', R: 'krl', T: 'krl', TP: 'krl', S: 'lrt', BK: 'lrt', CB: 'lrt' }
export const LINES = [
  { id: 'A', name: 'KA Bandara Soekarno-Hatta', color: '#1d2160' },
  { id: 'B', name: 'KRL Bogor', color: '#ef4136' },
  { id: 'C', name: 'KRL Lingkar Cikarang', color: '#3fb6dc' },
  { id: 'R', name: 'KRL Rangkasbitung', color: '#8cc63f' },
  { id: 'T', name: 'KRL Tangerang', color: '#8a5a2b' },
  { id: 'TP', name: 'KRL Tanjung Priok', color: '#e45d9c' },
  { id: 'S', name: 'LRT Jakarta', color: '#f26522' },
  { id: 'BK', name: 'LRT Jabodebek Bekasi', color: '#1d6b3a' },
  { id: 'CB', name: 'LRT Jabodebek Cibubur', color: '#2b3a9e' },
]

// 3D landmarks (sprites rendered by lib/landmarks3d.js), placed by real coordinates through project().
// near = real-world nearest stop: MRT code or a stop name; s = sprite size in schematic units.
export const LANDMARKS = [
  { name: 'Monas', near: 'Juanda', model: 'monas', lat: -6.1754, lon: 106.8272, s: 90 },
  { name: 'Grand Indonesia', near: 'BHI', model: 'mall', lat: -6.1951, lon: 106.8209, s: 50 },
  { name: 'Gelora Bung Karno', near: 'IST', model: 'stadium', lat: -6.2186, lon: 106.8016, s: 80 },
  { name: 'Blok M Plaza', near: 'BLM', model: 'mall', lat: -6.2443, lon: 106.7982, s: 50 },
  { name: 'Tebet Eco Park', near: 'Tebet', model: 'park', lat: -6.2366, lon: 106.8536, s: 70 },
  { name: 'TMII', near: 'TMII', model: 'pavilion', lat: -6.3025, lon: 106.8952, s: 80 },
  { name: 'Masjid Istiqlal', near: 'Juanda', model: 'mosque', lat: -6.1702, lon: 106.831, s: 70 },
  { name: 'Pasar Tanah Abang', near: 'Tanah Abang', model: 'mall', lat: -6.1878, lon: 106.8128, s: 50 },
  { name: 'Senayan City', near: 'SNY', model: 'mall', lat: -6.2274, lon: 106.7973, s: 46 },
  { name: 'Pondok Indah Mall', near: 'LBB', model: 'mall', lat: -6.2656, lon: 106.7838, s: 50 },
  { name: 'Bandara Halim', near: 'Halim', model: 'airport', lat: -6.2655, lon: 106.8907, s: 80 },
  { name: 'Kota Tua', near: 'Jakarta Kota', model: 'oldtown', lat: -6.1352, lon: 106.8133, s: 70 },
  { name: 'Ragunan', near: 'Ragunan', model: 'zoo', lat: -6.3125, lon: 106.8202, s: 70 },
  { name: 'Taman Impian Jaya Ancol', near: 'Ancol', model: 'park', lat: -6.1225, lon: 106.8415, s: 70 },
  { name: 'JIExpo Kemayoran', near: 'JIEXPO Kemayoran', model: 'pavilion', lat: -6.145, lon: 106.846, s: 60 },
  { name: 'Jakarta International Stadium', near: 'Jakarta International Stadium', model: 'stadium', lat: -6.1245, lon: 106.87, s: 70 },
  { name: 'Katedral / Lapangan Banteng', near: 'Lapangan Banteng', model: 'church', lat: -6.1713, lon: 106.8364, s: 50 },
  { name: 'Masjid Luar Batang', near: 'Kampung Bandan', model: 'mosque', lat: -6.126, lon: 106.8075, s: 50 },
  { name: 'Universitas Indonesia', near: 'Universitas Indonesia', model: 'campus', lat: -6.3627, lon: 106.827, s: 70 },
  // everyday orientation points (malls, terminals) that fill the outer areas
  { name: 'Central Park', near: 'Tanjung Duren', model: 'mall', lat: -6.1777, lon: 106.7907, s: 46 },
  { name: 'Puri Indah Mall', near: 'Rawa Buaya', model: 'mall', lat: -6.1872, lon: 106.734, s: 46 },
  { name: 'Pluit Village', near: 'Penjaringan', model: 'mall', lat: -6.1275, lon: 106.7907, s: 44 },
  { name: 'Mall Kelapa Gading', near: 'Boulevard Utara Summarecon Mall', model: 'mall', lat: -6.1574, lon: 106.9087, s: 46 },
  { name: 'Mall of Indonesia', near: 'Sunter Boulevard Barat', model: 'mall', lat: -6.1495, lon: 106.8915, s: 44 },
  { name: 'Kota Kasablanka', near: 'Kuningan', model: 'mall', lat: -6.2244, lon: 106.8428, s: 44 },
  { name: 'AEON Mall JGC', near: 'Walikota Jakarta Timur', model: 'mall', lat: -6.1896, lon: 106.9446, s: 46 },
  { name: 'Summarecon Mall Bekasi', near: 'Bekasi', model: 'mall', lat: -6.2262, lon: 107.0003, s: 46 },
  { name: 'Margo City', near: 'Pondok Cina', model: 'mall', lat: -6.3727, lon: 106.8343, s: 44 },
  { name: 'ICE BSD', near: 'Serpong', model: 'pavilion', lat: -6.3009, lon: 106.6532, s: 56 },
  { name: 'Kebun Raya Bogor', near: 'Bogor', model: 'park', lat: -6.5976, lon: 106.7997, s: 64 },
  { name: 'Terminal Kampung Rambutan', near: 'Kampung Rambutan', model: 'terminal', lat: -6.3093, lon: 106.8822, s: 50 },
  { name: 'Terminal Pulo Gebang', near: 'Pulo Gebang', model: 'terminal', lat: -6.2117, lon: 106.9537, s: 50 },
  { name: 'Bandara Soekarno-Hatta', near: 'Bandara Soekarno Hatta', model: 'airport', lat: -6.1256, lon: 106.6559, s: 90 },
]

export const DISTRICTS = [
  ['Jakarta Pusat', -6.182, 106.84], ['Jakarta Utara', -6.125, 106.87], ['Jakarta Barat', -6.17, 106.74],
  ['Jakarta Selatan', -6.275, 106.8], ['Jakarta Timur', -6.24, 106.92], ['Tangerang', -6.18, 106.62],
  ['Tangerang Selatan', -6.3, 106.7], ['Depok', -6.4, 106.82], ['Bogor', -6.6, 106.8], ['Bekasi', -6.24, 107.0],
]
