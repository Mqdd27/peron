import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { wmo, cellKey, weatherUrl, getWeather, clearWeatherCache } from '../src/lib/weather.js'

const body = {
  current: { temperature_2m: 31.4, apparent_temperature: 36.1, relative_humidity_2m: 70, precipitation: 0, weather_code: 2, wind_speed_10m: 9.8 },
  hourly: { time: ['2026-11-25T14:00', '2026-11-25T15:00'], temperature_2m: [31, 29], precipitation_probability: [20, 65], weather_code: [2, 95] },
}
const fakeFetch = (res = { ok: true, status: 200, json: async () => body }) => {
  const calls = []
  const f = async (url) => (calls.push(url), typeof res === 'function' ? res() : res)
  return Object.assign(f, { calls })
}
beforeEach(clearWeatherCache)

test('wmo maps codes to Indonesian labels, unknown falls back', () => {
  assert.equal(wmo(0).label, 'Cerah')
  assert.equal(wmo(63).label, 'Hujan')
  assert.equal(wmo(82).label, 'Hujan lebat')
  assert.equal(wmo(95).label, 'Badai petir')
  assert.equal(wmo(1234).label, 'Tidak diketahui')
})

test('url carries the stop coordinate, Jakarta time and 12 h forecast', () => {
  const u = new URL(weatherUrl(-6.19353, 106.82311))
  assert.equal(u.searchParams.get('latitude'), '-6.1935')
  assert.equal(u.searchParams.get('longitude'), '106.8231')
  assert.equal(u.searchParams.get('forecast_hours'), '12')
  assert.equal(u.searchParams.get('timezone'), 'Asia/Jakarta')
  assert.equal(cellKey(-6.19353, 106.82311), '-6.19,106.82')
})

test('parses current + hourly', async () => {
  const w = await getWeather(-6.2, 106.8, { fetch: fakeFetch(), now: 1000 })
  assert.equal(w.current.temp, 31.4)
  assert.equal(w.current.label, 'Berawan sebagian')
  assert.deepEqual(w.hours[1], { time: '15:00', temp: 29, pop: 65, label: 'Badai petir', icon: '⛈️' })
})

test('nearby stops share one request within 15 min; refetch after expiry', async () => {
  const f = fakeFetch()
  await Promise.all([getWeather(-6.2001, 106.8001, { fetch: f, now: 0 }), getWeather(-6.2002, 106.8002, { fetch: f, now: 1 })])
  await getWeather(-6.2, 106.8, { fetch: f, now: 14 * 60_000 })
  assert.equal(f.calls.length, 1)
  await getWeather(-6.2, 106.8, { fetch: f, now: 16 * 60_000 })
  assert.equal(f.calls.length, 2)
})

test('errors reject and are not cached; missing coordinate rejects', async () => {
  const f = fakeFetch({ ok: false, status: 503 })
  await assert.rejects(getWeather(-6.2, 106.8, { fetch: f, now: 0 }), /http 503/)
  await assert.rejects(getWeather(-6.2, 106.8, { fetch: f, now: 1 }), /http 503/)
  assert.equal(f.calls.length, 2)
  await assert.rejects(getWeather(undefined, 106.8, { fetch: f }), /nocoord/)
})
