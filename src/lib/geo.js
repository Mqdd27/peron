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
