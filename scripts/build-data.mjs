// Build public/data/mrt.json from OSM (Overpass) + MRT Jakarta web backend + scripts/manual.json.
// Usage: node scripts/build-data.mjs [--offline]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { haversine, parseTimes } from '../src/lib/geo.js'
import { LINES } from '../src/lib/network.js'

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

// Main instance first, then a public mirror (the main one 502s under load).
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
async function overpass(q, timeout = 60) {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(`[out:json][timeout:${timeout}];${q}`),
  }
  for (const [i, url] of MIRRORS.entries()) {
    try {
      return await fetchJson(url, init, 2)
    } catch (e) {
      if (i === MIRRORS.length - 1) throw e
      console.warn(`  ${e.message}, trying mirror`)
    }
  }
}

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

// --- Other modes (issue #3): KRL, airport rail, LRT and Transjakarta BRT corridors → public/data/network.json ---
const NET_BBOX = '-6.37,106.68,-6.12,106.95'
const net = await cached('osm-network', () =>
  overpass(`(
    relation["route"="train"]["network"~"KAI Commuter|Railink|Bandara",i](${NET_BBOX});
    relation["route"="light_rail"](${NET_BBOX});
    relation["route"="bus"]["network"~"Transjakarta",i]["ref"~"^([1-9]|1[0-4])$"](${NET_BBOX});
  );out geom(${NET_BBOX});
  (
    node["railway"="station"]["station"!="subway"](${NET_BBOX});
    nwr["public_transport"="station"]["network"~"Transjakarta",i](${NET_BBOX});
  );out center;`, 120),
)
const lineColor = Object.fromEntries(LINES.map((l) => [l.id, l.color]))
const modeOf = (t) =>
  t.route === 'light_rail' ? 'lrt' : t.route === 'bus' ? 'tj' : 'krl'
const ref = (t) => (t.route === 'train' && /bandara|airport|railink/i.test(`${t.name} ${t.network}`) ? 'A' : (t.ref ?? ''))
// ponytail: thin points closer than ~20 m and round to 5 dp; real simplification (Douglas-Peucker) if size matters.
function thin(geom) {
  const out = []
  for (const p of geom) {
    const q = [+p.lon.toFixed(5), +p.lat.toFixed(5)]
    const last = out.at(-1)
    if (!last || Math.abs(q[0] - last[0]) + Math.abs(q[1] - last[1]) > 0.0002) out.push(q)
  }
  const end = geom.at(-1)
  if (out.length < 2 && end) out.push([+end.lon.toFixed(5), +end.lat.toFixed(5)])
  return out
}
const seen = new Set()
const routeFeatures = []
const routeNames = {}
for (const rel of net.elements.filter((e) => e.type === 'relation')) {
  const t = rel.tags, mode = modeOf(t), id = ref(t)
  const color = lineColor[id] ?? (/^#/.test(t.colour ?? '') ? t.colour : mode === 'tj' ? '#2b6cb0' : '#e45d9c')
  routeNames[`${mode}:${id}`] ??= { mode, ref: id, color, name: (t.name ?? '').replace(/:.*/, '').trim() }
  for (const m of rel.members) {
    if (m.type !== 'way' || m.role || !m.geometry) continue // skip stops/platforms
    const key = `${mode}:${id}:${m.ref}`
    if (seen.has(key)) continue
    seen.add(key)
    const coords = thin(m.geometry.filter(Boolean))
    if (coords.length > 1) routeFeatures.push({ type: 'Feature', properties: { mode, ref: id, color }, geometry: { type: 'LineString', coordinates: coords } })
  }
}
const stopFeatures = net.elements
  .filter((e) => e.type !== 'relation' && e.tags?.name)
  .map((e) => {
    const t = e.tags
    const mode = /transjakarta/i.test(t.network ?? '') ? 'tj' : t.station === 'light_rail' || t.light_rail === 'yes' ? 'lrt' : 'krl'
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon
    return { type: 'Feature', properties: { mode, name: t.name.replace(/^(Stasiun|Halte)\s+/i, '') }, geometry: { type: 'Point', coordinates: [+lon.toFixed(5), +lat.toFixed(5)] } }
  })
  .filter((f) => !(f.properties.mode === 'krl' && /^(MRT|Stasiun MRT)/i.test(f.properties.name)))
// Transjakarta BRT headways from the official static GTFS (frequencies.txt).
// Result: { route: { wd: [24], we: [24] } } = minutes between buses per direction for each WIB hour, null = no service.
// ponytail: sums every trip pattern of a corridor (short-turns included), so it is the busiest-section headway; needs the `unzip` CLI.
const TJ_GTFS = 'https://gtfs.transjakarta.co.id/files/file_gtfs.zip'
const tj = await cached('tj-gtfs', async () => {
  const r = await fetch(TJ_GTFS, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const zip = `${tmpdir()}/peron-tj-gtfs.zip`
  await writeFile(zip, Buffer.from(await r.arrayBuffer()))
  // only leading id/number columns are read, so a naive comma split is safe here
  const rows = (name) => execFileSync('unzip', ['-p', zip, name], { maxBuffer: 1e8 }).toString().trim().split(/\r?\n/).slice(1).map((l) => l.split(','))
  const cal = Object.fromEntries(rows('calendar.txt').map((c) => [c[0], { wd: c[3] === '1', we: c[6] === '1' }]))
  const trip = Object.fromEntries(rows('trips.txt').map((t) => [t[0], { route: t[1], service: t[2] }]))
  const sec = (t) => t.split(':').reduce((a, b) => a * 60 + +b, 0)
  const bph = {} // route → day → [24] buses per hour, both directions
  for (const [id, start, end, headway] of rows('frequencies.txt')) {
    const t = trip[id]
    if (!t || !/^\d+$/.test(t.route) || +t.route > 14 || !cal[t.service] || !+headway) continue
    for (const day of ['wd', 'we']) {
      if (!cal[t.service][day]) continue
      const b = ((bph[t.route] ??= {})[day] ??= Array(24).fill(0))
      for (let h = 0; h < 24; h++) if (sec(start) < (h + 1) * 3600 && sec(end) > h * 3600) b[h] += 3600 / +headway
    }
  }
  const headway = {}
  for (const [route, days] of Object.entries(bph))
    headway[route] = Object.fromEntries(Object.entries(days).map(([d, b]) => [d, b.map((n) => (n ? +(120 / n).toFixed(1) : null))]))

  // BRT halte: every stop a corridor 1–14 trip calls at, folded onto its parent station.
  const stop = Object.fromEntries(rows('stops.txt').map((c) => [c[0], { name: c[2], lat: +c[4], lon: +c[5], parent: c[9] }]))
  const halte = {}
  for (const [tripId, , stopId] of rows('stop_times.txt')) {
    const route = trip[tripId]?.route
    if (!route || !/^\d+$/.test(route) || +route > 14 || !stop[stopId]) continue
    const id = stop[stopId].parent || stopId, st = stop[id] ?? stop[stopId]
    ;(halte[id] ??= { name: st.name.replace(/^Halte\s+/i, ''), lat: +st.lat.toFixed(5), lon: +st.lon.toFixed(5), routes: new Set() }).routes.add(route)
  }
  const stops = Object.values(halte).map((h) => ({ ...h, routes: [...h.routes].sort((a, b) => a - b) }))
  const names = Object.fromEntries(rows('routes.txt').filter((c) => /^\d+$/.test(c[0]) && +c[0] <= 14).map((c) => [c[0], c[3].replace(/ - /g, ' – ')]))
  return { headway, stops, names }
})
const tjHeadway = tj.headway

// One halte per place: merge directional/numbered platforms ("Harmoni Arah Utara", "Gambir 2") within 500 m,
// unioning their corridors and averaging the position.
const tjStops = []
for (const h of tj.stops) {
  const name = h.name.replace(/\s+(Arah\s+\S+|\d+)$/i, '').trim()
  const m = tjStops.find((x) => x.name === name && haversine(x, h) < 500)
  if (!m) { tjStops.push({ ...h, name, n: 1 }); continue }
  m.lat = +((m.lat * m.n + h.lat) / (m.n + 1)).toFixed(5)
  m.lon = +((m.lon * m.n + h.lon) / (m.n + 1)).toFixed(5)
  m.n++
  m.routes = [...new Set([...m.routes, ...h.routes])].sort((x, y) => x - y)
}

// GTFS halte replace the sparse OSM Transjakarta stops.
stopFeatures.splice(0, Infinity, ...stopFeatures.filter((f) => f.properties.mode !== 'tj'),
  ...tjStops.map(({ name, lat, lon, routes }) => ({ type: 'Feature', properties: { mode: 'tj', name, routes: routes.join(',') }, geometry: { type: 'Point', coordinates: [lon, lat] } })))

// Lines serving each KRL/LRT stop = same-mode route ways passing within ~150 m.
for (const f of stopFeatures) {
  const { mode } = f.properties
  if (mode === 'tj') continue
  const [lon, lat] = f.geometry.coordinates, refs = new Set()
  for (const r of routeFeatures)
    if (r.properties.mode === mode && r.properties.ref && r.geometry.coordinates.some(([x, y]) => Math.abs(x - lon) < 0.002 && Math.abs(y - lat) < 0.002 && haversine({ lat, lon }, { lat: y, lon: x }) < 150))
      refs.add(r.properties.ref)
  f.properties.lines = [...refs].sort().join(',')
}

// Station entrances from OSM, attached to the nearest KRL/LRT stop (skipped when an MRT station is nearer).
const ent = await cached('osm-entrances', () =>
  overpass(`node["railway"~"^(train_station_entrance|subway_entrance)$"](${NET_BBOX});out;`, 60),
)
const railStops = stopFeatures.filter((f) => f.properties.mode !== 'tj')
for (const e of ent.elements) {
  const p = { lat: e.lat, lon: e.lon }
  const d = (f) => haversine(p, { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] })
  const best = railStops.reduce((a, b) => (!a || d(b) < d(a) ? b : a), null)
  if (!best || d(best) > 250 || stations.some((s) => haversine(p, s) < d(best))) continue
  ;(best.properties.exits ??= []).push({ ref: e.tags?.ref ?? '', name: e.tags?.name ?? '', lat: +e.lat.toFixed(6), lon: +e.lon.toFixed(6), wheelchair: e.tags?.wheelchair })
}

const network = {
  generatedAt: new Date().toISOString(),
  attribution: '© OpenStreetMap contributors (ODbL); jadwal TJ: GTFS Transjakarta',
  tjHeadway,
  tjNames: tj.names,
  routes: Object.values(routeNames),
  lines: { type: 'FeatureCollection', features: routeFeatures },
  stops: { type: 'FeatureCollection', features: stopFeatures },
}
await writeFile(here('../public/data/network.json'), JSON.stringify(network))
const count = (m) => routeFeatures.filter((f) => f.properties.mode === m).length + '/' + stopFeatures.filter((f) => f.properties.mode === m).length
console.log(`TJ headway @08 WIB (wd): ${Object.entries(tjHeadway).map(([k, v]) => `${k}:${v.wd?.[8]}`).join(' ')}`)
console.log(`network.json: ways/stops krl ${count('krl')}, lrt ${count('lrt')}, tj ${count('tj')}; ${(JSON.stringify(network).length / 1e3).toFixed(0)} kB`)
