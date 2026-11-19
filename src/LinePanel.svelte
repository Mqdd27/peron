<script>
  // Side panel for a tapped line (or every line sharing the tapped stretch), next to StopPanel.
  // Schedules shown only where published: MRT timetable, Transjakarta hourly intervals (GTFS).
  import { fly } from 'svelte/transition'
  import { select, openStop, sel, net } from './lib/state.svelte.js'
  import { jakartaNow, nextDepartures } from './lib/time.js'

  /** @type {{ data: any, line: any }} */
  let { data, line } = $props()
  let collapsed = $state(false)
  let now = $state(new Date())
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 30_000)
    return () => clearInterval(t)
  })
  const t = $derived(jakartaNow(now))
  const hour = $derived(Math.floor(t.minutes / 60) % 24)

  // MRT: from each terminus, using the terminus' own timetable.
  const term = (code) => data.stations.find((s) => s.code === code)
  const mrtDirs = $derived([
    { label: 'Arah Bundaran HI', from: term(data.line.termini.south), table: term(data.line.termini.south)?.timetable.toBHI },
    { label: 'Arah Lebak Bulus', from: term(data.line.termini.north), table: term(data.line.termini.north)?.timetable.toLBB },
  ].map((d) => {
    const list = (t.weekend && d.table?.weekend?.length ? d.table.weekend : d.table?.weekday) ?? []
    return { ...d, first: list[0], last: list.at(-1), next: nextDepartures(d.table, now, 4) }
  }))
  // TJ: interval per hour today; hours without service are null.
  const tjHours = (id) => net.tjHeadway?.[id]?.[t.weekend ? 'we' : 'wd'] ?? []
  const span = (hs) => {
    const on = hs.map((h, i) => (h ? i : -1)).filter((i) => i >= 0)
    return on.length === 24 ? '24 jam' : on.length ? `${String(on[0]).padStart(2, '0')}:00–${String(on.at(-1) + 1).padStart(2, '0')}:00` : 'tidak ada data'
  }

  function openNode(s) {
    if (s.mode === 'mrt') return select(s.code)
    const real = net.stops.find((x) => x.mode === s.mode && x.name === s.name)
    if (real) openStop(real)
  }
  let showStops = $state({})
</script>

<section
  class="panel"
  class:collapsed
  aria-label={line.title}
  in:fly={matchMedia('(prefers-reduced-motion: reduce)').matches ? { duration: 0 } : matchMedia('(min-width: 768px)').matches ? { x: -40, duration: 260 } : { y: 60, duration: 260 }}
>
  <header>
    <button class="grab" onclick={() => (collapsed = !collapsed)} aria-label={collapsed ? 'Perbesar panel' : 'Perkecil panel'} aria-expanded={!collapsed}></button>
    <div class="title">
      <span class="code" style:background={line.rows.length === 1 ? line.rows[0].color : 'var(--navy)'}>{line.rows.length === 1 ? line.rows[0].id : line.rows.length}</span>
      <div>
        <h1>{line.title}</h1>
        <p class="sub">{line.rows.length === 1 ? line.rows[0].sub : 'Layanan yang memakai jalur ini'}</p>
      </div>
    </div>
    <nav><button onclick={() => (sel.line = null)} aria-label="Tutup">✕</button></nav>
  </header>

  <div class="body">
    {#each line.rows as r (r.id)}
      <article class="svc">
        {#if line.rows.length > 1}
          <h3><span class="pill" class:round={!r.tj} style:background={r.color}>{r.id}</span>{r.title}</h3>
          <p class="meta">{r.sub}</p>
        {/if}

        <h2>Jadwal {t.weekend ? 'akhir pekan' : 'hari kerja'}</h2>
        {#if r.mode === 'mrt'}
          <div class="deps">
            {#each mrtDirs as d}
              <div class="dep">
                <p class="dir">{d.label}</p>
                <p class="cname">dari {d.from?.name}</p>
                {#if d.next.length}
                  <ul class="next">{#each d.next as n}<li><b>{n.time}</b> <span>{n.inMin ? `${n.inMin} mnt` : 'sekarang'}</span></li>{/each}</ul>
                {:else}<p><b>Sudah tidak beroperasi</b></p>{/if}
                <p class="fl">Pertama {d.first ?? '–'} · Terakhir {d.last ?? '–'}</p>
              </div>
            {/each}
          </div>
          <p class="muted">Jadwal MRT Jakarta (tidak resmi, bisa berubah). Waktu dari stasiun awal.</p>
        {:else if r.tj}
          {@const hs = tjHours(r.id)}
          {#if hs.length}
            <p class="now">Sekarang: <b>{hs[hour] ? `tiap ±${Math.max(1, Math.round(hs[hour]))} mnt` : 'tidak beroperasi'}</b> · operasi {span(hs)}</p>
            <ol class="hours" aria-label="Interval per jam">
              {#each hs as h, i}
                <li class:cur={i === hour} class:off={!h} title="{String(i).padStart(2, '0')}:00 · {h ? `±${Math.round(h)} mnt` : 'tidak beroperasi'}">
                  <span class="hh">{String(i).padStart(2, '0')}</span><span class="hv">{h ? Math.max(1, Math.round(h)) : '–'}</span>
                </li>
              {/each}
            </ol>
            <p class="muted">Interval (menit) per jam dari GTFS Transjakarta. Jam kedatangan per bus tidak dipublikasikan.</p>
          {:else}<p class="muted">Interval belum tersedia untuk koridor ini.</p>{/if}
        {:else}
          <p class="muted">Jadwal belum tersedia: operator belum membuka data jadwalnya. Posisi kereta di peta adalah simulasi.</p>
        {/if}

        <button class="toggle" aria-expanded={!!showStops[r.id]} onclick={() => (showStops[r.id] = !showStops[r.id])}>
          {showStops[r.id] ? 'Sembunyikan' : 'Lihat'} {r.stops.length} {r.tj ? 'halte' : 'stasiun'}
        </button>
        {#if showStops[r.id]}
          <ol class="stops" style:--c={r.color}>
            {#each r.stops as s, i (i)}
              <li><button onclick={() => openNode(s)}>{s.name}</button></li>
            {/each}
          </ol>
        {/if}
      </article>
    {/each}
  </div>
</section>

<style>
  /* ponytail: shell styles mirror StopPanel; extract a shared panel component if a third panel appears */
  .panel {
    position: fixed; z-index: 2; background: #fff; color: var(--navy); display: flex; flex-direction: column;
    box-shadow: 0 -4px 24px rgb(11 31 58 / 0.18); left: 0; right: 0; bottom: 0; height: 58dvh;
    border-radius: 16px 16px 0 0; transition: height 0.2s;
  }
  .panel.collapsed { height: calc(96px + env(safe-area-inset-bottom)); }
  @media (min-width: 768px) {
    .panel { top: 0; right: auto; width: 390px; height: 100dvh; border-radius: 0; box-shadow: 4px 0 24px rgb(11 31 58 / 0.18); }
    .panel.collapsed { height: 100dvh; }
    .grab { display: none; }
  }
  header {
    position: relative; padding: 18px 12px 10px 16px; padding-top: max(18px, env(safe-area-inset-top));
    display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #e6e9ef;
  }
  @media (max-width: 767px) { header { padding-top: 18px; } }
  .grab { position: absolute; top: 0; left: 50%; translate: -50% 0; width: 80px; height: 18px; border: 0; background: none; cursor: pointer; }
  .grab::after { content: ''; display: block; margin: 6px auto 0; width: 40px; height: 5px; border-radius: 3px; background: #c9cfd9; }
  .title { display: flex; gap: 10px; align-items: center; flex: 1; min-width: 0; }
  .title > div { min-width: 0; }
  .code { flex: none; display: grid; place-items: center; min-width: 40px; height: 40px; padding: 0 6px; border-radius: 10px; color: #fff; font-weight: 800; font-size: 15px; }
  h1 { font-size: 20px; margin: 0; line-height: 1.15; }
  .sub { margin: 2px 0 0; font-size: 12px; color: #55627a; }
  nav button { min-width: 40px; height: 40px; border-radius: 10px; border: 1px solid #d5dae3; background: #fff; font-size: 18px; color: var(--navy); cursor: pointer; }
  .body { overflow-y: auto; padding: 4px 16px calc(16px + env(safe-area-inset-bottom)); flex: 1; overscroll-behavior: contain; }
  .svc + .svc { border-top: 1px solid #e6e9ef; margin-top: 16px; padding-top: 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #55627a; margin: 16px 0 8px; }
  h3 { font-size: 16px; margin: 14px 0 2px; display: flex; align-items: center; gap: 6px; }
  .meta { margin: 0; font-size: 12px; color: #55627a; }
  .pill { display: inline-grid; place-items: center; min-width: 24px; height: 20px; padding: 0 4px; border-radius: 4px; color: #fff; font-size: 11px; font-weight: 800; }
  .pill.round { border-radius: 10px; }
  .deps { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .dep { background: #f4f6f9; border-radius: 12px; padding: 10px 12px; }
  .dep p { margin: 0; font-size: 14px; }
  .dir { font-weight: 700; }
  .cname { font-size: 12px !important; color: #55627a; margin-bottom: 6px !important; }
  .next { list-style: none; margin: 0 0 6px; padding: 0; }
  .next li { display: flex; justify-content: space-between; font-size: 14px; padding: 2px 0; }
  .next span { color: #55627a; font-size: 12px; }
  .fl { font-size: 11px !important; color: #7a8599; }
  .now { font-size: 14px; margin: 0 0 8px; }
  .hours { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
  .hours li { display: grid; text-align: center; background: #f4f6f9; border-radius: 6px; padding: 4px 0; }
  .hours li.off { opacity: 0.45; }
  .hours li.cur { background: var(--navy); color: #fff; }
  .hh { font-size: 10px; opacity: 0.7; }
  .hv { font-size: 14px; font-weight: 700; }
  .muted { color: #55627a; font-size: 12px; margin: 8px 0; }
  .toggle { margin-top: 6px; padding: 8px 12px; border-radius: 10px; border: 1px solid #d5dae3; background: #fff; color: var(--navy); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
  .stops { list-style: none; margin: 8px 0 0; padding: 0 0 0 10px; border-left: 4px solid var(--c); }
  .stops button { display: block; width: 100%; text-align: left; padding: 6px 8px; border: 0; border-radius: 8px; background: none; color: var(--navy); font: inherit; font-size: 14px; cursor: pointer; }
  .stops button:hover, .stops button:focus-visible { background: #f1f4f8; }
</style>
