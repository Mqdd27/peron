// Hand-laid schematic of the rail lines around MRT Lin Utara–Selatan (own drawing, FDTJ-inspired style).
// Coordinates are schematic units shared with Schematic.svelte. Context only: these stations aren't tappable yet.
// ponytail: hand-placed coordinates; generate from OSM + an octilinear layout once KRL/LRT become real data.

export const LINES = [
  { id: 'A', name: 'KA Bandara Soekarno-Hatta', color: '#1d2160', d: 'M212,-190 V130 Q212,160 242,160 H690',
    ends: [{ x: 222, y: -196, a: 'start', t: 'Bandara Soekarno-Hatta ↑' }] },
  { id: 'C', name: 'KRL Lingkar Cikarang', color: '#3fb6dc', d: 'M200,-190 V142 Q200,172 230,172 H1150 M940,172 V-190',
    ends: [
      { x: 190, y: -196, a: 'end', t: '↑ Angke · Kampung Bandan' },
      { x: 940, y: -196, a: 'middle', t: '↑ Kemayoran · Kampung Bandan' },
      { x: 1150, y: 196, a: 'end', t: 'Klender · Bekasi · Cikarang →' },
    ] },
  { id: 'R', name: 'KRL Rangkasbitung', color: '#8cc63f', d: 'M188,110 V190 Q188,210 174,224 L74,324 Q60,338 60,358 V640',
    ends: [{ x: 60, y: 662, a: 'middle', t: '↓ Serpong · Rangkasbitung' }] },
  { id: 'B', name: 'KRL Bogor', color: '#ef4136', d: 'M690,-190 V880',
    ends: [{ x: 690, y: -196, a: 'middle', t: '↑ Jayakarta · Jakarta Kota' }, { x: 690, y: 902, a: 'middle', t: '↓ Depok · Bogor' }] },
  { id: 'T', name: 'KRL Tangerang', color: '#8a5a2b', d: 'M200,-140 H-150',
    ends: [{ x: -158, y: -136, a: 'end', t: 'Tangerang ←' }] },
  { id: 'S', name: 'LRT Jakarta', color: '#f26522', d: 'M690,166 L746,110 H1050 Q1080,110 1080,80 V-200', ends: [] },
  { id: 'BK', name: 'LRT Jabodebek Bekasi', color: '#1d6b3a', d: 'M500,224 H530 Q566,224 566,260 V460 Q566,484 590,484 H980',
    ends: [{ x: 990, y: 489, a: 'start', t: 'Jatimulya →' }] },
  { id: 'CB', name: 'LRT Jabodebek Cibubur', color: '#2b3a9e', d: 'M500,236 H530 Q554,236 554,260 V460 Q554,496 590,496 H846 Q876,496 876,526 V820', ends: [] },
]

// Stations: [name, x, y, labelSide, opts]. labelSide: l/r/t/b. opts.pill = [x1,y1,x2,y2] for interchange/double-track marks,
// opts.line = tick colour line id for single-line stations.
const r = 'r', l = 'l', t = 't', b = 'b'
export const STATIONS = [
  ['Duri', 206, -140, 'duri', { pill: [200, -140, 212, -140] }],
  ['Grogol', 80, -140, b, { line: 'T', tick: [0, 1] }],
  ['Pesing', -40, -140, b, { line: 'T', tick: [0, 1] }],
  ['Juanda', 690, -60, r, { line: 'B' }],
  ['Sawah Besar', 690, -120, r, { line: 'B' }],
  ['Kramat', 940, -40, l, { line: 'C' }],
  ['Gang Sentiong', 940, -100, l, { line: 'C' }],
  ['Pasar Senen', 940, -160, l, { pill: [940, -160, 940, -160] }],
  ['Tanah Abang', 194, 110, l, { pill: [188, 110, 200, 110] }],
  ['Palmerah', 124, 274, l, { line: 'R', tick: [-0.7, -0.7] }],
  ['Kebayoran', 60, 470, l, { line: 'R' }],
  ['BNI City', 370, 166, b, { pill: [370, 160, 370, 172] }],
  ['Sudirman', 480, 172, t, { pill: [480, 172, 480, 172] }],
  ['Dukuh Atas BSI', 500, 230, b, { pill: [500, 224, 500, 236] }],
  ['Manggarai', 690, 178, 'mg', { pill: [690, 160, 690, 196], big: true }],
  ['Gondangdia', 690, 10, r, { line: 'B' }],
  ['Cikini', 690, 80, r, { line: 'B' }],
  ['Tebet', 690, 300, r, { line: 'B' }],
  ['Cawang', 690, 420, r, { pill: [690, 420, 690, 420] }],
  ['Duren Kalibata', 690, 560, r, { line: 'B' }],
  ['Pasar Minggu Baru', 690, 630, r, { line: 'B' }],
  ['Pasar Minggu', 690, 700, r, { line: 'B' }],
  ['Tanjung Barat', 690, 770, r, { line: 'B' }],
  ['Lenteng Agung', 690, 840, r, { line: 'B' }],
  ['Proklamasi', 780, 110, t, { line: 'S', tick: [0, -1] }],
  ['Matraman', 840, 110, t, { pill: [840, 110, 840, 110] }],
  ['Matraman', 840, 172, b, { pill: [840, 172, 840, 172] }],
  ['Pramuka', 895, 110, t, { line: 'S', tick: [0, -1] }],
  ['Rawamangun', 985, 110, t, { line: 'S', tick: [0, -1] }],
  ['Velodrome', 1045, 110, b, { line: 'S', tick: [0, 1] }],
  ['Equestrian', 1080, 40, r, { line: 'S', tick: [1, 0] }],
  ['Pulomas', 1080, -20, r, { line: 'S', tick: [1, 0] }],
  ['Boulevard Selatan', 1080, -80, r, { line: 'S', tick: [1, 0] }],
  ['Boulevard Utara', 1080, -140, r, { line: 'S', tick: [1, 0] }],
  ['Kelapa Gading', 1080, -200, r, { pill: [1080, -200, 1080, -200], term: 'S' }],
  ['Jatinegara', 940, 172, b, { pill: [940, 172, 940, 172] }],
  ['Pondok Jati', 940, 40, l, { line: 'C' }],
  ['Setiabudi', 560, 300, r, { pill: [540, 300, 566, 300] }],
  ['Rasuna Said', 560, 360, r, { pill: [540, 360, 566, 360] }],
  ['Kuningan', 560, 420, r, { pill: [540, 420, 566, 420] }],
  ['Pancoran', 630, 490, t, { pill: [630, 484, 630, 496] }],
  ['Cikoko', 740, 490, b, { pill: [740, 484, 740, 496] }],
  ['Ciliwung', 800, 490, t, { pill: [800, 484, 800, 496] }],
  ['Cawang', 876, 490, t, { pill: [876, 484, 876, 496] }],
  ['Halim', 950, 484, t, { line: 'BK', tick: [0, -1] }],
  ['TMII', 876, 580, r, { line: 'CB' }],
  ['Kampung Rambutan', 876, 660, r, { line: 'CB' }],
  ['Ciracas', 876, 740, r, { line: 'CB' }],
  ['Harjamukti', 876, 820, r, { pill: [876, 820, 876, 820], term: 'CB' }],
].map(([name, x, y, side, o]) => ({ name, x, y, side, ...o }))

// Walking/paid transfers between stations (grey bands, drawn under the lines).
export const LINKS = [
  [420, 110, 370, 166], // MRT Dukuh Atas – BNI City
  [420, 110, 480, 172], // MRT Dukuh Atas – Sudirman
  [480, 172, 500, 230], // Sudirman – LRT Dukuh Atas
  [840, 110, 840, 172], // Matraman LRT – KRL
  [690, 420, 740, 490], // Cawang KRL – Cikoko LRT
  [740, 490, 740, 530], // Cikoko LRT – halte Cikoko (K9)
  [220, 470, 236, 490], // MRT ASEAN – halte CSW
  [60, 470, -60, 470], // KRL Kebayoran – halte Kebayoran (K8)
  [60, 470, 100, 490], // KRL Kebayoran – halte Kebayoran Lama (K13)
  [420, 110, 440, 202], // MRT Dukuh Atas – halte Dukuh Atas/Galunggung
]

export const DISTRICTS = [
  ['Jakarta Pusat', 560, -30],
  ['Jakarta Selatan', 430, 620],
  ['Jakarta Timur', 1050, 770],
]

// Transjakarta BRT corridors that meet the rail lines above. Drawn thinner, halte as open circles (FDTJ convention).
// Halte names/order from the FDTJ 2026-08c edition; only the stretch near the rail core is drawn.
export const BRT = [
  { id: '1', name: 'Blok M – Kota', color: '#d6202a',
    d: 'M436,-190 V180 Q436,206 418,224 L246,396 Q236,406 236,426 V560',
    halte: [['Monumen Nasional', 436, -130], ['Kebon Sirih', 436, -80], ['MH Thamrin', 436, -25], ['Bundaran HI ASTRA', 436, 30], ['Tosari', 436, 70], ['Karet', 408, 234], ['Polda Metro Jaya', 326, 316],
      ['Senayan Bank Jakarta', 291, 351], ['Masjid Agung', 236, 440], ['Blok M', 236, 560, 'term']],
    ends: [{ x: 436, y: -196, a: 'middle', t: '↑ Harmoni · Kota' }] },
  { id: '13', name: 'CBD Ciledug – Tegal Mampang', color: '#7b4ea3',
    d: 'M-150,490 H480',
    halte: [['Kebayoran Lama', 100, 490], ['Velbak', 152, 490], ['Mayestik', 190, 490], ['Pasar Santa', 320, 490],
      ['Rawa Barat', 400, 490], ['Tegal Mampang', 480, 490, 'term']],
    ends: [{ x: -158, y: 494, a: 'end', t: 'Ciledug ←' }] },
  { id: '9', name: 'Pinang Ranti – Pluit', color: '#2f8f83',
    d: 'M960,530 H670 L391,251',
    halte: [['', 740, 530], ['Widya Chandra', 480, 340]],
    ends: [{ x: 968, y: 534, a: 'start', t: 'Cawang · Pinang Ranti →' }, { x: 405, y: 272, a: 'start', t: '↖ Slipi · Grogol · Pluit' }] },
  { id: '6', name: 'Ragunan – Dukuh Atas', color: '#3da447',
    d: 'M446,208 H510 Q540,208 540,238 V640',
    halte: [],
    ends: [{ x: 540, y: 660, a: 'middle', t: '↓ Mampang · Ragunan' }] },
  { id: '4', name: 'Pulogadung – Dukuh Atas', color: '#4c2a85',
    d: 'M446,196 H690',
    halte: [['Halimun', 590, 196], ['Pasar Rumput', 640, 196]],
    ends: [{ x: 706, y: 236, a: 'start', t: '→ Pramuka · Pulogadung' }] },
  { id: '8', name: 'Lebak Bulus – Harmoni', color: '#d8368a',
    d: 'M20,880 H-40 Q-60,880 -60,860 V-40',
    halte: [['Pondok Indah', -60, 760], ['Tanah Kusir', -60, 660], ['Kebayoran', -60, 470], ['Simprug', -60, 390], ['Permata Hijau', -60, 300], ['Arteri', -60, 210], ['Pos Pengumben', -60, 120]],
    ends: [{ x: -60, y: -56, a: 'middle', t: '↑ Kebon Jeruk · Harmoni' }] },
]

// Interchange halte drawn as rings where corridors cross (not tied to one corridor).
export const BRT_HUBS = [
  ['', 440, 202, 't'], // K1 · K4 · K6 (Galunggung)
  ['CSW', 236, 490, 'b'], // K1 · K13
  ['Semanggi', 391, 251, 'r'], // K1 · K9
]

// 3D landmarks (sprites rendered by lib/landmarks3d.js). x/y = centre, s = sprite size in schematic units.
export const LANDMARKS = [
  { name: 'Monas', model: 'monas', x: 330, y: -122, s: 120 },
  { name: 'Grand Indonesia', model: 'mall', x: 252, y: -32, s: 60 },
  { name: 'Gelora Bung Karno', model: 'stadium', x: 150, y: 382, s: 96 },
  { name: 'Blok M Plaza', model: 'mall', x: 318, y: 588, s: 72 },
  { name: 'Tebet Eco Park', model: 'park', x: 756, y: 345, s: 90 },
  { name: 'TMII', model: 'pavilion', x: 1005, y: 600, s: 96 },
  { name: 'Masjid Istiqlal', model: 'mosque', x: 585, y: -125, s: 100 },
  { name: 'Pasar Tanah Abang', model: 'mall', x: 110, y: 38, s: 68 },
  { name: 'Senayan City', model: 'mall', x: 382, y: 428, s: 62 },
  { name: 'Pondok Indah Mall', model: 'mall', x: -145, y: 818, s: 70 },
  { name: 'Bandara Halim', model: 'airport', x: 1050, y: 395, s: 110 },
  { name: 'Kota Tua ↑', model: 'oldtown', x: 812, y: -165, s: 84 },
  { name: 'Ragunan', model: 'zoo', x: 612, y: 590, s: 90 },
]

// Background texture: rivers (soft blue, under everything) and neighbourhood names.
// ponytail: hand-drawn approximations of the river courses, not traced from OSM.
export const RIVERS = [
  { name: 'Kali Ciliwung', d: 'M745,-200 C770,-130 725,-60 750,10 S730,140 760,230 S805,330 790,420 S790,540 825,620 S840,780 825,930',
    label: [846, 720] },
  { name: 'Kali Pesanggrahan', d: 'M-120,-200 C-100,-100 -140,0 -115,100 S-95,300 -125,420 S-110,600 -130,700 S-115,850 -140,930',
    label: [-168, 600] },
]
export const AREAS = [
  ['Menteng', 565, 55], ['Kemang', 440, 572], ['Kebayoran Baru', 135, 606], ['Cilandak', 95, 700],
  ['Kampung Melayu', 850, 252], ['Cempaka Putih', 1010, -110],
]
