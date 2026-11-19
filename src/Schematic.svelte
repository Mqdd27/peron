<script>
  // Own-drawn schematic in the style of the FDTJ integration map (octilinear, rounded bends,
  // narrow labels, ticks + interchange rings). Not a copy of the FDTJ artwork.
  import { untrack } from 'svelte'
  import { sel, select, openStop, net } from './lib/state.svelte.js'
  import { trainsNow, jakartaNow } from './lib/time.js'
  import { locateOnLine, nearestStop } from './lib/geo.js'
  import { drawnStop, LINES, LINE_MODE, STATIONS, LINKS, DISTRICTS, BRT, BRT_HUBS, LANDMARKS, RIVERS, AREAS } from './lib/network.js'

  /** @type {{ data: any }} */
  let { data } = $props()

  // Layout in schematic units. tick = direction the station tick/label points to.
  const L = { x: -1, y: 0 }, NW = { x: -0.7071, y: -0.7071 }, S = { x: 0, y: 1 }
  const POS = {
    BHI: [420, 30, L], DKA: [420, 110, L],
    STB: [385, 235, NW], BNH: [350, 270, NW], IST: [315, 305, NW], SNY: [280, 340, NW],
    ASN: [220, 470, L], BLM: [220, 550, L], BLA: [220, 630, L], HJN: [220, 710, L], CPR: [220, 790, L],
    FTM: [150, 880, S], LBB: [20, 880, S],
  }
  const TRACK = 'M420,30 V180 Q420,200 406,214 L234,386 Q220,400 220,420 V850 Q220,880 190,880 H20'
  const FULL = { x: -240, y: -350, w: 1520, h: 1320 }
  // The printed "sheet": every drawn thing lives inside it.
  const SHEET = { x: -210, y: -320, w: 1460, h: 1260 }
  const GRID = 120
  const COLS = Array.from({ length: Math.round(SHEET.w / GRID) }, (_, i) => SHEET.x + i * GRID)
  const ROWS = Array.from({ length: Math.round((SHEET.h - 80) / GRID) }, (_, i) => SHEET.y + 80 + i * GRID)
  const BRT_SIDE = { '1': 'r', '13': 'b', '9': 'r', '6': 'l', '4': 'b', '8': 'l' }
  const BADGE = { '1': [436, -165], '13': [-112, 490], '9': [804, 530], '6': [540, 590], '4': [668, 196], '8': [-60, 30] }
  const BL = {
    l: (x, y) => [x - 9, y + 3.5, 'end'], r: (x, y) => [x + 9, y + 3.5, 'start'],
    t: (x, y) => [x, y - 9, 'middle'], b: (x, y) => [x, y + 16, 'middle'],
  }
  const MRT = { x: -70, y: -40, w: 620, h: 990 }
  const color = Object.fromEntries(LINES.map((l) => [l.id, l.color]))
  const LABEL = {
    l: (s) => [s.x - 14, s.y + 4, 'end'], r: (s) => [s.x + 14, s.y + 4, 'start'],
    t: (s) => [s.x, s.y - 14, 'middle'], b: (s) => [s.x, s.y + 24, 'middle'],
    mg: (s) => [s.x + 16, s.y + 26, 'start'],
    duri: (s) => [s.x + 16, s.y + 4, 'start'],
  }
  const TICK = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] }

  let stations = $derived(
    data.stations.map((s) => {
      const [x, y, t] = POS[s.code]
      const terminus = s.code === data.line.termini.south || s.code === data.line.termini.north
      const ring = terminus || !!s.integration.Transjakarta?.length || !!s.notes
      return { s, x, y, t, terminus, ring }
    }),
  )

  let svg
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  // --- live trains: timetable position → point on the drawn MRT track ---
  let meas // hidden copy of TRACK used only for length maths
  let trains = $state([])
  // KRL / LRT / Transjakarta: no open per-trip timetable (BRT runs on headways), so vehicles are
  // simulated from typical headways (minutes) at a fixed speed (schematic units per minute).
  // ponytail: frequency simulation, not real positions; swap in GTFS/GTFS-rt if operators publish one.
  const HEAD = { A: 30, C: 10, R: 15, B: 6, T: 15, S: 10, BK: 10, CB: 10 }
  const split = (list, bus) => list.flatMap((ln) => ln.d.split(/(?=M)/).map((d, i) => ({
    key: (bus ? 'tj' : '') + ln.id + i, ln, d, color: ln.color, bus,
    mode: bus ? 'tj' : LINE_MODE[ln.id], head: bus ? (ln.id === '1' ? 5 : 9) : HEAD[ln.id], v: bus ? 22 : 35,
  })))
  const SEGS = [...split(LINES, false), ...split(BRT, true)]
  const railEls = []
  // Official TJ headway (static GTFS frequencies) for this WIB hour, minutes; undefined = no GTFS data.
  function tjHead(id) {
    const now = jakartaNow(new Date())
    return net.tjHeadway?.[id]?.[now.weekend ? 'we' : 'wd']?.[Math.floor(now.minutes / 60) % 24]
  }
  let rail = $state([])
  function railNow() {
    const tm = Date.now() / 60000, hour = (tm / 60 + 7) % 24
    const night = hour < 4.5 // rail stops overnight (WIB)
    return SEGS.flatMap(({ key, ln, color, bus, mode, head, v }, i) => {
      if (night && !bus) return []
      if (bus) head = tjHead(ln.id) ?? (net.tjHeadway ? 0 : head) // GTFS: null hour = no service
      if (!head) return []
      const el = railEls[i], total = el.getTotalLength(), s = Math.max(2, head) * v, out = []
      for (const dir of [1, -1]) {
        const base = tm * v + (dir < 0 ? s / 2 : 0)
        for (let j = Math.floor(base / s); base - j * s < total; j--) {
          const l = dir > 0 ? base - j * s : total - (base - j * s)
          const p = el.getPointAtLength(l), a = el.getPointAtLength(Math.max(0, l - 1)), b = el.getPointAtLength(Math.min(total, l + 1))
          out.push({ id: key + dir + j, seg: i, dir, l, mode, color, bus, x: p.x, y: p.y,
            a: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + (dir < 0 ? 180 : 0) })
        }
      }
      return out
    })
  }
  let track = $state(null) // {at: station code → length along TRACK, total}
  // Vehicle visibility per mode; remembered per browser (convenience only).
  const VEH = [['mrt', 'MRT'], ['krl', 'KRL & KA Bandara'], ['lrt', 'LRT'], ['tj', 'Bus Transjakarta']]
  let show = $state({ mrt: true, krl: true, lrt: true, tj: true })
  try { Object.assign(show, JSON.parse(localStorage.getItem('peron:veh')) ?? {}) } catch {}
  $effect(() => { try { localStorage.setItem('peron:veh', JSON.stringify(show)) } catch {} })
  const allShown = $derived(VEH.every(([m]) => show[m]))
  const dim = (m) => sel.mode !== null && sel.mode !== m // mode focus (issue #3)
  $effect(() => {
    if (!meas) return
    // track length at each station = nearest sampled point on the path
    const total = meas.getTotalLength(), pts = []
    for (let l = 0; l <= total; l += 2) pts.push([l, meas.getPointAtLength(l)])
    const at = Object.fromEntries(stations.map(({ s, x, y }) => {
      let best = pts[0]
      for (const p of pts) if (Math.hypot(p[1].x - x, p[1].y - y) < Math.hypot(best[1].x - x, best[1].y - y)) best = p
      return [s.code, best[0]]
    }))
    track = { at, total }
    let ticked = false
    const tick = () => {
      if (g.k !== 1 || g.x || g.y) return // mid-gesture: don't repaint the SVG
      const prev = new Set(trains.map((t) => t.id))
      trains = trainsNow(data.stations).map(({ dir, from, to, f, eta }) => {
        const l = at[from] + (at[to] - at[from]) * f
        const p = meas.getPointAtLength(l), q = meas.getPointAtLength(Math.min(total, l + 1))
        // a new id = the train just left `from` (ids change once per hop)
        const dep = ticked && !reduced && !prev.has(dir + from)
        if (dep) depart(from)
        // sprites face +x, so trains running against the path direction turn around
        return { id: dir + from, dir, to, eta, dep, x: p.x, y: p.y, a: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI + (dir === 'toBHI' ? 0 : 180) }
      })
      ticked = true
      rail = railNow()
    }
    untrack(tick) // tick reads + writes trains; keep it out of this effect's deps
    const t = setInterval(tick, 2000)
    return () => clearInterval(t)
  })
  // Departure ripple at the station a train just left.
  let departs = $state([])
  let dn = 0
  function depart(code) {
    const st = stations.find((x) => x.s.code === code)
    const d = { id: ++dn, x: st.x, y: st.y }
    departs.push(d)
    setTimeout(() => (departs = departs.filter((x) => x.id !== d.id)), 1800)
  }
  // three.js is lazy-loaded so it never delays first paint; no WebGL → plain labels only.
  let sprites = $state({})
  $effect(() => {
    import('./lib/landmarks3d.js')
      .then((m) => (sprites = m.renderLandmarks([...new Set(LANDMARKS.map((l) => l.model))])))
      .catch(() => {})
  })
  let vb = $state({ ...(matchMedia('(min-width: 768px)').matches ? FULL : MRT) })

  // --- pan / pinch / wheel zoom ---
  // During a gesture we only move a CSS transform on the <svg> (GPU-composited, no SVG re-render),
  // then commit once to the viewBox when the gesture ends. Re-rendering ~500 nodes per pointermove lagged on Safari.
  const pointers = new Map()
  let moved = false
  let g = { x: 0, y: 0, k: 1 } // live px transform
  let wheelT
  // viewBox → screen mapping for preserveAspectRatio="xMidYMid meet" (.wrap sits at 0,0)
  function fit() {
    const W = svg.clientWidth, H = svg.clientHeight, s = Math.min(W / vb.w, H / vb.h)
    return { s, ox: (W - vb.w * s) / 2, oy: (H - vb.h * s) / 2 }
  }
  const scale = () => fit().s // px per unit
  function toUnits(cx, cy) {
    const { s, ox, oy } = fit()
    return [vb.x + (cx - ox) / s, vb.y + (cy - oy) / s]
  }
  const paint = () => (svg.style.transform = `translate(${g.x}px,${g.y}px) scale(${g.k})`)
  function zoomAt(cx, cy, f) {
    const k = Math.min(vb.w / 120, Math.max(vb.w / (FULL.w * 1.3), g.k * f))
    f = k / g.k
    g = { x: (g.x - cx) * f + cx, y: (g.y - cy) * f + cy, k }
    paint()
  }
  function commit() {
    const { x, y, k } = g
    if (k === 1 && !x && !y) return
    const { s, ox, oy } = fit()
    vb = { x: vb.x + (ox - x - ox * k) / (k * s), y: vb.y + (oy - y - oy * k) / (k * s), w: vb.w / k, h: vb.h / k }
    g = { x: 0, y: 0, k: 1 }
    svg.style.transform = ''
  }
  function down(e) {
    pointers.set(e.pointerId, [e.clientX, e.clientY])
    if (pointers.size === 1) moved = false
  }
  function move(e) {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    if (pointers.size === 1) {
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1]
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true
      g = { ...g, x: g.x + dx, y: g.y + dy }
      paint()
    } else if (pointers.size === 2) {
      const other = [...pointers.values()].find((p) => p !== prev)
      const d0 = Math.hypot(prev[0] - other[0], prev[1] - other[1])
      const d1 = Math.hypot(e.clientX - other[0], e.clientY - other[1])
      moved = true
      if (d0 > 0) zoomAt((e.clientX + other[0]) / 2, (e.clientY + other[1]) / 2, d1 / d0)
    }
    pointers.set(e.pointerId, [e.clientX, e.clientY])
  }
  function up(e) {
    if (pointers.delete(e.pointerId) && !pointers.size) commit()
  }
  function wheel(e) {
    e.preventDefault()
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015))
    clearTimeout(wheelT)
    wheelT = setTimeout(commit, 150)
  }
  function zoomBtn(f) {
    zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, f)
    commit()
  }

  // --- tap feedback: ripple at the point, bounce the shape, info bubble for non-MRT points ---
  let burst = $state(null) // {x, y, k}
  let info = $state(null) // {x, y, title, sub, code?}
  let nk = 0
  const lineName = Object.fromEntries(LINES.map((l) => [l.id, l.name]))
  function tap(e, x, y, bubble) {
    e.stopPropagation()
    if (moved) return
    burst = { x, y, k: ++nk }
    // Stops with a detail panel open it straight away, like MRT stations; the rest get a bubble.
    if (bubble?.stop) (select(null), (sel.stop = bubble.stop), (bubble = null))
    info = bubble ? { x, y, k: nk, ...bubble } : null
    if (!reduced)
      e.currentTarget.querySelector('.bounce')?.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(0.92)' }, { transform: 'scale(1)' }],
        { duration: 450, easing: 'ease-out' },
      )
  }
  // --- vehicle info (tap a train/bus sprite) ---
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`
  function mrtInfo(tr) {
    const next = data.stations.find((s) => s.code === tr.to)
    return { title: `MRT → ${tr.dir === 'toBHI' ? 'Bundaran HI' : 'Lebak Bulus'}`, sub: `Berikutnya: ${next.name} · tiba ±${hhmm(tr.eta)}` }
  }
  // Stops drawn on a segment, as lengths along its path (sampled once, on first tap).
  const along = new Map()
  function stopsAlong(i) {
    if (along.has(i)) return along.get(i)
    const el = railEls[i], { ln, bus } = SEGS[i], pts = []
    for (let l = 0; l <= el.getTotalLength(); l += 2) pts.push([l, el.getPointAtLength(l)])
    const cand = bus ? ln.halte.filter((h) => h[0]).map(([name, x, y]) => ({ name, x, y })) : STATIONS
    const out = []
    for (const c of cand) {
      const [l, p] = pts.reduce((a, b) => (Math.hypot(b[1].x - c.x, b[1].y - c.y) < Math.hypot(a[1].x - c.x, a[1].y - c.y) ? b : a))
      if (Math.hypot(p.x - c.x, p.y - c.y) < 8 && !out.some((o) => o.name === c.name)) out.push({ name: c.name, l })
    }
    along.set(i, out.sort((a, b) => a.l - b.l))
    return along.get(i)
  }
  function vehInfo(tr) {
    const { ln, bus } = SEGS[tr.seg], el = railEls[tr.seg], st = stopsAlong(tr.seg)
    const tip = el.getPointAtLength(tr.dir > 0 ? el.getTotalLength() : 0)
    const end = ln.ends?.find((e) => Math.hypot(e.x - tip.x, e.y - tip.y) < 45)
    const dest = end ? end.t.replace(/[↑↓←→]/g, '').trim() : (tr.dir > 0 ? st.at(-1) : st[0])?.name ?? ln.name
    const next = tr.dir > 0 ? st.find((s) => s.l > tr.l + 3) : st.findLast((s) => s.l < tr.l - 3)
    return {
      title: `${bus ? `TJ ${ln.id}` : ln.name} → ${dest}`,
      sub: `${next ? `Berikutnya: ${next.name} · ` : ''}${bus && tjHead(ln.id) ? `tiap ±${Math.round(tjHead(ln.id))} mnt · ` : ''}posisi simulasi`,
    }
  }
  const keyTap = (fn) => (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fn(e))
  // Prefer MRT (it opens the station panel); fall back to KRL/LRT when no MRT station is near on the schematic.
  function nearest(x, y) {
    const near = (list) => list.reduce((a, b) => (Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a))
    const mrt = near(stations.map(({ s, x, y }) => ({ name: s.name, code: s.code, x, y, line: 'MRT' })))
    if (Math.hypot(mrt.x - x, mrt.y - y) < 220) return mrt
    return near(STATIONS.map((st) => ({ name: st.name, x: st.x, y: st.y, line: lineName[st.line ?? st.term] ?? 'KRL/LRT' })))
  }
  function landmarkInfo(lm) {
    const mrt = data.stations.find((x) => x.code === lm.near)
    const other = STATIONS.find((x) => x.name === lm.near)
    const n = mrt ? { name: mrt.name, code: mrt.code, line: 'MRT' }
      : other ? { name: other.name, line: lineName[other.line ?? other.term] ?? 'KRL/LRT' }
      : lm.near ? { name: lm.near } : nearest(lm.x, lm.y)
    if (!n.line) return { title: lm.name, sub: `Akses: ${n.name}` }
    return { title: lm.name, sub: `Stasiun terdekat: ${n.name} (${n.line})`, code: n.code }
  }
  // The real stop (net.stops item) drawn at schematic point (x, y), for the bubble's "open" action.
  const realStop = (x, y) => net.stops.find((s) => { const d = drawnStop(s); return d && d.x === x && d.y === y })
  const otherInfo = (st) => ({
    stop: realStop(st.x, st.y),
    title: st.name,
    sub: st.pill ? (st.term ? `Terminus ${lineName[st.term]}` : 'Stasiun transit antarmoda') : `Stasiun ${lineName[st.line]}`,
  })

  function pick(code) {
    if (!moved) select(code)
  }
  function key(e, code) {
    if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), select(code))
  }

  // Desktop: shift the initial fit right so the station list (≈330px) doesn't cover the line.
  $effect(() => {
    if (svg && matchMedia('(min-width: 768px)').matches) untrack(() => (vb = { ...vb, x: vb.x - 330 / scale() / 2 }))
  })

  // Pan so schematic point (x, y) sits beside / above the panel.
  function centreOn(x, y) {
    const desktop = matchMedia('(min-width: 768px)').matches
    const tx = desktop ? 390 + (innerWidth - 390) / 2 : innerWidth / 2
    const ty = desktop ? innerHeight / 2 : innerHeight * 0.21
    const [ux, uy] = toUnits(tx, ty)
    vb = { ...vb, x: vb.x + x - ux, y: vb.y + y - uy }
  }
  // Keep the selected station visible.
  $effect(() => {
    const st = stations.find((x) => x.s.code === sel.station)
    if (st && svg) untrack(() => centreOn(st.x, st.y))
  })

  // GPS (issue #2). Nearest stop of any mode (OSM coords) → its drawn station/halte by name;
  // MRT (or no drawn match) → snap onto the MRT track between stations.
  // ponytail: off-MRT the dot sits on the nearest drawn station, not between stations; interpolate along that line if it matters.
  // A stop picked in search: pan to it and show its bubble.
  // ponytail: "fresh" = picked < 3 s ago, so remounting the view doesn't re-pan to an old pick.
  const KIND = { krl: 'Stasiun KRL', lrt: 'Stasiun LRT', tj: 'Halte Transjakarta' }
  $effect(() => {
    const f = sel.focus
    if (!f || Date.now() - f.k > 3000 || !svg) return
    untrack(() => {
      const a = drawnStop(f)
      if (!a) return
      centreOn(a.x, a.y)
      burst = { x: a.x, y: a.y, k: ++nk }
      info = { x: a.x, y: a.y, k: nk, title: f.name, sub: [KIND[f.mode], f.sub].filter(Boolean).join(' · ') }
    })
  })
  let me = $derived.by(() => {
    if (!sel.me || !track) return null
    const near = nearestStop(data.stations, net.stops, sel.me)
    const a = near.mode !== 'mrt' && drawnStop(near)
    if (a) return { x: a.x, y: a.y, far: near.dist > 1500 }
    const loc = locateOnLine(data.stations, sel.me)
    const p = meas.getPointAtLength(track.at[loc.from] + (track.at[loc.to] - track.at[loc.from]) * loc.t)
    return { x: p.x, y: p.y, far: loc.off > 1500 }
  })
  let centred = false
  $effect(() => {
    if (!me) return void (centred = false)
    if (!centred) (centred = true), untrack(() => centreOn(me.x, me.y))
  })
</script>

<!-- Top-down vehicle sprites, front facing +x. Trains: rounded nose, cab glass, car joints. Bus: boxy, windscreen, roof AC, mirrors. -->
{#snippet vehicle(kind, color)}
  {#if kind === 'bus'}
    <rect class="body" x="-7" y="-3.8" width="14" height="7.6" rx="1.8" style:fill={color} />
    <rect class="glass" x="4.3" y="-2.9" width="1.9" height="5.8" rx="0.6" />
    <rect class="roof" x="-4" y="-2" width="5.5" height="4" rx="0.8" />
    <path class="mirror" d="M6,-3.8 l1.4,-1 M6,3.8 l1.4,1" />
  {:else}
    {@const h = kind === 'lrt' ? 16 : kind === 'krl' ? 26 : 24}
    {@const n = Math.round(h / 8)}
    <path class="body" d="M{-h / 2},-3.8 H{h / 2 - 4} Q{h / 2},-3.8 {h / 2},0 Q{h / 2},3.8 {h / 2 - 4},3.8 H{-h / 2} Z" style:fill={color} />
    <path class="glass" d="M{h / 2 - 3.4},-2.6 Q{h / 2 - 0.9},-2.1 {h / 2 - 0.9},0 Q{h / 2 - 0.9},2.1 {h / 2 - 3.4},2.6 Z" />
    {#each { length: n - 1 }, i}<line class="joint" x1={-h / 2 + ((i + 1) * h) / n} y1="-3.8" x2={-h / 2 + ((i + 1) * h) / n} y2="3.8" />{/each}
  {/if}
{/snippet}

<svelte:window onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={(e) => e.key === 'Escape' && (info = null)} />

<div class="wrap">
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (background tap closes the bubble; Escape is the keyboard path) -->
  <svg
    bind:this={svg}
    viewBox="{vb.x} {vb.y} {vb.w} {vb.h}"
    role="img"
    aria-label="Peta skematik {data.line.name} dan moda terintegrasi"
    onpointerdown={down}
    onclick={() => !moved && (info = null)}
    onwheel={wheel}
  >
    <defs>
      <clipPath id="sheet-clip"><rect x={SHEET.x} y={SHEET.y} width={SHEET.w} height={SHEET.h} rx="22" /></clipPath>
    </defs>

    <!-- flat offset shadow: an SVG blur filter re-rasterizes on every frame in Safari -->
    <rect x={SHEET.x} y={SHEET.y + 8} width={SHEET.w} height={SHEET.h} rx="22" class="sheet-shadow" />
    <rect x={SHEET.x} y={SHEET.y} width={SHEET.w} height={SHEET.h} rx="22" class="sheet" />
    <g clip-path="url(#sheet-clip)">
      <g class="grid">
        {#each COLS.slice(1) as x}<line x1={x} x2={x} y1={SHEET.y + 80} y2={SHEET.y + SHEET.h} />{/each}
        {#each ROWS.slice(1) as y}<line y1={y} y2={y} x1={SHEET.x} x2={SHEET.x + SHEET.w} />{/each}
      </g>
      {#each COLS as x, i}<text class="ref" x={x + GRID / 2} y={SHEET.y + 100}>{i + 1}</text>{/each}
      {#each ROWS as y, i}<text class="ref" x={SHEET.x + 14} y={y + GRID / 2 + 4}>{String.fromCharCode(65 + i)}</text>{/each}

      <rect x={SHEET.x} y={SHEET.y} width={SHEET.w} height="80" class="band" />
      <rect x={SHEET.x} y={SHEET.y + 80} width={SHEET.w} height="5" style:fill={data.line.color} />
      <text class="title" x={SHEET.x + 34} y={SHEET.y + 46}>Peta Integrasi Transportasi</text>
      <text class="subtitle" x={SHEET.x + 34} y={SHEET.y + 68}>Sekitar MRT Jakarta {data.line.name} · KRL · LRT · Transjakarta</text>
      <text class="subtitle" x={SHEET.x + SHEET.w - 34} y={SHEET.y + 46} text-anchor="end">Skema, tidak berskala</text>
    </g>

    {#each RIVERS as rv}
      <path d={rv.d} class="river" />
      <text class="river-name" transform="translate({rv.label[0]},{rv.label[1]}) rotate(-90)">{rv.name}</text>
    {/each}
    {#each AREAS as [name, x, y]}<text class="area" {x} {y}>{name}</text>{/each}
    <g class="compass" transform="translate(1200,858)" aria-hidden="true">
      <circle r="22" />
      <path d="M0,-17 L6,2 L0,-2 L-6,2 Z" class="needle" />
      <path d="M0,17 L6,2 L0,6 L-6,2 Z" />
      <text y="-27">U</text>
    </g>
    {#each LANDMARKS as lm}
      {@const go = (e) => tap(e, lm.x, lm.y - lm.s * 0.2, landmarkInfo(lm))}
      <g class="tap" role="button" tabindex="0" aria-label={lm.name} onclick={go} onkeydown={keyTap(go)}>
        {#if sprites[lm.model]}<image class="lm bounce" style:animation-delay="{LANDMARKS.indexOf(lm) * 60}ms" href={sprites[lm.model]} x={lm.x - lm.s / 2} y={lm.y - lm.s / 2} width={lm.s} height={lm.s} />{/if}
        <text class="lmname" x={lm.x} y={lm.y + lm.s / 2 + 4}>{lm.name}</text>
      </g>
    {/each}
    {#each DISTRICTS as [name, x, y]}<text class="district" {x} {y}>{name}</text>{/each}

    {#each LINKS as [x1, y1, x2, y2]}<line {x1} {y1} {x2} {y2} class="link" class:dim={sel.mode !== null} />{/each}

    <!-- Transjakarta: thin, under the rail lines -->
    {#each BRT as c (c.id)}
      <path d={c.d} class="brt-casing" class:dim={dim('tj')} pathLength="1" />
      <path d={c.d} class="brt" class:dim={dim('tj')} pathLength="1" style:stroke={c.color} />
      {#each c.ends as e}<text class="end" class:dim={dim('tj')} x={e.x} y={e.y} text-anchor={e.a}>{e.t}</text>{/each}
    {/each}

    {#each LINES as ln (ln.id)}
      <path d={ln.d} class="casing thin" class:dim={dim(LINE_MODE[ln.id])} pathLength="1" />
      <path d={ln.d} class="line" class:dim={dim(LINE_MODE[ln.id])} pathLength="1" style:stroke={ln.color} />
      {#each ln.ends as e}<text class="end" class:dim={dim(LINE_MODE[ln.id])} x={e.x} y={e.y} text-anchor={e.a}>{e.t}</text>{/each}
    {/each}

    {#each BRT as c (c.id)}
      {#each c.halte as [name, x, y, flag]}
        {@const [lx, ly, a] = BL[BRT_SIDE[c.id]](x, y)}
        {@const go = (e) => tap(e, x, y, { stop: name && realStop(x, y), title: name || 'Halte Transjakarta', sub: `Halte Transjakarta · Koridor ${c.id} (${c.name})` })}
        <g class="tap" class:dim={dim('tj')} role="button" tabindex="-1" aria-label="Halte {name}" onclick={go} onkeydown={keyTap(go)}>
          <circle cx={x} cy={y} r="11" class="hit" />
          <circle cx={x} cy={y} r={flag === 'term' ? 5.5 : 3.8} class="halte bounce" class:term={flag === 'term'} style:stroke={c.color} />
        </g>
        {#if name}<text x={flag === 'term' && a === 'start' ? lx + 2 : lx} y={ly} text-anchor={a} class="hname" class:dim={dim('tj')} class:strong={flag === 'term'}>{name}</text>{/if}
      {/each}
      {@const [bx, by] = BADGE[c.id]}
      <g class="badge" class:dim={dim('tj')} transform="translate({bx},{by})">
        <rect x={c.id.length > 1 ? -13 : -10} y="-8" width={c.id.length > 1 ? 26 : 20} height="16" rx="4" style:fill={c.color} />
        <text y="4.5">{c.id}</text>
      </g>
    {/each}
    {#each BRT_HUBS as [name, x, y, side]}
      {@const [lx, ly, a] = BL[side](x, y)}
      {@const go = (e) => tap(e, x, y, { stop: realStop(x, y), title: name || 'Dukuh Atas (Galunggung)', sub: 'Halte transit antarkoridor Transjakarta' })}
      <g class="tap" class:dim={dim('tj')} role="button" tabindex="-1" aria-label="Halte {name}" onclick={go} onkeydown={keyTap(go)}>
        <circle cx={x} cy={y} r="11" class="hit" />
        <circle cx={x} cy={y} r="5.5" class="hub bounce" />
      </g>
      {#if name}<text x={side === 'l' ? lx - 2 : side === 'r' ? lx + 2 : lx} y={side === 't' ? ly - 2 : side === 'b' ? ly + 2 : ly} text-anchor={a} class="hname strong" class:dim={dim('tj')}>{name}</text>{/if}
    {/each}

    {#each STATIONS as st}
      {@const [lx, ly, anchor] = LABEL[st.side](st)}
      {@const go = (e) => tap(e, st.x, st.y, otherInfo(st))}
      <g class="other tap" class:dim={dim(st.mode)} role="button" tabindex="-1" aria-label="Stasiun {st.name}" onclick={go} onkeydown={keyTap(go)}>
        <circle cx={st.x} cy={st.y} r="13" class="hit" />
        <g class="bounce">
        {#if st.pill}
          <line x1={st.pill[0]} y1={st.pill[1]} x2={st.pill[2]} y2={st.pill[3]} class="pill-o" style:stroke={st.term ? color[st.term] : null} />
          <line x1={st.pill[0]} y1={st.pill[1]} x2={st.pill[2]} y2={st.pill[3]} class="pill-i" />
        {:else}
          {@const [tx, ty] = st.tick ?? TICK[st.side]}
          <line x1={st.x} y1={st.y} x2={st.x + tx * 9} y2={st.y + ty * 9} class="tick" style:stroke={color[st.line]} />
        {/if}
        </g>
        <text x={lx} y={ly} text-anchor={anchor} class="oname" class:big={st.big}>{st.name}</text>
      </g>
    {/each}

    <path d={TRACK} class="casing" class:dim={dim('mrt')} pathLength="1" />
    <path d={TRACK} class="track" class:dim={dim('mrt')} pathLength="1" style:stroke={data.line.color} />
    <path d={TRACK} class="meas" bind:this={meas} />
    {#each SEGS as sg, i (sg.key)}<path d={sg.d} class="meas" bind:this={railEls[i]} />{/each}
    {#each rail.filter((t) => show[t.mode]) as tr (tr.id)}
      {@const go = (e) => tap(e, tr.x, tr.y, vehInfo(tr))}
      <g class="train rail tap" class:still={reduced} class:dim={dim(tr.mode)} style:transform="translate({tr.x}px,{tr.y}px) rotate({tr.a}deg)" role="button" tabindex="-1" aria-label={tr.bus ? 'Bus Transjakarta' : 'Kereta'} onclick={go} onkeydown={keyTap(go)}>
        <circle r="11" class="hit" />
        {@render vehicle(tr.bus ? 'bus' : tr.mode, tr.color)}
      </g>
    {/each}
    {#each show.mrt ? trains : [] as tr (tr.id)}
      {@const go = (e) => tap(e, tr.x, tr.y, mrtInfo(tr))}
      <g class="train tap" class:still={reduced} class:dep={tr.dep} class:dim={dim('mrt')} style:transform="translate({tr.x}px,{tr.y}px) rotate({tr.a}deg)" role="button" tabindex="-1" aria-label="Kereta MRT" onclick={go} onkeydown={keyTap(go)}>
        <circle r="13" class="hit" />
        {#if tr.dep}<rect class="trail" x="-38" y="-2.5" width="24" height="5" rx="2.5" />{/if}
        {@render vehicle('mrt', 'var(--navy)')}
      </g>
    {/each}

    {#each stations as { s, x, y, t, terminus, ring } (s.code)}
      {@const on = sel.station === s.code}
      {@const below = t === S}
      <g
        class="st"
        class:on
        class:dim={dim('mrt')}
        role="button"
        tabindex="0"
        aria-label="Stasiun {s.name}"
        aria-pressed={on}
        onclick={(e) => (tap(e, x, y), pick(s.code))}
        onkeydown={(e) => key(e, s.code)}
      >
        <circle cx={x} cy={y} r="22" class="hit" />
        {#if on}<circle cx={x} cy={y} r="16" class="pulse" /><circle cx={x} cy={y} r="16" class="halo" />{/if}
        {#if ring}
          <circle cx={x} cy={y} r={terminus ? 9 : 7.5} class="ring bounce" class:terminus style:stroke={terminus ? data.line.color : null} />
        {:else}
          <line x1={x} y1={y} x2={x + t.x * 10} y2={y + t.y * 10} class="tick" style:stroke={data.line.color} />
        {/if}
        {#if below}
          <!-- FDTJ-style two-line terminal labels: name, then sponsor suffix -->
          <text x={x} y={y + 26} text-anchor="middle" class="name">{s.name}</text>
          <text x={x} y={y + 41} text-anchor="middle" class="name sub">{s.fullName.slice(s.name.length).trim()}</text>
        {:else}
          <text x={x + t.x * 16} y={y + t.y * 16 + 5} text-anchor="end" class="name">{s.fullName}</text>
        {/if}
      </g>
    {/each}

    {#each show.mrt ? departs : [] as d (d.id)}
      <circle cx={d.x} cy={d.y} r="8" class="dep-ring" class:dim={dim('mrt')} />
    {/each}

    {#if me}
      <g class="me" class:far={me.far} transform="translate({me.x},{me.y})" role="img" aria-label="Lokasi Anda (perkiraan)">
        <circle r="10" class="me-halo" />
        <circle r="7" class="me-dot" />
      </g>
    {/if}

    <g class="legend" transform="translate(290,700)">
      <text class="lg-title" y="0">Legenda</text>
      <text class="lg-head" y="26">Kereta</text>
      {#each [{ name: `MRT ${data.line.name}`, color: data.line.color }, ...LINES] as ln, i}
        <line x1="0" x2="30" y1={44 + i * 18} y2={44 + i * 18} class="lg-line" style:stroke={ln.color} />
        <text x="40" y={48 + i * 18}>{ln.name}</text>
      {/each}
      <g transform="translate(205,0)">
        <text class="lg-head" y="26">Transjakarta</text>
        {#each BRT as c, i}
          <g class="badge" transform="translate(12,{44 + i * 18})">
            <rect x={c.id.length > 1 ? -13 : -10} y="-8" width={c.id.length > 1 ? 26 : 20} height="16" rx="4" style:fill={c.color} />
            <text y="4.5">{c.id}</text>
          </g>
          <text x="34" y={48 + i * 18}>{c.name}</text>
        {/each}
        <g transform="translate(0,{44 + BRT.length * 18 + 14})">
          <circle cx="12" cy="0" r="7.5" class="ring" /><text x="34" y="4">Stasiun integrasi</text>
          <circle cx="12" cy="18" r="3.8" class="halte" style:stroke="#4a5160" /><text x="34" y="22">Halte BRT</text>
          <line x1="5" y1="36" x2="19" y2="36" class="link" /><text x="34" y="40">Transfer jalan kaki</text>
          <g class="train still" transform="translate(6,54)">{@render vehicle('lrt', 'var(--navy)')}</g>
          <g class="train still" transform="translate(24,54)">{@render vehicle('bus', '#1f5fbf')}</g>
          <text x="38" y="58">Kereta/bus (MRT dari jadwal · lainnya simulasi)</text>
        </g>
      </g>
    </g>
    {#if burst && !reduced}{#key burst.k}<circle class="burst" cx={burst.x} cy={burst.y} r="12" />{/key}{/if}
    {#if info}
      {@const w = Math.max(info.title.length * 7.6, info.sub.length * 5.4, 110) + 26}
      {@const h = info.code || info.stop ? 58 : 44}
      {@const open = (e) => (e.stopPropagation(), info.code ? select(info.code) : info.stop && openStop(info.stop), (info = null))}
      <g transform="translate({info.x},{info.y - 12})">
        {#key info.k}
          <g class="bubble" role="button" tabindex="0" aria-label="{info.title}. {info.sub}" onclick={open} onkeydown={keyTap(open)}>
            <path d="M-7,-9 L0,0 L7,-9 Z" />
            <rect x={-w / 2} y={-8 - h} width={w} height={h} rx="10" />
            <text class="b-title" y={-h + 11}>{info.title}</text>
            <text class="b-sub" y={-h + 27}>{info.sub}</text>
            {#if info.code || info.stop}<text class="b-cta" y={-h + 43}>{info.stop?.mode === 'tj' ? 'Buka halte ›' : 'Buka stasiun ›'}</text>{/if}
          </g>
        {/key}
      </g>
    {/if}
    <text class="foot" x={SHEET.x + SHEET.w - 30} y={SHEET.y + SHEET.h - 22} text-anchor="end">
      Disusun Peron dari data OSM, MRT Jakarta, dan urutan halte FDTJ 2026-08c. Bukan peta resmi.
    </text>
  </svg>

  <div class="zoom">
    <button onclick={() => zoomBtn(1.5)} aria-label="Perbesar">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
    </button>
    <button onclick={() => zoomBtn(1 / 1.5)} aria-label="Perkecil">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" /></svg>
    </button>
    <button onclick={() => (vb = { ...FULL })} aria-label="Tampilkan seluruh peta">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 3H3v5M12 3h5v5M8 17H3v-5M12 17h5v-5" /></svg>
    </button>
  </div>

  <details class="veh">
    <summary aria-label="Tampilkan kendaraan">
      <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="3" width="12" height="12" rx="3" /><path d="M4 10h12M7 18l1.5-3M13 18l-1.5-3" /><circle cx="7.5" cy="12.5" r=".6" /><circle cx="12.5" cy="12.5" r=".6" /></svg>
    </summary>
    <div class="veh-panel">
      <p>Kendaraan</p>
      <label class="all"><input type="checkbox" checked={allShown} indeterminate={!allShown && VEH.some(([m]) => show[m])} onchange={(e) => VEH.forEach(([m]) => (show[m] = e.currentTarget.checked))} /> Semua</label>
      {#each VEH as [m, label]}
        <label><input type="checkbox" bind:checked={show[m]} /> {label}</label>
      {/each}
    </div>
  </details>
</div>

<style>
  .wrap { position: fixed; inset: 0; z-index: 1; background: #e6eaf0; }
  svg {
    width: 100%; height: 100%; display: block; touch-action: none; user-select: none; cursor: grab;
    font-family: 'PT Sans Narrow', 'Arial Narrow', sans-serif;
    transform-origin: 0 0; will-change: transform;
  }
  svg:active { cursor: grabbing; }
  .sheet { fill: #fff; }
  .sheet-shadow { fill: rgb(11 31 58 / 0.07); }
  .band { fill: var(--navy); }
  .title { fill: #fff; font-size: 30px; font-weight: 700; letter-spacing: -0.01em; }
  .subtitle { fill: #c6d0e0; font-size: 15px; }
  .grid line { stroke: #e7eaef; stroke-width: 1; stroke-dasharray: 4 5; }
  .ref { fill: #9aa3b2; font-size: 13px; font-weight: 700; text-anchor: middle; }
  .lmname { fill: #4f6a3a; font-size: 11px; font-style: italic; font-weight: 700; text-anchor: middle; paint-order: stroke; stroke: #fff; stroke-width: 3px; stroke-linejoin: round; }
  /* entrance: lines draw in, then stations/labels fade up, landmarks pop */
  .line, .casing, .track, .brt, .brt-casing { animation: draw 1.1s cubic-bezier(0.3, 0.7, 0.2, 1) backwards; }
  .track, .casing:not(.thin) { animation-duration: 1.4s; }
  .brt, .brt-casing { animation-delay: 0.25s; }
  @keyframes draw { from { stroke-dasharray: 1 1; stroke-dashoffset: 1; } to { stroke-dasharray: 1 1; stroke-dashoffset: 0; } }
  .st, .other, .halte, .hub, .hname, .badge, .end, .lmname { animation: fade 0.5s 0.8s ease-out backwards; }
  @keyframes fade { from { opacity: 0; } }
  .lm { transform-box: fill-box; transform-origin: 50% 80%; animation: pop 0.6s 0.9s cubic-bezier(0.2, 0.9, 0.3, 1.35) backwards; }
  @keyframes pop { from { opacity: 0; transform: translateY(14px) scale(0.6); } }
  .meas { fill: none; stroke: none; }
  .train { transition: transform 2s linear; }
  .train.still { transition: none; }
  .train.dep { transition-timing-function: cubic-bezier(0.5, 0, 0.9, 0.6); } /* pulls away: slow start */
  .train.dep .body { animation: dep-flash 1.2s ease-out; }
  .trail { fill: var(--navy); transform-box: fill-box; transform-origin: center; animation: trail 1.6s ease-out forwards; }
  @keyframes trail { 0% { opacity: 0; transform: scaleX(0.2); } 25% { opacity: 0.45; } 100% { opacity: 0; transform: scaleX(1.2); } }
  @keyframes dep-flash { 0%, 40% { fill: #e2231a; } 100% { fill: var(--navy); } }
  .dep-ring { fill: none; stroke: #e2231a; stroke-width: 2.5; transform-box: fill-box; transform-origin: center; animation: dep-ring 1.6s ease-out forwards; pointer-events: none; }
  @keyframes dep-ring { from { transform: scale(1); opacity: 0.9; } to { transform: scale(3.4); opacity: 0; } }
  .train .body { stroke: #fff; stroke-width: 1.4; stroke-linejoin: round; }
  .train .glass { fill: #cde7ff; }
  .train .roof { fill: rgb(255 255 255 / 0.55); }
  .train .joint { stroke: rgb(255 255 255 / 0.75); stroke-width: 0.9; }
  .train .mirror { stroke: #0b1f3a; stroke-width: 1; stroke-linecap: round; }
  .pulse { fill: var(--yellow); transform-box: fill-box; transform-origin: center; animation: pulse 1.4s ease-out 3; opacity: 0; }
  @keyframes pulse { from { opacity: 0.7; transform: scale(1); } to { opacity: 0; transform: scale(2.2); } }
  @media (prefers-reduced-motion: reduce) {
    .line, .casing, .track, .brt, .brt-casing, .st, .other, .halte, .hub, .hname, .badge, .end, .lmname, .lm, .pulse, .bubble, .me-halo { animation: none; }
  }
  .dim { opacity: 0.12; }
  svg :is(path, line, text, g) { transition: opacity 0.25s; }
  .me-dot { fill: #2563eb; stroke: #fff; stroke-width: 3; }
  .me.far .me-dot { fill: #8aa6d8; }
  .me-halo { fill: rgb(37 99 235 / 0.25); transform-box: fill-box; transform-origin: center; animation: me 2s ease-out infinite; }
  @keyframes me { from { transform: scale(1); opacity: 1; } to { transform: scale(3); opacity: 0; } }
  .river { fill: none; stroke: #cfe7f3; stroke-width: 10; stroke-linecap: round; }
  .river-name { fill: #6aa9c8; font-size: 11px; font-style: italic; letter-spacing: 0.08em; text-anchor: middle; }
  .area { fill: #a3abb8; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; text-anchor: middle; }
  .compass circle { fill: #fff; stroke: #d5dae3; stroke-width: 1.5; }
  .compass path { fill: #c3c9d4; }
  .compass .needle { fill: var(--navy); }
  .compass text { fill: var(--navy); font-size: 12px; font-weight: 700; text-anchor: middle; }
  .district { font-style: italic; font-size: 22px; fill: #aab2bf; text-anchor: middle; }
  .casing { fill: none; stroke: #fff; stroke-width: 14; stroke-linejoin: round; stroke-linecap: round; }
  .track { fill: none; stroke-width: 9; stroke-linejoin: round; stroke-linecap: round; }
  .tick { stroke-width: 4; }
  .casing.thin { stroke-width: 9; }
  .line { fill: none; stroke-width: 5; stroke-linejoin: round; stroke-linecap: round; }
  .brt-casing { fill: none; stroke: #fff; stroke-width: 6.5; stroke-linejoin: round; stroke-linecap: round; }
  .brt { fill: none; stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
  .halte { fill: #fff; stroke-width: 1.8; }
  .halte.term { stroke-width: 2.6; }
  .hub { fill: #fff; stroke: #1b1b1b; stroke-width: 2.4; }
  .hname { font-size: 11px; fill: #4a5160; paint-order: stroke; stroke: #fff; stroke-width: 3px; stroke-linejoin: round; }
  .hname.strong { font-weight: 700; fill: #2b2f36; }
  .badge text { fill: #fff; font-size: 11px; font-weight: 700; text-anchor: middle; }
  .link { stroke: #c9ced8; stroke-width: 9; stroke-linecap: round; }
  .pill-o { stroke: #1b1b1b; stroke-width: 15; stroke-linecap: round; }
  .pill-i { stroke: #fff; stroke-width: 9; stroke-linecap: round; }
  .tap { cursor: pointer; outline: none; }
  .tap .hit { fill: transparent; }
  .tap:focus-visible .hit { stroke: #2563eb; stroke-width: 2; }
  .bounce { transform-box: fill-box; transform-origin: center; }
  .lm.bounce { transform-origin: 50% 80%; }
  .burst { fill: none; stroke: var(--navy); stroke-width: 2.5; pointer-events: none; transform-box: fill-box; transform-origin: center; animation: burst 0.6s ease-out forwards; }
  @keyframes burst { from { opacity: 0.8; transform: scale(0.4); } to { opacity: 0; transform: scale(2.6); } }
  .bubble { cursor: pointer; outline: none; transform-box: fill-box; transform-origin: 50% 100%; animation: bubble 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.3); }
  @keyframes bubble { from { opacity: 0; transform: translateY(6px) scale(0.7); } }
  .bubble rect, .bubble path { fill: var(--navy); }
  .bubble:focus-visible rect { stroke: var(--yellow); stroke-width: 2; }
  .b-title { fill: #fff; font-size: 13px; font-weight: 700; text-anchor: middle; }
  .b-sub { fill: #c6d0e0; font-size: 11px; text-anchor: middle; }
  .b-cta { fill: var(--yellow); font-size: 11px; font-weight: 700; text-anchor: middle; }
  .oname { font-size: 13px; fill: #2b2f36; paint-order: stroke; stroke: #fff; stroke-width: 3px; stroke-linejoin: round; }
  .oname.big { font-size: 16px; font-weight: 700; }
  .end { font-size: 11px; font-style: italic; fill: #6b7383; }
  .ring { fill: #fff; stroke: #1b1b1b; stroke-width: 3; }
  .ring.terminus { stroke-width: 4; }
  .st { cursor: pointer; outline: none; }
  .hit { fill: transparent; }
  .halo { fill: var(--yellow); }
  .name { font-size: 15px; font-weight: 700; fill: #1b1b1b; paint-order: stroke; stroke: #fff; stroke-width: 4px; stroke-linejoin: round; }
  .name.sub { font-size: 12px; font-weight: 400; }
  .st.on .name { fill: var(--navy); text-decoration: underline; text-underline-offset: 3px; }
  .st:focus-visible .hit { stroke: #2563eb; stroke-width: 3; }
  .legend text { font-size: 12.5px; fill: #3b4352; }
  .legend .lg-title { font-size: 18px; font-weight: 700; fill: var(--navy); }
  .legend .lg-head { font-size: 12px; font-weight: 700; fill: #6b7383; letter-spacing: 0.06em; text-transform: uppercase; }
  .legend .badge text { fill: #fff; font-size: 11px; }
  .lg-line { stroke-width: 6; stroke-linecap: round; }
  .foot { font-size: 11px; fill: #8a93a3; }
  .veh { position: fixed; z-index: 1; right: calc(12px + env(safe-area-inset-right)); top: calc(150px + env(safe-area-inset-top)); }
  .veh summary {
    display: grid; place-items: center; width: 42px; height: 42px; list-style: none; cursor: pointer; color: var(--navy);
    background: #fff; border-radius: 12px; box-shadow: 0 4px 14px rgb(11 31 58 / 0.16);
  }
  .veh summary::-webkit-details-marker { display: none; }
  .veh[open] summary { background: var(--navy); color: #fff; }
  .veh summary svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .veh-panel {
    position: absolute; right: 0; top: 50px; width: 200px; padding: 10px 12px; background: #fff; border-radius: 12px;
    box-shadow: 0 4px 14px rgb(11 31 58 / 0.16); color: var(--navy); font-size: 14px;
  }
  .veh-panel p { margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #55627a; }
  .veh-panel label { display: flex; align-items: center; gap: 8px; min-height: 32px; cursor: pointer; }
  .veh-panel .all { font-weight: 700; border-bottom: 1px solid #e3e7ee; margin-bottom: 2px; }
  .veh-panel input { width: 18px; height: 18px; accent-color: var(--navy); }
  .zoom {
    position: fixed; z-index: 1; right: calc(12px + env(safe-area-inset-right)); top: calc(12px + env(safe-area-inset-top));
    display: flex; flex-direction: column; background: #fff; border-radius: 12px; overflow: hidden;
    box-shadow: 0 4px 14px rgb(11 31 58 / 0.16);
  }
  .zoom button { display: grid; place-items: center; width: 42px; height: 42px; border: 0; background: #fff; color: var(--navy); cursor: pointer; }
  .zoom button:hover { background: #f1f4f8; }
  .zoom button + button { border-top: 1px solid #e3e7ee; }
  .zoom svg { width: 20px; height: 20px; cursor: inherit; touch-action: auto; }
  .zoom path { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
</style>
