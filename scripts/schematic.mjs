// Generated metro-style schematic: own layout from OSM/GTFS geography, not traced from any official map.
// geography → radial compression (project) → octilinear relaxation → offset parallel lines → greedy labels.
// ponytail: anchor relaxation + straight runs, not an optimal (MIP) octilinear layout; readable, not print-perfect.
import { haversine, project } from '../src/lib/geo.js'

const SEP = '\u0001'
const r1 = (v) => Math.round(v * 10) / 10

// Drop patterns that are a contiguous run (either direction) of a longer one; the rest are branches.
export function dedupe(seqs) {
  const s = seqs.filter((q) => q.length > 1).sort((a, b) => b.length - a.length)
  const inside = (q, p) => {
    const hay = SEP + p.join(SEP) + SEP
    return hay.includes(SEP + q.join(SEP) + SEP) || hay.includes(SEP + [...q].reverse().join(SEP) + SEP)
  }
  return s.filter((q, i) => !s.slice(0, i).some((p) => inside(q, p)))
}

function rounded(pts, R = 10) {
  const f = (p) => `${r1(p[0])},${r1(p[1])}`
  let d = `M${f(pts[0])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, c, n] = [pts[i - 1], pts[i], pts[i + 1]]
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]), l2 = Math.hypot(n[0] - c[0], n[1] - c[1])
    const r = Math.min(R, l1 / 2, l2 / 2)
    if (!l1 || !l2) continue
    d += `L${f([c[0] - ((c[0] - p[0]) / l1) * r, c[1] - ((c[1] - p[1]) / l1) * r])}Q${f(c)} ${f([c[0] + ((n[0] - c[0]) / l2) * r, c[1] + ((n[1] - c[1]) / l2) * r])}`
  }
  return d + `L${f(pts.at(-1))}`
}

/**
 * @param nodes Map id → {id, name, mode, lat, lon, code?}
 * @param lines [{id, mode, name, color, seqs: [[node id]]}] in drawing/offset order
 */
export function buildSchematic(nodes, lines) {
  // only stops that ended up on a drawn pattern (dedupe drops one-stop fragments)
  const used = new Set(lines.flatMap((l) => l.seqs.flat()))
  for (const id of nodes.keys()) if (!used.has(id)) nodes.delete(id)
  const N = [...nodes.values()]
  for (const n of N) {
    const p = project(n)
    Object.assign(n, { x: p.x, y: p.y, ax: p.x, ay: p.y, lines: [] })
  }
  for (const ln of lines) for (const q of ln.seqs) for (const id of q) if (!nodes.get(id).lines.includes(ln.id)) nodes.get(id).lines.push(ln.id)

  // Edges between consecutive stops, with the lines running on each.
  const E = new Map()
  const key = (a, b) => [a, b].sort().join(SEP)
  for (const ln of lines)
    for (const q of ln.seqs)
      for (let i = 1; i < q.length; i++) {
        const k = key(q[i - 1], q[i])
        if (!E.has(k)) {
          const [a, b] = [q[i - 1], q[i]].sort()
          E.set(k, { a: nodes.get(a), b: nodes.get(b), refs: [], via: [] })
        }
        if (!E.get(k).refs.includes(ln.id)) E.get(k).refs.push(ln.id)
      }
  const nb = new Map(N.map((n) => [n.id, []]))
  for (const e of E.values()) nb.get(e.a.id).push(e.b.id), nb.get(e.b.id).push(e.a.id)

  // Anchors: junctions, line ends, and the turning points of each run (Douglas-Peucker on geography).
  // Everything between two anchors is laid out as one straight run with evenly spaced stops.
  const anchor = new Set(N.filter((n) => nb.get(n.id).length !== 2).map((n) => n.id))
  for (const ln of lines) for (const q of ln.seqs) anchor.add(q[0]), anchor.add(q.at(-1))
  const walk = () => {
    const seen = new Set(), runs = []
    for (const a of anchor)
      for (const m of nb.get(a)) {
        if (seen.has(key(a, m))) continue
        const run = [a, m]
        seen.add(key(a, m))
        while (!anchor.has(run.at(-1))) {
          const next = nb.get(run.at(-1)).find((x) => x !== run.at(-2))
          seen.add(key(run.at(-1), next))
          run.push(next)
        }
        runs.push(run)
      }
    return { runs, seen }
  }
  // loops with no anchor at all: pin one stop
  for (const n of N) if (!walk().seen.has(key(n.id, nb.get(n.id)[0] ?? n.id)) && nb.get(n.id).length) anchor.add(n.id)
  const TOL = 45 // schematic units (~0.5 km in the core) a run may wander before it gets a bend
  const dp = (run) => {
    const a = nodes.get(run[0]), b = nodes.get(run.at(-1)), L = Math.hypot(b.ax - a.ax, b.ay - a.ay) || 1
    let far = 0, at = -1
    for (let i = 1; i < run.length - 1; i++) {
      const n = nodes.get(run[i]), d = Math.abs((b.ax - a.ax) * (a.ay - n.ay) - (a.ax - n.ax) * (b.ay - a.ay)) / L
      if (d > far) (far = d), (at = i)
    }
    if (far > TOL) anchor.add(run[at]), dp(run.slice(0, at + 1)), dp(run.slice(at))
  }
  for (const run of walk().runs) dp(run)
  const runs = walk().runs.map((r) => {
    const a = nodes.get(r[0]), b = nodes.get(r.at(-1)), rail = r.some((id) => nodes.get(id).mode !== 'tj')
    return { r, a, b, th: Math.round(Math.atan2(b.ay - a.ay, b.ax - a.ax) / (Math.PI / 4)) * (Math.PI / 4), min: (r.length - 1) * (rail ? 34 : 26) }
  })

  // Relax the anchors: runs onto their octilinear direction and at least their minimum length,
  // anchors near their geography, crowded anchors apart.
  const A = N.filter((n) => anchor.has(n.id)), MIN = 34
  for (let it = 0; it < 900; it++) {
    for (const u of runs) {
      const dx = u.b.x - u.a.x, dy = u.b.y - u.a.y, len = Math.max(u.min, Math.hypot(dx, dy))
      const ex = (len * Math.cos(u.th) - dx) * 0.15, ey = (len * Math.sin(u.th) - dy) * 0.15
      ;(u.a.x -= ex), (u.a.y -= ey), (u.b.x += ex), (u.b.y += ey)
    }
    for (const n of A) (n.x += (n.ax - n.x) * 0.015), (n.y += (n.ay - n.y) * 0.015)
    for (let i = 0; i < A.length; i++)
      for (let j = i + 1; j < A.length; j++) {
        const a = A[i], b = A[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy)
        if (d >= MIN || !d) continue
        const f = ((MIN - d) / d) * 0.5
        ;(a.x -= dx * f), (a.y -= dy * f), (b.x += dx * f), (b.y += dy * f)
      }
  }
  for (const n of A) (n.x = r1(n.x)), (n.y = r1(n.y))

  // Each run: straight along its direction, or straight–45°–straight when the anchors don't line up.
  // Stops are spread evenly along it; bends between two stops become waypoints of that edge.
  for (const { r, a, b, th } of runs) {
    const dx = b.x - a.x, dy = b.y - a.y, u1 = [Math.cos(th), Math.sin(th)]
    let route = [[a.x, a.y], [b.x, b.y]]
    for (const s of [1, -1]) {
      const u2 = [Math.cos(th + (s * Math.PI) / 4), Math.sin(th + (s * Math.PI) / 4)]
      const det = u1[0] * u2[1] - u1[1] * u2[0]
      const s1 = (dx * u2[1] - dy * u2[0]) / det, s2 = (u1[0] * dy - u1[1] * dx) / det
      if (s1 >= 0 && s2 > 1) {
        const p1 = [a.x + (u1[0] * s1) / 2, a.y + (u1[1] * s1) / 2]
        route = [[a.x, a.y], p1, [p1[0] + u2[0] * s2, p1[1] + u2[1] * s2], [b.x, b.y]]
        break
      }
    }
    const cum = [0]
    for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]))
    const at = (l) => {
      let i = 1
      while (i < route.length - 1 && cum[i] < l) i++
      const t = (l - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
      return [route[i - 1][0] + (route[i][0] - route[i - 1][0]) * t, route[i - 1][1] + (route[i][1] - route[i - 1][1]) * t]
    }
    const k = r.length - 1, total = cum.at(-1)
    for (let i = 1; i < k; i++) {
      const [x, y] = at((total * i) / k), n = nodes.get(r[i])
      ;(n.x = r1(x)), (n.y = r1(y))
    }
    for (let i = 1; i <= k; i++) {
      const lo = (total * (i - 1)) / k, hi = (total * i) / k
      const pts = route.slice(1, -1).filter((_, j) => cum[j + 1] > lo + 0.5 && cum[j + 1] < hi - 0.5).map((p) => p.map(r1))
      if (pts.length) {
        const e = E.get(key(r[i - 1], r[i]))
        e.via = e.a.id === r[i - 1] ? pts : pts.reverse()
      }
    }
  }

  // Parallel lines on a shared edge sit side by side, ordered by the global line order.
  // Offsets use the edge's canonical a→b normals (mitred at waypoints) so both travel directions agree.
  const order = Object.fromEntries(lines.map((l, i) => [l.id, i]))
  const edgePoly = (uId, vId, id) => {
    const e = E.get(key(uId, vId)), n = e.refs.length
    const gap = lines[order[id]].mode === 'tj' ? 4 : 6
    const o = ([...e.refs].sort((p, q) => order[p] - order[q]).indexOf(id) - (n - 1) / 2) * gap
    const P = [[e.a.x, e.a.y], ...e.via, [e.b.x, e.b.y]]
    const nrm = P.slice(1).map((q, i) => {
      const dx = q[0] - P[i][0], dy = q[1] - P[i][1], l = Math.hypot(dx, dy) || 1
      return [-dy / l, dx / l]
    })
    const out = P.map((p, i) => {
      const a = nrm[Math.max(0, i - 1)], b = nrm[Math.min(nrm.length - 1, i)]
      const m = [a[0] + b[0], a[1] + b[1]], ml = Math.hypot(...m) || 1, cos = (m[0] * a[0] + m[1] * a[1]) / ml || 1
      return [p[0] + (m[0] / ml / cos) * o, p[1] + (m[1] / ml / cos) * o]
    })
    return e.a.id === uId ? out : out.reverse()
  }
  const segs = [] // drawn polylines, for label collision
  const outLines = lines.map((ln) => {
    const d = ln.seqs.map((q) => {
      const pts = []
      for (let i = 1; i < q.length; i++)
        for (const p of edgePoly(q[i - 1], q[i], ln.id)) {
          const last = pts.at(-1)
          if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.5) pts.push(p)
        }
      segs.push(pts)
      return rounded(pts)
    }).join('')
    return { id: ln.id, mode: ln.mode, name: ln.name, color: ln.color, d, stops: ln.seqs }
  })

  // Walking transfers: nearby stops of different stations (at least one rail), not already joined by a line.
  const links = []
  for (let i = 0; i < N.length; i++)
    for (let j = i + 1; j < N.length; j++) {
      const a = N[i], b = N[j]
      if (a.mode === 'tj' && b.mode === 'tj') continue
      if (E.has(key(a.id, b.id)) || haversine(a, b) > (a.mode !== 'tj' && b.mode !== 'tj' ? 500 : 300)) continue
      links.push([a.x, a.y, b.x, b.y, Math.round(haversine(a, b))])
    }

  // Labels: candidate spots (side, above/below, or 45° on horizontal runs like the printed maps),
  // each sampled as points along the text; keep the one crossing the fewest lines, stops and earlier labels.
  const CELL = 6, grid = new Map()
  const cell = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`
  const put = (x, y, w) => grid.set(cell(x, y), (grid.get(cell(x, y)) ?? 0) + w)
  for (const pts of segs)
    for (let i = 1; i < pts.length; i++) {
      const [p, q] = [pts[i - 1], pts[i]], n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 3)
      for (let s = 0; s <= n; s++) put(p[0] + ((q[0] - p[0]) * s) / n, p[1] + ((q[1] - p[1]) * s) / n, 1)
    }
  for (const n of N) for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) put(n.x + dx, n.y + dy, 3)
  const hub = (n) => n.lines.length > 1
  const rank = (n) => (n.mode === 'mrt' ? 0 : n.mode !== 'tj' ? (hub(n) ? 1 : 2) : hub(n) ? 3 : 4)
  const dirAt = (n) => {
    const ms = nb.get(n.id).map((id) => nodes.get(id))
    if (!ms.length) return [1, 0]
    const [p, q] = ms.length > 1 ? [ms[0], ms[1]] : [n, ms[0]]
    const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1
    return [dx / l, dy / l]
  }
  const R = Math.SQRT1_2
  for (const n of [...N].sort((a, b) => rank(a) - rank(b))) {
    const fs = n.mode === 'mrt' ? 13 : n.mode !== 'tj' ? (hub(n) ? 12 : 10.5) : hub(n) ? 9 : 8
    const w = n.name.length * fs * 0.52, gap = n.mode === 'mrt' ? 12 : n.mode !== 'tj' ? 10 : 7
    const [tx, ty] = dirAt(n), flat = Math.abs(ty) < 0.35
    const cands = []
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1], [R, -R], [-R, -R], [R, R], [-R, R]]) {
      const a = dx > 0.1 ? 'start' : dx < -0.1 ? 'end' : 'middle'
      const lx = n.x + dx * gap, ly = n.y + dy * gap + (dy > 0.1 ? fs * 0.8 : dy < -0.1 ? 0 : fs * 0.35)
      const pen = Math.abs(dx * tx + dy * ty) * 1.5 + (flat ? 1 : 0) // prefer perpendicular to the run
      cands.push({ lx, ly, a, rot: 0, pen, ux: 1, uy: 0, x0: a === 'start' ? 0 : a === 'end' ? -w : -w / 2 })
    }
    if (flat)
      for (const s of [1, -1]) // 45° up-right above the line, or down-left below it
        cands.push({ lx: n.x + s * gap * R, ly: n.y - s * gap * R, a: s > 0 ? 'start' : 'end', rot: -45, pen: 0, ux: R, uy: -R, x0: s > 0 ? 0 : -w })
    let best
    for (const c of cands) {
      const pts = []
      for (let t = c.x0; t <= c.x0 + w; t += 4) pts.push([c.lx + c.ux * t + c.uy * fs * 0.35, c.ly + c.uy * t - c.ux * fs * 0.35])
      const cost = pts.reduce((sum, [x, y]) => sum + (grid.get(cell(x, y)) ?? 0), 0) + c.pen
      if (!best || cost < best.cost) best = { ...c, cost, pts }
    }
    for (const [x, y] of best.pts) for (const [dx, dy] of [[0, 0], [0, -fs / 2], [0, fs / 2]]) put(x + dx, y + dy, 4)
    Object.assign(n, { lx: r1(best.lx), ly: r1(best.ly), la: best.a, rot: best.rot, fs })
  }

  const xs = N.map((n) => n.x), ys = N.map((n) => n.y)
  const bounds = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
  return {
    nodes: N.map(({ id, name, mode, code, x, y, lines, lx, ly, la, rot, fs }) => ({ id, name, mode, code, x, y, lines, lx, ly, la, rot, fs })),
    lines: outLines,
    links: links.map((l) => l.map(r1)),
    bounds,
  }
}
