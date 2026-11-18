import { test } from 'node:test'
import assert from 'node:assert/strict'
import { haversine, projectToAxis, parseTimes } from '../src/lib/geo.js'
import { jakartaNow, nextDepartures } from '../src/lib/time.js'

test('parseTimes trims seconds, dedupes, keeps after-midnight last', () => {
  assert.deepEqual(parseTimes('23:50:00; 05:06:30; 00:10:00; 05:06:30; '), ['05:06', '23:50', '00:10'])
  assert.deepEqual(parseTimes(undefined), [])
})

test('haversine ~111 km per degree latitude', () => {
  assert.ok(Math.abs(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111195) < 10)
})

test('projectToAxis: north axis, point east is along 0 and right side', () => {
  const s = { lat: -6.2, lon: 106.8 }
  const [p, q] = projectToAxis(s, { lat: -6.21, lon: 106.8 }, { lat: -6.19, lon: 106.8 }, [
    { lat: -6.2, lon: 106.8005 },
    { lat: -6.2005, lon: 106.8 },
  ])
  assert.ok(Math.abs(p.along) < 1 && p.across < -50)
  assert.ok(q.along < -50 && Math.abs(q.across) < 1)
})

test('jakartaNow uses UTC+7 regardless of device TZ', () => {
  // 2026-11-18 (Wed) 22:30 UTC = Thu 05:30 WIB
  assert.deepEqual(jakartaNow(new Date('2026-11-18T22:30:00Z')), { minutes: 330, weekend: false })
  // Sat 02:00 WIB counts as Friday's service day
  assert.equal(jakartaNow(new Date('2026-11-20T19:00:00Z')).weekend, false)
  assert.equal(jakartaNow(new Date('2026-11-21T00:00:00Z')).weekend, true)
})

test('nextDepartures picks weekday/weekend and handles end of day', () => {
  const t = { weekday: ['05:00', '05:40', '06:00', '06:20', '23:50'], weekend: ['06:00'] }
  const wed0530 = new Date('2026-11-17T22:30:00Z')
  assert.deepEqual(nextDepartures(t, wed0530), [
    { time: '05:40', inMin: 10 }, { time: '06:00', inMin: 30 }, { time: '06:20', inMin: 50 },
  ])
  assert.deepEqual(nextDepartures(t, new Date('2026-11-21T22:00:00Z')), [{ time: '06:00', inMin: 60 }]) // Sun 05:00 WIB
  assert.deepEqual(nextDepartures(t, new Date('2026-11-18T17:00:00Z')), []) // 00:00 WIB, after last train
})
