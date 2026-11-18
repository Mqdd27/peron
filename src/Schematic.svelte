<script>
  // Own-drawn schematic in the style of the FDTJ integration map (octilinear, rounded bends,
  // narrow labels, ticks + interchange rings). Not a copy of the FDTJ artwork.
  import { untrack } from 'svelte'
  import { sel, select } from './lib/state.svelte.js'
  import { LINES, STATIONS, LINKS, DISTRICTS, BRT, BRT_HUBS, LANDMARKS, RIVERS, AREAS } from './lib/network.js'

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

  // Keep the selected station visible beside / above the panel.
  $effect(() => {
    const st = stations.find((x) => x.s.code === sel.station)
    if (!st || !svg) return
    const desktop = matchMedia('(min-width: 768px)').matches
    const tx = desktop ? 390 + (innerWidth - 390) / 2 : innerWidth / 2
    const ty = desktop ? innerHeight / 2 : innerHeight * 0.21
    untrack(() => {
      const [ux, uy] = toUnits(tx, ty)
      vb = { ...vb, x: vb.x + st.x - ux, y: vb.y + st.y - uy }
    })
  })
</script>

<svelte:window onpointermove={move} onpointerup={up} onpointercancel={up} />

<div class="wrap">
  <svg
    bind:this={svg}
    viewBox="{vb.x} {vb.y} {vb.w} {vb.h}"
    role="img"
    aria-label="Peta skematik {data.line.name} dan moda terintegrasi"
    onpointerdown={down}
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
      {#if sprites[lm.model]}<image href={sprites[lm.model]} x={lm.x - lm.s / 2} y={lm.y - lm.s / 2} width={lm.s} height={lm.s} />{/if}
      <text class="lmname" x={lm.x} y={lm.y + lm.s / 2 + 4}>{lm.name}</text>
    {/each}
    {#each DISTRICTS as [name, x, y]}<text class="district" {x} {y}>{name}</text>{/each}

    {#each LINKS as [x1, y1, x2, y2]}<line {x1} {y1} {x2} {y2} class="link" />{/each}

    <!-- Transjakarta: thin, under the rail lines -->
    {#each BRT as c (c.id)}
      <path d={c.d} class="brt-casing" />
      <path d={c.d} class="brt" style:stroke={c.color} />
      {#each c.ends as e}<text class="end" x={e.x} y={e.y} text-anchor={e.a}>{e.t}</text>{/each}
    {/each}

    {#each LINES as ln (ln.id)}
      <path d={ln.d} class="casing thin" />
      <path d={ln.d} class="line" style:stroke={ln.color} />
      {#each ln.ends as e}<text class="end" x={e.x} y={e.y} text-anchor={e.a}>{e.t}</text>{/each}
    {/each}

    {#each BRT as c (c.id)}
      {#each c.halte as [name, x, y, flag]}
        {@const [lx, ly, a] = BL[BRT_SIDE[c.id]](x, y)}
        <circle cx={x} cy={y} r={flag === 'term' ? 5.5 : 3.8} class="halte" class:term={flag === 'term'} style:stroke={c.color} />
        {#if name}<text x={flag === 'term' && a === 'start' ? lx + 2 : lx} y={ly} text-anchor={a} class="hname" class:strong={flag === 'term'}>{name}</text>{/if}
      {/each}
      {@const [bx, by] = BADGE[c.id]}
      <g class="badge" transform="translate({bx},{by})">
        <rect x={c.id.length > 1 ? -13 : -10} y="-8" width={c.id.length > 1 ? 26 : 20} height="16" rx="4" style:fill={c.color} />
        <text y="4.5">{c.id}</text>
      </g>
    {/each}
    {#each BRT_HUBS as [name, x, y, side]}
      {@const [lx, ly, a] = BL[side](x, y)}
      <circle cx={x} cy={y} r="5.5" class="hub" />
      {#if name}<text x={side === 'l' ? lx - 2 : side === 'r' ? lx + 2 : lx} y={side === 't' ? ly - 2 : side === 'b' ? ly + 2 : ly} text-anchor={a} class="hname strong">{name}</text>{/if}
    {/each}

    {#each STATIONS as st}
      {@const [lx, ly, anchor] = LABEL[st.side](st)}
      <g class="other">
        {#if st.pill}
          <line x1={st.pill[0]} y1={st.pill[1]} x2={st.pill[2]} y2={st.pill[3]} class="pill-o" style:stroke={st.term ? color[st.term] : null} />
          <line x1={st.pill[0]} y1={st.pill[1]} x2={st.pill[2]} y2={st.pill[3]} class="pill-i" />
        {:else}
          {@const [tx, ty] = st.tick ?? TICK[st.side]}
          <line x1={st.x} y1={st.y} x2={st.x + tx * 9} y2={st.y + ty * 9} class="tick" style:stroke={color[st.line]} />
        {/if}
        <text x={lx} y={ly} text-anchor={anchor} class="oname" class:big={st.big}>{st.name}</text>
      </g>
    {/each}

    <path d={TRACK} class="casing" />
    <path d={TRACK} class="track" style:stroke={data.line.color} />

    {#each stations as { s, x, y, t, terminus, ring } (s.code)}
      {@const on = sel.station === s.code}
      {@const below = t === S}
      <g
        class="st"
        class:on
        role="button"
        tabindex="0"
        aria-label="Stasiun {s.name}"
        aria-pressed={on}
        onclick={() => pick(s.code)}
        onkeydown={(e) => key(e, s.code)}
      >
        <circle cx={x} cy={y} r="22" class="hit" />
        {#if on}<circle cx={x} cy={y} r="16" class="halo" />{/if}
        {#if ring}
          <circle cx={x} cy={y} r={terminus ? 9 : 7.5} class="ring" class:terminus style:stroke={terminus ? data.line.color : null} />
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
        </g>
      </g>
    </g>
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
  .other { pointer-events: none; }
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
