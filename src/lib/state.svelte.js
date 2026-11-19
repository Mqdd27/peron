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
