// Build public/data/mrt.json from OSM (Overpass) + MRT Jakarta web backend + scripts/manual.json.
// Usage: node scripts/build-data.mjs [--offline]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { haversine, parseTimes } from '../src/lib/geo.js'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const OFFLINE = process.argv.includes('--offline')
const UA = 'Peron/0.1 (MRT Jakarta station guide; build script)'
const BBOX = '-6.33,106.76,-6.17,106.84'

const STATIONS = [
  ['LBB', 'Lebak Bulus', true, 'stasiun-lebak-bulus'],
  ['FTM', 'Fatmawati', true, 'stasiun-fatmawati-indomaret'],
  ['CPR', 'Cipete Raya', true, 'stasiun-cipete-raya'],
  ['HJN', 'Haji Nawi', true, 'stasiun-haji-nawi'],
  ['BLA', 'Blok A', true, 'stasiun-blok-a'],
  ['BLM', 'Blok M', true, 'stasiun-blok-m-bca'],
  ['ASN', 'ASEAN', true, 'stasiun-asean'],
  ['SNY', 'Senayan', false, 'stasiun-senayan-mastercard'],
  ['IST', 'Istora', false, 'stasiun-istora-mandiri'],
  ['BNH', 'Bendungan Hilir', false, 'stasiun-bendungan-hilir'],
  ['STB', 'Setiabudi', false, 'stasiun-setiabudi-astra'],
  ['DKA', 'Dukuh Atas', false, 'stasiun-dukuh-atas-bni'],
  ['BHI', 'Bundaran HI', false, 'bundaran-hi-bank-jakarta'],
]

async function cached(name, fetcher) {
  const file = here(`./.cache-${name}.json`)
  if (!OFFLINE) {
    try {
      const data = await fetcher()
      await writeFile(file, JSON.stringify(data))
      return data
    } catch (e) {
      console.warn(`[${name}] fetch failed (${e.message}), using cache`)
    }
  }
  return JSON.parse(await readFile(file, 'utf8'))
}

async function fetchJson(url, init = {}, tries = 4) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...init.headers } }).catch((e) => ({ ok: false, status: e.message }))
    if (res.ok) return res.json()
    if (i >= tries - 1) throw new Error(`HTTP ${res.status} ${url}`)
    const wait = 2000 * 2 ** i
    console.warn(`  ${res.status}, retry in ${wait}ms`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

const overpass = (q) =>
  fetchJson('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(`[out:json][timeout:60];${q}`),
  })

const osm = await cached('osm', () =>
  overpass(`(
    node["railway"="station"](${BBOX});
    node["railway"="subway_entrance"](${BBOX});
    way["railway"="subway"](${BBOX});
  );out geom;`),
)
const web = await cached('mrtweb', () =>
  fetchJson('https://beweb-dev.jakartamrt.co.id/middleware/api/datum?pagination[limit]=100'),
)
const manual = JSON.parse(await readFile(here('./manual.json'), 'utf8'))

// --- OSM: stations ---
const isMrt = (t) => /MRT/i.test(`${t.operator ?? ''} ${t.network ?? ''}`)
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '')
const osmStations = osm.elements.filter((e) => e.type === 'node' && e.tags?.railway === 'station' && isMrt(e.tags))

const stations = STATIONS.map(([code, name, elevated, slug], index) => {
  const n = osmStations.find((e) => norm(e.tags.name ?? '').includes(norm(name)))
  if (!n) throw new Error(`OSM station not found: ${name}`)
  const w = web.data.find((d) => d.slug === slug)
  const sch = w?.object?.schedule ?? {}
  const m = manual.stations?.[code] ?? {}
  const integration = Object.fromEntries(
    Object.entries(w?.object?.integration ?? {}).map(([op, r]) => [op, [...new Set(String(r).split(';').map((x) => x.trim()).filter(Boolean))]]),
  )
  return {
    code, index, name,
    fullName: (w?.name ?? name).replace(/^\s*Stasiun MRT\s*/i, '').trim(),
    lat: n.lat, lon: n.lon, elevated,
    description: w?.description ?? null,
    timetable: {
      toLBB: { weekday: parseTimes(sch.weekdaysStart), weekend: parseTimes(sch.weekendsStart) },
      toBHI: { weekday: parseTimes(sch.weekdaysEnd), weekend: parseTimes(sch.weekendsEnd) },
    },
    integration,
    platform: m.platform ?? null,
    notes: m.notes ?? null,
    exits: [],
  }
})

// --- OSM: entrances → nearest MRT station ≤ 300 m (others are LRT etc.) ---
for (const e of osm.elements) {
  if (e.type !== 'node' || e.tags?.railway !== 'subway_entrance') continue
  let best = null, bestD = 300
  for (const s of stations) {
    const d = haversine(s, e)
    if (d <= bestD) (best = s), (bestD = d)
  }
  if (!best) continue
  const ref = (e.tags.ref ?? e.tags.name ?? '').trim().replace(/^(pintu|exit|entrance)\s*/i, '').toUpperCase()
  if (!ref || best.exits.some((x) => x.ref === ref)) continue
  const id = `${best.code}:${ref}`
  const m = manual.exits?.[id] ?? {}
  best.exits.push({
    id, ref, lat: e.lat, lon: e.lon,
    street: e.tags['addr:street'] ?? null,
    wheelchair: e.tags.wheelchair ?? null,
    leadsTo: m.leadsTo ?? [],
    lift: m.lift ?? null,
    escalator: m.escalator ?? null,
    notes: m.notes ?? null,
  })
}
for (const s of stations) s.exits.sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }))

// --- OSM: track geometry (drop yard/siding/crossover) ---
const features = osm.elements
  .filter((e) => e.type === 'way' && e.tags?.railway === 'subway' && !e.tags.service && e.geometry)
  .map((e) => ({ type: 'Feature', properties: { id: e.id }, geometry: { type: 'LineString', coordinates: e.geometry.map((p) => [p.lon, p.lat]) } }))

const out = {
  generatedAt: new Date().toISOString(),
  attribution: {
    osm: '© OpenStreetMap contributors (ODbL)',
    schedule: 'Jadwal: MRT Jakarta (tidak resmi, bisa berubah)',
  },
  line: { code: 'NS', name: 'Lin Utara–Selatan', color: '#e2231a', termini: { south: 'LBB', north: 'BHI' } },
  stations,
  geometry: { type: 'FeatureCollection', features },
}
await mkdir(here('../public/data'), { recursive: true })
await writeFile(here('../public/data/mrt.json'), JSON.stringify(out))
console.log(`mrt.json: ${stations.length} stations, ${stations.reduce((n, s) => n + s.exits.length, 0)} exits, ${features.length} track ways`)
for (const s of stations) if (!s.exits.length || !(s.timetable.toLBB.weekday.length + s.timetable.toBHI.weekday.length)) console.warn(`  ${s.code}: exits=${s.exits.length} ttLBB=${s.timetable.toLBB.weekday.length} ttBHI=${s.timetable.toBHI.weekday.length}`)
