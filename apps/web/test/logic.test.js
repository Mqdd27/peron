import { test } from 'node:test'
import assert from 'node:assert/strict'
import { haversine, projectToAxis, parseTimes, locateOnLine, nearestStop } from '../src/lib/geo.js'
import { jakartaNow, nextDepartures, trainsNow } from '../src/lib/time.js'

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

test('trainsNow places a train between stations from the timetable', () => {
  const tt = (bhi, lbb = []) => ({ toBHI: { weekday: bhi, weekend: [] }, toLBB: { weekday: lbb, weekend: [] } })
  const st = [
    { code: 'A', timetable: tt(['08:00']) },
    { code: 'B', timetable: tt(['08:04'], ['08:10']) },
    { code: 'C', timetable: tt([], ['08:07']) },
  ]
  const at = (hhmm) => new Date(`2026-11-18T${hhmm}:00+07:00`) // Wednesday
  assert.deepEqual(trainsNow(st, at('08:02')), [{ dir: 'toBHI', from: 'A', to: 'B', f: 0.5, eta: 484 }])
  assert.deepEqual(trainsNow(st, at('08:05')).map((t) => t.from + t.to), ['BC']) // terminus hop = 2.5 min
  assert.deepEqual(trainsNow(st, at('08:08')).map((t) => t.from + t.to), ['CB'])
  assert.deepEqual(trainsNow(st, at('09:00')), [])
})

test('locateOnLine snaps a fix to the nearest segment', () => {
  const st = [
    { code: 'A', lat: -6.30, lon: 106.80 },
    { code: 'B', lat: -6.28, lon: 106.80 },
    { code: 'C', lat: -6.28, lon: 106.82 },
  ]
  const r = locateOnLine(st, { lat: -6.29, lon: 106.8005 }) // halfway A–B, ~55 m east
  assert.equal(r.from + r.to, 'AB')
  assert.ok(Math.abs(r.t - 0.5) < 0.01)
  assert.ok(r.off > 40 && r.off < 70)
  assert.equal(locateOnLine(st, { lat: -6.279, lon: 106.819 }).nearest.code, 'C')
})

test('nearestStop picks the closest stop across modes', () => {
  const mrt = [{ code: 'A', name: 'A', lat: -6.30, lon: 106.80 }]
  const krl = [{ name: 'K', mode: 'krl', lat: -6.25, lon: 106.80 }]
  assert.equal(nearestStop(mrt, krl, { lat: -6.26, lon: 106.80 }).name, 'K')
  assert.equal(nearestStop(mrt, krl, { lat: -6.29, lon: 106.80 }).code, 'A')
})

test('schematic: dedupe keeps branches, drops reversed/contained patterns', async () => {
  const { dedupe } = await import('../scripts/schematic.mjs')
  const out = dedupe([['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a'], ['b', 'c'], ['a', 'b', 'x'], ['z']])
  assert.deepEqual(out, [['a', 'b', 'c', 'd'], ['a', 'b', 'x']])
})

test('schematic: projection is monotonic and compresses the outskirts', async () => {
  const { project } = await import('../src/lib/geo.js')
  const at = (km) => project({ lat: -6.2 - km / 110.57, lon: 106.823 }).y
  assert.ok(at(1) > 0 && at(10) > at(1) && at(40) > at(10))
  assert.ok(at(40) - at(30) < (at(2) - at(1)) * 10) // 10 km out there < 10× 1 km in the core
})

test('findRoute: cross-mode trips with direction and transfers', async () => {
  const { readFileSync } = await import('node:fs')
  const { buildGraph, findRoute, placeNodes } = await import('../src/lib/route.js')
  const { LANDMARKS } = await import('../src/lib/network.js')
  const g = buildGraph(JSON.parse(readFileSync(new URL('../public/data/schematic.json', import.meta.url))))
  const trip = (a, b) => findRoute(g, placeNodes(g, a, LANDMARKS), placeNodes(g, b, LANDMARKS))
  const says = (r) => r.legs.map((l) => (l.type === 'ride' ? `${l.line}:${g.node.get(l.to).name}:${l.toward}` : 'walk'))

  // landmark → nearest MRT station, one ride, heading north
  assert.deepEqual(says(trip('Fatmawati', 'Gelora Bung Karno')), ['M:Istora:Bundaran HI'])
  // MRT → walk at Dukuh Atas → KRL, not the airport train
  const bm = says(trip('Blok M', 'Manggarai'))
  assert.equal(bm[0], 'M:Dukuh Atas:Bundaran HI')
  assert.equal(bm[1], 'walk')
  assert.ok(!bm.some((s) => s.startsWith('A:')))
  // round-trip TJ corridor: direction is the far terminus, not the start
  assert.ok(says(trip('Ragunan', 'Monas'))[0].endsWith(':Galunggung'))
  assert.equal(trip('Fatmawati', 'Tidak Ada'), null)
})

test('followLine: snaps a ride onto its ways, falls back to spare ways, then straight', async () => {
  const { followLine } = await import('../src/lib/route.js')
  const a = [106.8, -6.2], b = [106.81, -6.2]
  const bend = [[106.8, -6.2], [106.805, -6.205], [106.81, -6.2]]
  assert.deepEqual(followLine([bend], [a, b]), [a, ...bend, b])
  assert.deepEqual(followLine([], [a, b], [bend]), [a, ...bend, b])
  assert.deepEqual(followLine([], [a, b]), [a, b])
})

test('legStripes: a ride the same colour as an earlier one is striped, official colours kept', async () => {
  const { legStripes } = await import('../src/lib/route.js')
  assert.deepEqual(legStripes(['#e2231a', '#D62126', '#45A49E']), [false, true, false])
  assert.deepEqual(legStripes(['#e2231a', '#D62126', '#9b1f21']), [false, true, true])
})
