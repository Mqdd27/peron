// Build public/data/mrt.json from OSM (Overpass) + MRT Jakarta web backend + scripts/manual.json.
// Usage: node scripts/build-data.mjs [--offline]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { haversine, parseTimes } from '../src/lib/geo.js'
import { LINES, LINE_MODE } from '../src/lib/network.js'
import { buildSchematic, dedupe } from './schematic.mjs'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const OFFLINE = process.argv.includes('--offline')
// --only=tj-gtfs,osm  → refetch just these caches, read the rest from disk
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
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
  if (!OFFLINE && (!ONLY || ONLY.includes(name))) {
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
      const d = await fetchJson(url, init, 2)
      // some mirrors lag months behind (a stale one once renamed LRT Jakarta's ref); skip those
      const age = Date.now() - Date.parse(d.osm3s?.timestamp_osm_base ?? 0)
      if (age > 30 * 864e5) throw new Error(`stale mirror (${d.osm3s?.timestamp_osm_base})`)
      return d
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
// Greater Jakarta: Rangkasbitung (W) · Cikarang (E) · Bogor/Nambo (S) · Soekarno-Hatta & Tanjung Priok (N)
const NET_BBOX = '-6.62,106.22,-6.05,107.18'
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
  const seqCol = execFileSync('unzip', ['-p', zip, 'stop_times.txt'], { maxBuffer: 1e8 }).toString().split(/\r?\n/, 1)[0].split(',').indexOf('stop_sequence')
  const calls = {} // trip → [[sequence, halte id]]
  for (const c of rows('stop_times.txt')) {
    const [tripId, , stopId] = c, route = trip[tripId]?.route
    if (!route || !/^\d+$/.test(route) || +route > 14 || !stop[stopId]) continue
    const id = stop[stopId].parent || stopId, st = stop[id] ?? stop[stopId]
    ;(halte[id] ??= { name: st.name.replace(/^Halte\s+/i, ''), lat: +st.lat.toFixed(5), lon: +st.lon.toFixed(5), routes: new Set() }).routes.add(route)
    ;(calls[tripId] ??= []).push([+c[seqCol], id])
  }
  const ids = Object.keys(halte)
  const stops = Object.values(halte).map((h) => ({ ...h, routes: [...h.routes].sort((a, b) => a - b) }))
  // Ordered halte (indexes into stops) of every distinct trip pattern per corridor, for the schematic.
  const seqs = {}
  for (const [tripId, cs] of Object.entries(calls)) {
    const seq = cs.sort((a, b) => a[0] - b[0]).map(([, id]) => ids.indexOf(id)).filter((v, i, a) => v !== a[i - 1])
    const list = (seqs[trip[tripId].route] ??= [])
    if (!list.some((q) => q.join() === seq.join())) list.push(seq)
  }
  const names = Object.fromEntries(rows('routes.txt').filter((c) => /^\d+$/.test(c[0]) && +c[0] <= 14).map((c) => [c[0], c[3].replace(/ - /g, ' – ')]))
  const colCol = execFileSync('unzip', ['-p', zip, 'routes.txt'], { maxBuffer: 1e8 }).toString().split(/\r?\n/, 1)[0].split(',').indexOf('route_color')
  const colors = Object.fromEntries(rows('routes.txt').filter((c) => /^\d+$/.test(c[0]) && +c[0] <= 14 && /^[0-9a-f]{6}$/i.test(c[colCol] ?? '')).map((c) => [c[0], `#${c[colCol]}`]))
  return { headway, stops, names, seqs, colors }
})
const tjHeadway = tj.headway

// One halte per place: merge directional/numbered platforms ("Harmoni Arah Utara", "Gambir 2") within 500 m,
// unioning their corridors and averaging the position.
const tjStops = []
const tjMerged = [] // tj.stops index → merged halte
for (const h of tj.stops) {
  const name = h.name.replace(/\s+(Arah\s+\S+|\d+)$/i, '').trim()
  const m = tjStops.find((x) => x.name === name && haversine(x, h) < 500)
  if (!m) { tjStops.push({ ...h, name, n: 1 }); tjMerged.push(tjStops.at(-1)); continue }
  tjMerged.push(m)
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
  stops: { type: 'FeatureCollection', features: stopFeatures },
}
await writeFile(here('../public/data/network.json'), JSON.stringify(network))
// line shapes are only drawn on Peta, so they live in their own file the map fetches lazily (~1 MB)
await writeFile(here('../public/data/network-lines.json'), JSON.stringify({ type: 'FeatureCollection', features: routeFeatures }))

// --- Generated schematic of the whole network → public/data/schematic.json ---
const schNodes = new Map()
const node = (mode, name, lat, lon, code) => {
  const id = `${mode}:${code ?? name}`
  if (!schNodes.has(id)) schNodes.set(id, { id, name, mode, lat, lon, code })
  return id
}
const fpt = (f) => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] })
const railSeqs = {}
for (const rel of net.elements.filter((e) => e.type === 'relation' && e.tags.route !== 'bus')) {
  const mode = modeOf(rel.tags), id = ref(rel.tags), seq = []
  for (const m of rel.members) {
    if (m.type !== 'node' || !/stop/.test(m.role) || m.lat == null) continue
    let best, bd = 400
    for (const f of railStops) if (f.properties.mode === mode && haversine(m, fpt(f)) < bd) (bd = haversine(m, fpt(f))), (best = f)
    if (!best) continue
    const nid = node(mode, best.properties.name, fpt(best).lat, fpt(best).lon)
    if (seq.at(-1) !== nid) seq.push(nid)
  }
  ;(railSeqs[id] ??= []).push(seq)
}
const TJ_FALLBACK = ['#d6202a', '#3d4fa0', '#7b2c86', '#5a3a8a', '#e57e25', '#3da447', '#c6334b', '#d8368a', '#2f8f83', '#8b1e3f', '#1d6fb8', '#00a99d', '#7b4ea3', '#f39c12']
const schLines = [
  ...LINES.filter((l) => railSeqs[l.id]).map((l) => ({ ...l, mode: LINE_MODE[l.id], seqs: dedupe(railSeqs[l.id]) })),
  { id: 'M', mode: 'mrt', name: 'MRT Lin Utara–Selatan', color: '#e2231a', seqs: [[...stations].reverse().map((s) => node('mrt', s.name, s.lat, s.lon, s.code))] }, // BHI first
  ...Object.keys(tj.seqs).sort((a, b) => a - b).map((id) => ({
    id, mode: 'tj', name: tj.names[id] ?? `Koridor ${id}`, color: tj.colors?.[id] ?? TJ_FALLBACK[id - 1],
    seqs: dedupe(tj.seqs[id].map((q) => q.map((i) => tjMerged[i]).map((h) => node('tj', h.name, h.lat, h.lon)).filter((v, i, a) => v !== a[i - 1]))),
  })),
]
const sch = buildSchematic(schNodes, schLines)
await writeFile(here('../public/data/schematic.json'), JSON.stringify(sch))
console.log(`schematic.json: ${sch.nodes.length} nodes, ${sch.lines.length} lines (${schLines.map((l) => `${l.id}:${l.seqs.length}`).join(' ')}), ${sch.links.length} links; ${(JSON.stringify(sch).length / 1e3).toFixed(0)} kB`)
const count = (m) => routeFeatures.filter((f) => f.properties.mode === m).length + '/' + stopFeatures.filter((f) => f.properties.mode === m).length
console.log(`TJ headway @08 WIB (wd): ${Object.entries(tjHeadway).map(([k, v]) => `${k}:${v.wd?.[8]}`).join(' ')}`)
console.log(`network.json: ways/stops krl ${count('krl')}, lrt ${count('lrt')}, tj ${count('tj')}; ${(JSON.stringify(network).length / 1e3).toFixed(0)} kB`)
