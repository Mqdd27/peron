// Pure logic shared by the app and scripts/build-data.mjs. Tested in test/logic.test.js.

const R = 6371000
const rad = (d) => (d * Math.PI) / 180

/** Great-circle distance in metres between {lat, lon} points. */
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Local east/north offset in metres of p relative to origin o. */
function local(o, p) {
  return [rad(p.lon - o.lon) * R * Math.cos(rad(o.lat)), rad(p.lat - o.lat) * R]
}

/**
 * Project points onto the station's track axis (prev → next station, i.e. toward BHI).
 * Returns [{along, across}] in metres: along < 0 = toward Lebak Bulus, across > 0 = left of travel to BHI.
 */
export function projectToAxis(station, prev, next, points) {
  const [ax, ay] = local(prev ?? station, next ?? station)
  const len = Math.hypot(ax, ay) || 1
  const ux = ax / len, uy = ay / len
  return points.map((p) => {
    const [x, y] = local(station, p)
    return { along: x * ux + y * uy, across: ux * y - uy * x }
  })
}

/** "05:06:30; 05:21:30; " → ["05:06", "05:21"], sorted, service day 04:00–03:59. */
export function parseTimes(str) {
  if (!str) return []
  const key = (t) => (t < '04:00' ? '1' : '0') + t
  return [...new Set(String(str).split(';').map((t) => t.trim().slice(0, 5)).filter((t) => /^\d\d:\d\d$/.test(t)))].sort(
    (a, b) => key(a).localeCompare(key(b)),
  )
}

/**
 * Snap a GPS fix onto the line through ordered stations (each {code, lat, lon}).
 * Returns {from, to, t, off} — segment endpoints, fraction along it, metres off the line —
 * plus nearest: {code, dist} by straight-line distance.
 */
export function locateOnLine(stations, p) {
  let best = null
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1]
    const [bx, by] = local(a, b), [px, py] = local(a, p)
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by || 1)))
    const off = Math.hypot(px - t * bx, py - t * by)
    if (!best || off < best.off) best = { from: a.code, to: b.code, t, off }
  }
  const near = stations.reduce((x, y) => (haversine(y, p) < haversine(x, p) ? y : x))
  return { ...best, nearest: { code: near.code, dist: haversine(near, p) } }
}

// Nearest stop of any mode: MRT stations (with code) plus OSM stops [{name, mode, lat, lon}].
export function nearestStop(stations, stops, p) {
  let best = null
  for (const s of [...stations.map((x) => ({ name: x.name, mode: 'mrt', code: x.code, lat: x.lat, lon: x.lon })), ...stops]) {
    const dist = haversine(s, p)
    if (!best || dist < best.dist) best = { ...s, dist }
  }
  return best
}

// Schematic projection: km around Dukuh Atas, radially compressed (asinh) so the dense core keeps room
// while Bogor/Rangkasbitung still fit. a = radius (km) where compression starts, u = schematic units per km.
const SCH = { lat: -6.2, lon: 106.823, a: 4, u: 85 } // a: km where compression starts; smaller = tighter outskirts
export function project({ lat, lon }) {
  const x = (lon - SCH.lon) * 110.57 * Math.cos((SCH.lat * Math.PI) / 180), y = (SCH.lat - lat) * 110.57
  const r = Math.hypot(x, y)
  const k = r ? ((SCH.a * Math.asinh(r / SCH.a)) / r) * SCH.u : SCH.u
  return { x: x * k, y: y * k }
}
