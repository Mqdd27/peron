// Cross-mode route search over the schematic network (schematic.json): rides along line patterns,
// line changes inside a station, and walking transfers (sch.links). Pure, so it runs offline and in tests.
// ponytail: minutes are rough per-stop/headway constants, not timetables; edges are two-way (a few TJ
// one-way loops are treated as two-way). Swap in GTFS stop times if precise ETAs are needed.

const RIDE = { mrt: 2.2, krl: 3.5, lrt: 2.5, tj: 2.5 } // minutes per stop
const WAIT = { mrt: 5, krl: 8, lrt: 6, tj: 6 } // minutes, about half a typical headway
const WAIT_LINE = { A: 25 } // KA Bandara: separate fare, sparse service; only when nothing else fits
const BOARD = 2 // extra minutes per boarding, so fewer changes win ties
const WALK_M_PER_MIN = 75

export function buildGraph(sch) {
  const node = new Map(sch.nodes.map((n) => [n.id, n]))
  const line = new Map(sch.lines.map((l) => [l.id, l]))
  const adj = new Map() // `${node}|${line}` → Set of next node ids on that line
  for (const l of sch.lines)
    for (const q of l.stops)
      for (let i = 1; i < q.length; i++) {
        if (q[i] === q[i - 1]) continue
        for (const [a, b] of [[q[i - 1], q[i]], [q[i], q[i - 1]]]) {
          const k = `${a}|${l.id}`
          if (!adj.has(k)) adj.set(k, new Set())
          adj.get(k).add(b)
        }
      }
  // links are drawn as [x1, y1, x2, y2, metres]; map their ends back to nodes
  const at = (x, y) => sch.nodes.filter((n) => Math.abs(n.x - x) < 0.5 && Math.abs(n.y - y) < 0.5)
  const walk = new Map() // node id → [{ to, m }]
  for (const [x1, y1, x2, y2, m] of sch.links)
    for (const a of at(x1, y1))
      for (const b of at(x2, y2))
        for (const [p, q] of [[a, b], [b, a]]) {
          if (!walk.has(p.id)) walk.set(p.id, [])
          walk.get(p.id).push({ to: q.id, m })
        }
  return { sch, node, line, adj, walk }
}

// Node ids for a place name: every station/halte with that name, or a landmark's nearest station.
export function placeNodes(g, name, landmarks = []) {
  const n = name.trim().toLowerCase()
  const lm = landmarks.find((l) => l.name.toLowerCase() === n)
  return g.sch.nodes.filter((x) => x.name.toLowerCase() === n || (lm && (x.id === `mrt:${lm.near}` || x.name === lm.near))).map((x) => x.id)
}

// Dijkstra over (node, line) states; line '' = on foot. Returns { minutes, legs } or null.
export function findRoute(g, from, to) {
  const goal = new Set(to)
  const dist = new Map(), prev = new Map(), done = new Set()
  const queue = []
  const push = (k, d, p, how) => {
    if (d >= (dist.get(k) ?? Infinity)) return
    dist.set(k, d), prev.set(k, { p, how })
    queue.push([d, k])
  }
  for (const id of from) push(`${id}|`, 0, null, null)
  while (queue.length) {
    // ponytail: linear-scan priority queue, fine for a few thousand states; use a heap if the network grows
    let bi = 0
    for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[bi][0]) bi = i
    const [d, k] = queue.splice(bi, 1)[0]
    if (done.has(k)) continue
    done.add(k)
    const [id, ln] = k.split('|')
    if (!ln && goal.has(id)) return { minutes: Math.round(d), legs: legsOf(g, k, prev) }
    if (ln) {
      const mode = g.line.get(ln).mode
      for (const b of g.adj.get(k) ?? []) push(`${b}|${ln}`, d + RIDE[mode], k, 'ride')
      push(`${id}|`, d, k, 'alight')
    } else {
      for (const l of g.node.get(id).lines) push(`${id}|${l}`, d + (WAIT_LINE[l] ?? WAIT[g.line.get(l).mode]) + BOARD, k, 'board')
      for (const w of g.walk.get(id) ?? []) push(`${w.to}|`, d + w.m / WALK_M_PER_MIN + 1, k, 'walk')
    }
  }
  return null
}

function legsOf(g, end, prev) {
  const steps = []
  for (let k = end; prev.get(k)?.p; k = prev.get(k).p) steps.unshift({ k, from: prev.get(k).p, how: prev.get(k).how })
  const legs = []
  for (const s of steps) {
    const [a] = s.from.split('|'), [b, ln] = s.k.split('|')
    const last = legs.at(-1)
    if (s.how === 'ride') {
      if (last?.type === 'ride' && last.line === ln && last.to === a) last.stops.push(b), (last.to = b)
      else legs.push({ type: 'ride', line: ln, from: a, to: b, stops: [a, b] })
    } else if (s.how === 'walk') {
      const m = g.walk.get(a).find((w) => w.to === b).m
      legs.push({ type: 'walk', from: a, to: b, m })
    }
  }
  for (const l of legs) if (l.type === 'ride') l.toward = toward(g, l)
  return legs
}

// Name of the terminus a ride heads to: follow the pattern that contains this hop in this order.
function toward(g, leg) {
  const ln = g.line.get(leg.line)
  const ends = ln.name.split(' – ').map((s) => s.trim().toLowerCase())
  const [a, b] = leg.stops
  const isEnd = (id) => ends.some((e) => g.node.get(id).name.toLowerCase().startsWith(e))
  // Boarding or alighting at a named terminus settles it ("Ragunan – Galunggung" from Ragunan → Galunggung).
  const names = ln.name.split(' – ').map((s) => s.trim())
  if (names.length === 2) {
    const is = (id, e) => g.node.get(id).name.toLowerCase().startsWith(e.toLowerCase())
    if (is(leg.to, names[0]) || is(leg.to, names[1])) return is(leg.to, names[0]) ? names[0] : names[1]
    if (is(leg.from, names[0])) return names[1]
    if (is(leg.from, names[1])) return names[0]
  }
  // a pattern running a → b as listed wins over one that has to be read backwards
  for (const dir of [1, -1])
    for (const q of ln.stops)
      for (let i = 0; i + 1 < q.length; i++) {
        if (!(dir > 0 ? q[i] === a && q[i + 1] === b : q[i] === b && q[i + 1] === a)) continue
        const here = g.node.get(a).name
        for (let j = dir > 0 ? i + 1 : i; j >= 0 && j < q.length; j += dir) {
          if (ends.length > 1 && isEnd(q[j]) && g.node.get(q[j]).name !== here) return g.node.get(q[j]).name
          if (q[j - 1] === q[j + 1] && q[j - 1] !== undefined) return g.node.get(q[j]).name // turnaround
        }
        return g.node.get(dir > 0 ? q.at(-1) : q[0]).name
      }
  return g.node.get(leg.to).name
}

// Real-world shape of a ride for the map: shortest path along the line's OSM ways between each pair of
// consecutive stops ([lon, lat] each). Way ends within ~40 m of another way are joined (OSM gaps).
// A hop the line's own ways can't connect (e.g. a GTFS detour variant) is retried on `spare` (the other
// ways of the same mode), then falls back to a straight segment.
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 110540 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110540)
function wayGraph(ways) {
  const key = (c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`
  const pt = new Map(), adj = new Map()
  const link = (a, b) => { const d = metres(pt.get(a), pt.get(b)); for (const [p, q] of [[a, b], [b, a]]) (adj.get(p) ?? adj.set(p, []).get(p)).push([q, d]) }
  for (const w of ways) w.forEach((c, i) => (pt.set(key(c), c), i && link(key(w[i - 1]), key(c))))
  // ~330 m grid cells, so gap joining and stop snapping only look at nearby points
  const cell = (c, dx = 0, dy = 0) => `${Math.floor(c[0] / 0.003) + dx},${Math.floor(c[1] / 0.003) + dy}`
  const grid = new Map()
  for (const [k, c] of pt) (grid.get(cell(c)) ?? grid.set(cell(c), []).get(cell(c))).push(k)
  const around = (c) => [-1, 0, 1].flatMap((dx) => [-1, 0, 1].flatMap((dy) => grid.get(cell(c, dx, dy)) ?? []))
  for (const e of ways.flatMap((w) => [key(w[0]), key(w.at(-1))])) for (const k of around(pt.get(e))) if (k !== e && metres(pt.get(e), pt.get(k)) < 40) link(e, k)
  const nearest = (c) => { let best = null, bd = 300; for (const k of around(c)) { const d = metres(pt.get(k), c); if (d < bd) (bd = d), (best = k) } return best }
  return (from, to) => {
    const a = nearest(from), b = nearest(to)
    if (!a || !b) return null
    // ponytail: Dijkstra with a sorted-insert queue; fine for a few thousand vertices
    const dist = new Map([[a, 0]]), prev = new Map(), q = [[0, a]], done = new Set()
    while (q.length) {
      const [d, k] = q.shift()
      if (k === b) break
      if (done.has(k)) continue
      done.add(k)
      for (const [n, w] of adj.get(k) ?? []) {
        if (d + w >= (dist.get(n) ?? Infinity)) continue
        dist.set(n, d + w), prev.set(n, k)
        const i = q.findIndex((x) => x[0] > d + w)
        q.splice(i < 0 ? q.length : i, 0, [d + w, n])
      }
    }
    if (a !== b && !prev.has(b)) return null
    const out = [b]
    while (out[0] !== a) out.unshift(prev.get(out[0]))
    return out.map((k) => pt.get(k))
  }
}
export function followLine(ways, stops, spare = []) {
  const own = wayGraph(ways)
  let other = null
  // a path far longer than the hop itself is a wrong turn through unrelated ways, not the bus's road
  const sane = (run, a, b) => run && run.reduce((s, c, i) => s + (i ? metres(run[i - 1], c) : 0), 0) < 2.5 * metres(a, b) + 300 ? run : null
  const out = [stops[0]]
  for (let i = 1; i < stops.length; i++) {
    const [a, b] = [stops[i - 1], stops[i]]
    const run = sane(own(a, b), a, b) ?? sane((other ??= wayGraph(spare))(a, b), a, b)
    out.push(...(run ?? []), b)
  }
  return out
}

// Which rides of one trip need a white centre stripe: a line whose official colour is close to an earlier
// leg's (MRT red vs Koridor 1 red) keeps that colour, so it still matches the legend, but gets striped.
export function legStripes(colors) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const near = (a, b) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 100 }
  const out = []
  colors.forEach((c, i) => out.push(colors.slice(0, i).some((u, j) => !out[j] && near(u, c))))
  return out
}
