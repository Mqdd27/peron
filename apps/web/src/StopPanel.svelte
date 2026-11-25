<script>
  // Detail panel for a KRL / LRT station or Transjakarta halte, shaped like the MRT StationPanel.
  // Only data that is actually published is shown: TJ intervals (GTFS), KRL weekday timetable (Open-KRL GTFS), lines and entrances (OSM).
  import { fly } from 'svelte/transition'
  import Weather from './Weather.svelte'
  import { select, openStop, sel, net, schematic, krlData } from './lib/state.svelte.js'
  import { haversine } from './lib/geo.js'
  import { jakartaNow, nextByDirection } from './lib/time.js'
  import { LINES } from './lib/network.js'

  /** @type {{ data: any, stop: any }} */
  let { data, stop } = $props()
  let collapsed = $state(false)
  let now = $state(new Date())
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 60_000)
    return () => clearInterval(t)
  })

  const KIND = { krl: 'Stasiun KRL', lrt: 'Stasiun LRT', tj: 'Halte Transjakarta' }
  const SHORT = { mrt: 'MRT', krl: 'KRL', lrt: 'LRT', tj: 'TJ' }
  const COLOR = { mrt: '#e2231a', krl: '#3fb6dc', lrt: '#f26522', tj: '#1f5fbf' }
  const lineOf = (ref) =>
    LINES.find((l) => l.id === ref) ?? { name: net.routes.find((r) => r.mode === stop.mode && r.ref === ref)?.name || `Jalur ${ref}`, color: COLOR[stop.mode] }
  let lines = $derived((stop.lines ?? '').split(',').filter(Boolean).map((ref) => ({ ref, ...lineOf(ref) })))
  let corridors = $derived.by(() => {
    const t = jakartaNow(now), day = t.weekend ? 'we' : 'wd', h = Math.floor(t.minutes / 60) % 24
    return (stop.routes ?? '').split(',').filter(Boolean).map((id) => ({
      id, name: net.tjNames[id] ?? '', color: schematic()?.lines.find((l) => l.mode === 'tj' && l.id === id)?.color ?? COLOR.tj, head: net.tjHeadway?.[id]?.[day]?.[h],
    }))
  })
  const krl = $derived(stop.mode === 'krl' ? krlData() : null)
  // directions with a train in the next 2 h; otherwise just the soonest one (late evening, rare short-turns)
  let trains = $derived.by(() => {
    if (!krl?.stops[stop.name]) return null
    const all = nextByDirection(krl.stops[stop.name], krl.keys, now), soon = all.filter((d) => d.next[0].inMin <= 120)
    return soon.length ? soon : all.slice(0, 1)
  })
  // intercity KAI trains stopping here (OSM, no times): [name, from, to]
  let ka = $derived((stop.ka ?? '').split(',').filter(Boolean).map((i) => net.intercity[i]).filter(Boolean))
  const inText = (m) => (!m ? 'sekarang' : m < 60 ? `${m} mnt` : `${Math.floor(m / 60)} j ${m % 60} mnt`)
  let nearby = $derived(
    [...data.stations.map((s) => ({ mode: 'mrt', name: s.name, code: s.code, lat: s.lat, lon: s.lon })), ...net.stops]
      .filter((s) => !(s.mode === stop.mode && s.name === stop.name))
      .map((s) => ({ s, d: haversine(stop, s) }))
      .filter((x) => x.d < 400)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6),
  )
  const walkUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=walking`
  const open = (s) => (s.code ? select(s.code) : openStop(s))
</script>

<section
  class="panel"
  class:collapsed
  aria-label="{KIND[stop.mode]} {stop.name}"
  in:fly={matchMedia('(prefers-reduced-motion: reduce)').matches ? { duration: 0 } : matchMedia('(min-width: 768px)').matches ? { x: -40, duration: 260 } : { y: 60, duration: 260 }}
>
  <header>
    <button class="grab" onclick={() => (collapsed = !collapsed)} aria-label={collapsed ? 'Perbesar panel' : 'Perkecil panel'} aria-expanded={!collapsed}></button>
    <div class="title">
      <span class="code" style:border-color={COLOR[stop.mode]}>{SHORT[stop.mode]}</span>
      <div>
        <h1>{stop.name}</h1>
        <p class="sub">{KIND[stop.mode]}{stop.mode === 'tj' ? ` · Koridor ${corridors.map((c) => c.id).join(', ')}` : lines.length ? ` · ${lines.map((l) => l.name).join(', ')}` : ''}</p>
      </div>
    </div>
    <nav>
      <button onclick={() => (sel.stop = null)} aria-label="Tutup">✕</button>
    </nav>
  </header>

  <div class="body">
    <Weather lat={stop.lat} lon={stop.lon} />
    {#if stop.mode === 'tj'}
      <h2>Bus</h2>
      <div class="deps">
        {#each corridors as c}
          <div class="dep">
            <h3><span class="pill" style:background={c.color}>{c.id}</span>Koridor {c.id}</h3>
            {#if c.name}<p class="cname">{c.name}</p>{/if}
            <p><b>{c.head ? `Tiap ±${Math.max(1, Math.round(c.head))} mnt` : 'Tidak beroperasi jam ini'}</b></p>
          </div>
        {/each}
      </div>
      <p class="muted">Interval resmi jam ini dari GTFS Transjakarta. Jam kedatangan per bus tidak dipublikasikan.</p>
    {:else}
      {#if trains || !ka.length}<h2>Kereta berikutnya</h2>{/if}
      {#if trains}
        {#if trains.length}
          <div class="deps">
            {#each trains as d (d.ref + d.to)}
              <div class="dep">
                <h3><span class="pill" style:background={lineOf(d.ref).color}>{d.ref}</span>{d.to}</h3>
                <ul class="next">{#each d.next as n}<li><b>{n.time}</b> <span>{inText(n.inMin)}</span></li>{/each}</ul>
              </div>
            {/each}
          </div>
        {:else}<p><b>Sudah tidak ada kereta hari ini</b></p>{/if}
        <p class="muted">Jadwal hari kerja dari GTFS Open-KRL (data KAI Commuter, tidak resmi){jakartaNow(now).weekend ? '; akhir pekan bisa berbeda' : ''}.</p>
      {:else if !ka.length}
        <p class="muted">Jadwal belum tersedia: operator belum membuka data jadwalnya.</p>
      {/if}
      {#if lines.length}
        <h2>Jalur</h2>
        <ul class="lines">
          {#each lines as l}<li><span class="sw" style:background={l.color}></span>{l.name}</li>{/each}
        </ul>
      {/if}
      {#if ka.length}
        <h2>KA antar kota</h2>
        <ul class="ka">
          {#each ka as [name, from, to] (name)}<li><b>{name}</b>{#if from && to}<span>{from === stop.name ? `→ ${to}` : to === stop.name ? `→ ${from}` : `${from} – ${to}`}</span>{/if}</li>{/each}
        </ul>
        <p class="muted">Dari OpenStreetMap, mungkin belum lengkap. Jadwal dan tiket: <a href="https://booking.kai.id/" target="_blank" rel="noopener">Access by KAI ↗</a></p>
      {/if}
    {/if}

    <h2>{stop.mode === 'tj' ? 'Lokasi' : 'Pintu masuk'}</h2>
    {#if stop.exits?.length}
      <ul class="exits">
        {#each stop.exits as e}
          <li>
            <span class="badge sm">{e.ref || '•'}</span>
            <span>{e.name || 'Pintu masuk'}{e.wheelchair === 'yes' ? ' · ♿' : ''}</span>
            <a href={walkUrl(e)} target="_blank" rel="noopener">Rute ↗</a>
          </li>
        {/each}
      </ul>
    {:else}
      {#if stop.mode !== 'tj'}<p class="muted">Belum ada data pintu di OpenStreetMap.</p>{/if}
      <a class="walk" href={walkUrl(stop)} target="_blank" rel="noopener">Rute jalan kaki ke sini ↗</a>
    {/if}

    {#if nearby.length}
      <h2>Transit terdekat</h2>
      <ul class="near">
        {#each nearby as { s, d } (s.mode + s.name)}
          <li>
            <button onclick={() => open(s)}>
              <span class="dot" style:border-color={COLOR[s.mode]}></span>
              <span class="nm">{s.name}</span>
              <span class="meta">{SHORT[s.mode]} · {Math.round(d / 10) * 10} m</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <footer>
      Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL){stop.mode === 'tj' ? '; halte dan interval dari GTFS Transjakarta' : trains ? '; jadwal KRL dari GTFS Open-KRL' : ''}.
    </footer>
  </div>
</section>

<style>
  .panel {
    position: fixed;
    z-index: 2;
    background: #fff;
    color: var(--navy);
    display: flex;
    flex-direction: column;
    box-shadow: 0 -4px 24px rgb(11 31 58 / 0.18);
    left: 0;
    right: 0;
    bottom: 0;
    height: 58dvh;
    border-radius: 16px 16px 0 0;
    transition: height 0.2s;
  }
  .panel.collapsed { height: calc(96px + env(safe-area-inset-bottom)); }
  @media (min-width: 768px) {
    .panel {
      top: 0;
      right: auto;
      width: 390px;
      height: 100dvh;
      border-radius: 0;
      box-shadow: 4px 0 24px rgb(11 31 58 / 0.18);
    }
    .panel.collapsed { height: 100dvh; }
    .grab { display: none; }
  }
  header {
    position: relative;
    padding: 18px 12px 10px 16px;
    padding-top: max(18px, env(safe-area-inset-top));
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid #e6e9ef;
  }
  @media (max-width: 767px) { header { padding-top: 18px; } }
  .grab {
    position: absolute;
    top: 0;
    left: 50%;
    translate: -50% 0;
    width: 80px;
    height: 18px;
    border: 0;
    background: none;
    cursor: pointer;
  }
  .grab::after { content: ''; display: block; margin: 6px auto 0; width: 40px; height: 5px; border-radius: 3px; background: #c9cfd9; }
  .title { display: flex; gap: 10px; align-items: center; flex: 1; min-width: 0; }
  .title > div { min-width: 0; }
  .code { flex: none; font-weight: 800; font-size: 13px; padding: 8px 6px; border-radius: 8px; border: 3px solid var(--navy); }
  h1 { font-size: 20px; margin: 0; line-height: 1.15; }
  .sub { margin: 2px 0 0; font-size: 12px; color: #55627a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  nav { display: flex; gap: 4px; }
  nav button {
    min-width: 40px; height: 40px; border-radius: 10px; border: 1px solid #d5dae3; background: #fff;
    font-size: 18px; color: var(--navy); cursor: pointer;
  }
  nav button:disabled { opacity: 0.35; cursor: default; }
  .body { overflow-y: auto; padding: 4px 16px calc(16px + env(safe-area-inset-bottom)); flex: 1; overscroll-behavior: contain; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #55627a; margin: 18px 0 8px; }
  h3 { font-size: 14px; margin: 0 0 6px; }
  .deps { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .dep { background: #f4f6f9; border-radius: 12px; padding: 10px 12px; }
  .muted { color: #55627a; font-size: 13px; margin: 6px 0; }
  .badge { flex: none; width: 52px; height: 52px; border-radius: 50%; background: var(--yellow); display: grid; place-items: center; font-size: 28px; font-weight: 800; }
  footer { margin-top: 20px; font-size: 11px; color: #7a8599; }
  footer a { color: inherit; }
  .pill { display: inline-grid; place-items: center; min-width: 22px; height: 18px; padding: 0 4px; margin-right: 4px; border-radius: 4px; color: #fff; font-size: 11px; font-weight: 800; }
  .body > p { font-size: 14px; margin: 4px 0; }
  .cname { margin: 0 0 6px; font-size: 13px; color: #55627a; }
  .dep p { margin: 0; font-size: 14px; }
  .next { list-style: none; margin: 0; padding: 0; }
  .next li { display: flex; justify-content: space-between; font-size: 14px; padding: 2px 0; }
  .next span { color: #55627a; font-size: 12px; }
  .lines, .exits, .near { list-style: none; margin: 0; padding: 0; }
  .ka { list-style: none; margin: 0; padding: 0; }
  .ka li { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; font-size: 14px; border-bottom: 1px solid #eef1f5; }
  .ka span { color: #55627a; font-size: 12px; text-align: right; }
  .muted a { color: var(--navy); font-weight: 600; }
  .lines li { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 14px; }
  .sw { width: 22px; height: 6px; border-radius: 3px; flex: none; }
  .exits li { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 14px; }
  .exits li span:nth-child(2) { flex: 1; }
  .exits a, .walk { color: var(--navy); font-weight: 600; font-size: 14px; }
  .walk { display: inline-block; margin-top: 4px; padding: 9px 12px; border-radius: 10px; background: var(--navy); color: #fff; text-decoration: none; }
  .badge.sm { width: 30px; height: 30px; font-size: 15px; }
  .near button {
    display: flex; align-items: center; gap: 10px; width: 100%; min-height: 42px; padding: 6px 4px;
    border: 0; border-radius: 10px; background: none; color: var(--navy); font: inherit; font-size: 14px; text-align: left; cursor: pointer;
  }
  .near button:hover, .near button:focus-visible { background: #f1f4f8; }
  .dot { width: 12px; height: 12px; border-radius: 50%; border: 3px solid; flex: none; }
  .nm { flex: 1; }
  .meta { font-size: 12px; color: #7a8599; font-weight: 600; white-space: nowrap; }
</style>
