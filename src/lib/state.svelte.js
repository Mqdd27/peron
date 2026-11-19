import { jakartaNow } from './time.js'
// Single source of truth for selection; map, panel and SVG all read/write this.
// mode: null = all, or 'mrt' | 'krl' | 'lrt' | 'tj' to focus one mode (others dimmed). me = user GPS fix.
// focus = a non-MRT stop picked from search: {name, mode, lat, lon, sub, k}.
// stop = an open non-MRT station/halte (an item of net.stops).
// line = open line panel: {title, rows: [{id, color, tj, title, sub, stops: [{name, mode}]}]} (tapped from the schematic).
export const sel = $state({ station: null, exit: null, mode: null, me: null, focus: null, stop: null, line: null })

export function select(station, exit = null) {
  sel.station = station
  sel.exit = exit
  if (station) (sel.stop = null), (sel.line = null)
}

// Open a KRL/LRT/TJ stop's panel and pan the active view to it.
export function openStop(s) {
  select(null)
  sel.line = null
  sel.stop = s
  sel.focus = { ...s, k: Date.now() }
}

// OSM network for the other modes (issue #3). Optional: the app works without it.
export const netReady = fetch(`${import.meta.env.BASE_URL}data/network.json`)
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)
export const net = $state({ stops: [], tjHeadway: null, tjNames: {}, routes: [] })
netReady.then((d) => d && (net.tjHeadway = d.tjHeadway ?? null, net.tjNames = d.tjNames ?? {}, net.routes = d.routes ?? [], net.stops = d.stops.features.map((f) => ({ ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))))

// Generated whole-network schematic (scripts/schematic.mjs). Raw: it is read-only and large.
let sch = $state.raw(null)
fetch(`${import.meta.env.BASE_URL}data/schematic.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => (sch = d))
  .catch(() => {})
export const schematic = () => sch
// Line panel (sel.line) for schematic line ids; shared by Skema and Peta.
// fleet(id) → vehicles running now (only the schematic animates them; 0 hides it).
const MODE_NAME = { mrt: 'MRT Jakarta', krl: 'Kereta (KAI Commuter)', lrt: 'LRT', tj: 'Bus Transjakarta' }
export function tjHead(id) {
  const now = jakartaNow(new Date())
  return net.tjHeadway?.[id]?.[now.weekend ? 'we' : 'wd']?.[Math.floor(now.minutes / 60) % 24]
}
export const lineTitle = (ln) => (ln.mode === 'tj' ? `Koridor ${ln.id} · ${ln.name}` : ln.name)
export function lineData(ids, fleet = () => 0) {
  const node = new Map(sch?.nodes.map((n) => [n.id, n]))
  const here = ids.map((id) => sch?.lines.find((l) => l.id === id)).filter(Boolean)
  if (!here.length) return null
  const sub = (ln) => {
    const main = ln.stops[0] ?? [], n = new Set(ln.stops.flat()).size, tj = ln.mode === 'tj'
    const [a, z] = [node.get(main[0])?.name, node.get(main.at(-1))?.name]
    const ends = main.length && !tj ? (a === z ? ` · lingkar dari ${a}` : ` · ${a} – ${z}`) : ''
    const head = tj && tjHead(ln.id) ? ` · tiap ±${Math.round(tjHead(ln.id))} mnt` : ''
    const f = fleet(ln.id)
    return `${ln.id === 'A' ? 'KAI Bandara' : MODE_NAME[ln.mode]} · ${n} ${tj ? 'halte' : 'stasiun'}${ends}${head}${f ? ` · ${f} ${tj ? 'bus' : 'kereta'} jalan` : ''}`
  }
  return {
    title: here.length > 1 ? `${here.length} layanan lewat jalur ini` : lineTitle(here[0]),
    rows: here.map((l) => ({
      color: l.color, id: l.id, tj: l.mode === 'tj', mode: l.mode, title: lineTitle(l), sub: sub(l),
      stops: [...new Set(l.stops[0] ?? [])].map((id) => node.get(id)).map((n) => ({ name: n.name, mode: n.mode, code: n.code })), // round-trip patterns → each stop once
    })),
  }
}
export function openLine(ids, fleet) {
  const d = lineData(ids, fleet)
  if (!d) return
  select(null)
  sel.stop = null
  sel.line = d
}

// A real stop ({name, mode}) → its node on the schematic, or undefined.
export const drawnStop = ({ name, mode }) => sch?.nodes.find((n) => n.mode === mode && n.name === name)

// GPS (issue #2): realtime fix via watchPosition, shared by every view.
export const gps = $state({ on: false, error: null })
let watchId = null
export function toggleGps() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
    gps.on = false
    sel.me = null
    return
  }
  if (!('geolocation' in navigator)) return (gps.error = 'Perangkat ini tidak mendukung lokasi.')
  gps.on = true
  gps.error = null
  watchId = navigator.geolocation.watchPosition(
    (p) => (sel.me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
    (e) => {
      gps.error = e.code === 1 ? 'Izin lokasi ditolak. Aktifkan di pengaturan browser.' : 'Lokasi belum tersedia. Coba lagi di luar ruangan.'
      if (e.code === 1) toggleGps()
    },
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
  )
}
