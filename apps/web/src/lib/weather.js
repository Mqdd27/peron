// Weather near a station/halte (issue #7): Open-Meteo forecast API, open access, no key.
// Model estimate for the coordinate, not a sensor on the platform.

const API = 'https://api.open-meteo.com/v1/forecast'
const TTL = 15 * 60_000

// WMO weather_code → Indonesian label + emoji icon.
const WMO = [
  [[0], 'Cerah', '☀️'],
  [[1], 'Cerah berawan', '🌤️'],
  [[2], 'Berawan sebagian', '⛅'],
  [[3], 'Berawan', '☁️'],
  [[45, 48], 'Berkabut', '🌫️'],
  [[51, 53, 55, 56, 57], 'Gerimis', '🌦️'],
  [[61, 63, 66, 80, 81], 'Hujan', '🌧️'],
  [[65, 67, 82], 'Hujan lebat', '🌧️'],
  [[71, 73, 75, 77, 85, 86], 'Salju', '🌨️'],
  [[95], 'Badai petir', '⛈️'],
  [[96, 99], 'Badai petir & hujan es', '⛈️'],
]
export function wmo(code) {
  const hit = WMO.find(([codes]) => codes.includes(code))
  return hit ? { label: hit[1], icon: hit[2] } : { label: 'Tidak diketahui', icon: '🌡️' }
}

// ~1 km grid: nearby stops share one request and one cache entry.
export const cellKey = (lat, lon) => `${lat.toFixed(2)},${lon.toFixed(2)}`

export function weatherUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    forecast_hours: '12',
    timezone: 'Asia/Jakarta',
  })
  return `${API}?${p}`
}

const cache = new Map() // key → { at, promise }

// Resolves to { at, current, hours }; rejects with Error('offline' | 'nocoord' | 'http NNN' | timeout).
// In-flight requests are shared; a failed one is dropped so the next call retries.
export function getWeather(lat, lon, { fetch: f = globalThis.fetch, now = Date.now() } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.reject(new Error('nocoord'))
  const key = cellKey(lat, lon)
  const hit = cache.get(key)
  if (hit && now - hit.at < TTL) return hit.promise
  if (globalThis.navigator?.onLine === false) return Promise.reject(new Error('offline'))
  const promise = f(weatherUrl(lat, lon), { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http ${r.status}`))))
    .then((j) => parse(j, now))
  promise.catch(() => cache.get(key)?.promise === promise && cache.delete(key))
  cache.set(key, { at: now, promise })
  return promise
}
export const clearWeatherCache = () => cache.clear()

function parse(j, at) {
  const c = j.current, h = j.hourly
  return {
    at,
    current: {
      temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m,
      rain: c.precipitation, wind: c.wind_speed_10m, ...wmo(c.weather_code),
    },
    hours: h.time.map((t, i) => ({ time: t.slice(11, 16), temp: h.temperature_2m[i], pop: h.precipitation_probability[i], ...wmo(h.weather_code[i]) })),
  }
}
