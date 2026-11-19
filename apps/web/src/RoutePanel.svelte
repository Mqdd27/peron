<script>
  // "Dari → Ke" route planner. Search runs locally (lib/route.js), so it works offline and needs no key.
  import { fly } from 'svelte/transition'
  import { sel, select, openStop, net, schematic, lineTitle, tjHead } from './lib/state.svelte.js'
  import { buildGraph, findRoute, placeNodes, legStripes } from './lib/route.js'
  import { LANDMARKS } from './lib/network.js'
  import { nextDepartures } from './lib/time.js'
  import { haversine } from './lib/geo.js'

  /** @type {{ data: any }} */
  let { data } = $props()
  const sch = schematic()
  const g = buildGraph(sch)
  const places = [...new Set([...sch.nodes.map((n) => n.name), ...LANDMARKS.map((l) => l.name)])].sort((a, b) => a.localeCompare(b))
  const KIND = { mrt: 'MRT', krl: 'KRL', lrt: 'LRT', tj: 'Transjakarta' }

  let from = $state(sel.route?.from ?? '')
  let to = $state(sel.route?.to ?? '')
  let error = $state('')
  let collapsed = $state(false)
  const result = $derived(sel.route?.result)
  // Rides, with every change between them folded into one highlighted "Pindah" step (incl. any walk).
  const steps = $derived.by(() => {
    if (!result) return []
    const out = []
    let walk = null
    for (const l of result.legs) {
      if (l.type === 'walk') { walk = walk ? { ...walk, to: l.to, m: walk.m + l.m } : { from: l.from, to: l.to, m: l.m }; continue }
      const prev = out.findLast((x) => x.type === 'ride')
      if (prev) out.push({ type: 'xfer', at: prev.leg.to, to: walk?.to ?? l.from, m: walk?.m ?? 0, line: g.line.get(l.line), color: l.color })
      else if (walk) out.push({ type: 'walk', ...walk })
      out.push({ type: 'ride', leg: l })
      walk = null
    }
    if (walk) out.push({ type: 'walk', ...walk })
    return out
  })
  const xfers = $derived(steps.filter((x) => x.type === 'xfer'))
  const rides = $derived(steps.filter((x) => x.type === 'ride').map((x) => x.leg))
  // Feeder services (angkot, Metromini, non-BRT Transjakarta…) at an MRT station, from mrt.json.
  function feeders(id) {
    const st = id.startsWith('mrt:') && data.stations.find((x) => `mrt:${x.code}` === id)
    return st ? Object.entries(st.integration ?? {}).map(([op, r]) => `${op} ${r.join(', ')}`).join(' · ') : ''
  }
  // Ride-hailing estimate, like Google Maps' "ojek online" option: road ≈ 1.35× straight line at ~20 km/h
  // plus ~5 min pickup. ponytail: no traffic or price data; only shown when it clearly beats transit.
  function ojolMinutes(f, t) {
    const a = ll(f[0]), b = ll(t[0])
    return a && b ? Math.round(5 + ((haversine({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] }) / 1000) * 1.35 * 60) / 20) : null
  }
  const ojol = $derived(sel.route?.ojol)

  function go(e) {
    e?.preventDefault()
    const f = placeNodes(g, from, LANDMARKS), t = placeNodes(g, to, LANDMARKS)
    error = !f.length ? `"${from}" tidak ditemukan. Pilih dari daftar.` : !t.length ? `"${to}" tidak ditemukan. Pilih dari daftar.` : ''
    const r = error ? null : findRoute(g, f, t)
    if (!error && !r) error = 'Rute tidak ditemukan di jaringan yang tersedia.'
    if (r && !r.legs.length) error = 'Asal dan tujuan ada di stasiun yang sama.'
    if (r) {
      const rides = r.legs.filter((l) => l.type === 'ride'), st = legStripes(rides.map((l) => g.line.get(l.line).color))
      rides.forEach((l, i) => ((l.color = g.line.get(l.line).color), (l.stripe = st[i]))) // stripe tells same-coloured legs apart on Skema and Peta
    }
    const oj = f.length && t.length && r?.legs.length !== 0 ? ojolMinutes(f, t) : null
    sel.route = { from, to, ojol: oj && (!r || r.minutes - oj >= 15 || r.minutes >= 2 * oj) ? oj : null, result: r?.legs.length ? { ...r, lines: [...new Set(r.legs.filter((l) => l.type === 'ride').map((l) => l.line))], geo: geo(r.legs) } : null }
  }
  // Real-world coordinates for Peta: each leg as [lon, lat] through its stops.
  function ll(id) {
    const n = g.node.get(id)
    const s = n.mode === 'mrt' ? data.stations.find((x) => `mrt:${x.code}` === id) : net.stops.find((x) => x.mode === n.mode && x.name === n.name)
    return s && [s.lon, s.lat]
  }
  const geo = (legs) => legs.map((l) => ({ walk: l.type === 'walk', color: l.type === 'ride' ? l.color : '#55627a', stripe: !!l.stripe, coords: (l.type === 'ride' ? l.stops : [l.from, l.to]).map(ll).filter(Boolean), line: l.line }))
  const swap = () => ([from, to] = [to, from])

  const name = (id) => g.node.get(id).name
  function open(id) {
    const n = g.node.get(id)
    if (n.mode === 'mrt') return select(id.slice(4))
    const s = net.stops.find((x) => x.mode === n.mode && x.name === n.name)
    if (s) openStop(s)
  }
  // MRT: next trains from the boarding station in the travel direction.
  function mrtNext(leg) {
    const st = data.stations.find((s) => `mrt:${s.code}` === leg.from)
    const table = leg.toward.startsWith('Lebak') ? st?.timetable.toLBB : st?.timetable.toBHI
    return nextDepartures(table, new Date(), 3)
  }
</script>

<section class="panel" class:collapsed aria-label="Rute" in:fly={matchMedia('(prefers-reduced-motion: reduce)').matches ? { duration: 0 } : matchMedia('(min-width: 768px)').matches ? { x: -40, duration: 260 } : { y: 60, duration: 260 }}>
  <header>
    <button class="grab" onclick={() => (collapsed = !collapsed)} aria-label={collapsed ? 'Perbesar panel' : 'Perkecil panel'} aria-expanded={!collapsed}></button>
    <h1>Rute</h1>
    <button class="close" onclick={() => (sel.route = null)} aria-label="Tutup">✕</button>
  </header>

  <form onsubmit={go}>
    <label><span>Dari</span><input list="places" bind:value={from} placeholder="Stasiun, halte, atau tempat" autocomplete="off" required /></label>
    <label><span>Ke</span><input list="places" bind:value={to} placeholder="Stasiun, halte, atau tempat" autocomplete="off" required /></label>
    <datalist id="places">{#each places as p}<option value={p}></option>{/each}</datalist>
    <div class="acts">
      <button type="button" class="ghost" onclick={swap} aria-label="Tukar asal dan tujuan">⇅ Tukar</button>
      <button type="submit" class="primary">Cari rute</button>
    </div>
  </form>

  <div class="body">
    {#if error}<p class="err" role="status">{error}</p>{/if}
    {#if ojol}
      <p class="ojol"><b>{result ? `Ojek online bisa lebih cepat: ±${ojol} mnt` : `Coba ojek online: ±${ojol} mnt`}</b><br />Pesan lewat Gojek, Grab, atau Maxim. Perkiraan tanpa macet.</p>
    {/if}
    {#if result}
      <p class="total"><b>±{result.minutes} menit</b> · {xfers.length ? `${xfers.length}× pindah` : 'tanpa pindah'}</p>
      {#if xfers.length}
        <p class="xsum">Pindah di {#each xfers as x, i}{i ? ', ' : ''}<b>{name(x.at)}{x.to !== x.at && name(x.to) !== name(x.at) ? ` → ${name(x.to)}` : ''}</b>{/each}</p>
      {/if}
      <ol class="legs">
        {#each steps as st, i (i)}
          {#if st.type === 'xfer'}
            <li class="xfer">
              <p class="head"><span class="xi" aria-hidden="true">⇄</span> Pindah di <button class="stop" onclick={() => open(st.at)}>{name(st.at)}</button></p>
              <p class="sub">
                {#if st.m >= 40}Jalan kaki ±{st.m} m (±{Math.max(1, Math.round(st.m / 75))} mnt) ke <button class="stop" onclick={() => open(st.to)}>{name(st.to)}</button>, lalu{/if}
                ganti ke <span class="pill" class:round={st.line.mode !== 'tj'} style:background={st.color}>{st.line.id}</span> {KIND[st.line.mode]}
              </p>
            </li>
          {:else if st.type === 'ride'}
            {@const leg = st.leg}
            {@const ln = g.line.get(leg.line)}
            <li class="ride" style:--c={leg.color}>
              <p class="head"><span class="pill" class:round={ln.mode !== 'tj'} style:background={leg.color}>{ln.id}</span> Naik {KIND[ln.mode]} arah <b>{leg.toward}</b></p>
              <p class="sub">{lineTitle(ln)}</p>
              <p><button class="stop" onclick={() => open(leg.from)}>{name(leg.from)}</button> → <button class="stop" onclick={() => open(leg.to)}>{name(leg.to)}</button> · {leg.stops.length - 1} {ln.mode === 'tj' ? 'halte' : 'stasiun'}</p>
              {#if leg === rides[0] && feeders(leg.from)}<p class="sub">Armada lain di {name(leg.from)}: {feeders(leg.from)}</p>{/if}
              {#if leg === rides.at(-1) && feeders(leg.to)}<p class="sub">Armada lain di {name(leg.to)}: {feeders(leg.to)}</p>{/if}
              {#if ln.mode === 'mrt'}
                {@const next = mrtNext(leg)}
                <p class="sub">{next.length ? `Berikutnya: ${next.map((n) => n.time).join(', ')}` : 'Sudah tidak beroperasi hari ini'}</p>
              {:else if ln.mode === 'tj' && tjHead(ln.id)}
                <p class="sub">Sekarang tiap ±{Math.max(1, Math.round(tjHead(ln.id)))} mnt</p>
              {/if}
            </li>
          {:else}
            <li class="walk">
              <p class="head">Jalan kaki ke <button class="stop" onclick={() => open(st.to)}>{name(st.to)}</button></p>
              <p class="sub">±{st.m} m · ±{Math.max(1, Math.round(st.m / 75))} mnt</p>
            </li>
          {/if}
        {/each}
      </ol>
      <p class="muted">Waktu tempuh perkiraan dari jumlah stasiun dan interval rata-rata, bukan jadwal resmi. Jadwal MRT dari situs MRT Jakarta (tidak resmi).</p>
    {:else if !error}
      <p class="muted">Ketik atau pilih stasiun, halte, atau tempat (mis. Gelora Bung Karno). Rute mencakup MRT, KRL, LRT, dan Transjakarta.</p>
    {/if}
  </div>
</section>

<style>
  /* ponytail: shell styles mirror LinePanel/StopPanel; extract a shared panel component when they next change together */
  .panel {
    position: fixed; z-index: 2; background: #fff; color: var(--navy); display: flex; flex-direction: column;
    box-shadow: 0 -4px 24px rgb(11 31 58 / 0.18); left: 0; right: 0; bottom: 0; height: 64dvh;
    border-radius: 16px 16px 0 0; transition: height 0.2s;
  }
  .panel.collapsed { height: calc(96px + env(safe-area-inset-bottom)); }
  @media (min-width: 768px) {
    .panel { top: 0; right: auto; width: 390px; height: 100dvh; border-radius: 0; box-shadow: 4px 0 24px rgb(11 31 58 / 0.18); }
    .panel.collapsed { height: 100dvh; }
    .grab { display: none; }
  }
  header { position: relative; padding: 18px 12px 6px 16px; padding-top: max(18px, env(safe-area-inset-top)); display: flex; align-items: center; }
  @media (max-width: 767px) { header { padding-top: 18px; } }
  .grab { position: absolute; top: 0; left: 50%; translate: -50% 0; width: 80px; height: 18px; border: 0; background: none; cursor: pointer; }
  .grab::after { content: ''; display: block; margin: 6px auto 0; width: 40px; height: 5px; border-radius: 3px; background: #c9cfd9; }
  h1 { font-size: 20px; margin: 0; flex: 1; }
  .close { min-width: 40px; height: 40px; border-radius: 10px; border: 1px solid #d5dae3; background: #fff; font-size: 18px; color: var(--navy); cursor: pointer; }
  form { display: grid; gap: 8px; padding: 6px 16px 12px; border-bottom: 1px solid #e6e9ef; }
  label { display: grid; grid-template-columns: 40px 1fr; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #55627a; }
  input { min-height: 42px; padding: 0 12px; border: 1px solid #d5dae3; border-radius: 10px; font: inherit; font-size: 16px; color: var(--navy); background: #fff; min-width: 0; }
  input:focus-visible { outline: 2px solid var(--navy); outline-offset: 1px; }
  .acts { display: flex; gap: 8px; justify-content: flex-end; }
  .acts button { min-height: 40px; padding: 0 14px; border-radius: 10px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
  .ghost { border: 1px solid #d5dae3; background: #fff; color: var(--navy); }
  .primary { border: 0; background: var(--navy); color: #fff; }
  .body { overflow-y: auto; padding: 8px 16px calc(16px + env(safe-area-inset-bottom)); flex: 1; overscroll-behavior: contain; }
  .total { font-size: 15px; margin: 6px 0 10px; }
  .err { color: #b42318; font-size: 14px; }
  .ojol { margin: 0 0 12px; padding: 8px 10px; border-radius: 10px; background: #e7f6ec; color: #1d4d2e; font-size: 13px; }
  .ojol b { color: #0f5132; }
  .legs { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .legs li { padding: 8px 0 8px 14px; border-left: 4px solid var(--c, transparent); }
  .legs li.walk { border-left: 4px dotted #9aa5b8; }
  .legs li.xfer { margin: 2px 0; padding: 8px 10px; border: 0; border-radius: 10px; background: #fff3d1; }
  .xfer .head { font-weight: 700; }
  .xfer .sub { color: #5c4a12; }
  .xfer .pill { vertical-align: 1px; }
  .xi { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: #f5b400; color: var(--navy); font-size: 12px; }
  .xsum { margin: -4px 0 12px; padding: 8px 10px; border-radius: 10px; background: #fff3d1; font-size: 13px; color: #5c4a12; }
  .xsum b { color: var(--navy); }
  .legs p { margin: 0; font-size: 14px; line-height: 1.45; }
  .head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .sub { color: #55627a; font-size: 12px !important; }
  .pill { display: inline-grid; place-items: center; min-width: 24px; height: 20px; padding: 0 4px; border-radius: 4px; color: #fff; font-size: 11px; font-weight: 800; }
  .pill.round { border-radius: 10px; }
  .stop { border: 0; background: none; padding: 0; font: inherit; font-weight: 700; color: var(--navy); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
  .muted { color: #55627a; font-size: 12px; margin: 12px 0; }
</style>
