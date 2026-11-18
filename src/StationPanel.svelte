<script>
  import ExitSchematic from './ExitSchematic.svelte'
  import { sel, select } from './lib/state.svelte.js'
  import { nextDepartures } from './lib/time.js'

  /** @type {{ data: any, station: any }} */
  let { data, station } = $props()

  let now = $state(new Date())
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 20_000)
    return () => clearInterval(t)
  })

  let prev = $derived(data.stations[station.index - 1])
  let next = $derived(data.stations[station.index + 1])
  let exit = $derived(station.exits.find((e) => e.id === sel.exit))
  let collapsed = $state(false)

  let directions = $derived(
    [
      { label: 'Arah Lebak Bulus', table: station.timetable.toLBB },
      { label: 'Arah Bundaran HI', table: station.timetable.toBHI },
    ].filter((d) => d.table.weekday.length || d.table.weekend.length),
  )
  let tj = $derived(station.integration.Transjakarta)
  let others = $derived(Object.entries(station.integration).filter(([op]) => op !== 'Transjakarta'))

  const wheelchair = { yes: 'Akses kursi roda', limited: 'Akses kursi roda terbatas', no: 'Tanpa akses kursi roda' }
  const walkUrl = (e) => `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lon}&travelmode=walking`
</script>

<section class="panel" class:collapsed aria-label="Stasiun {station.name}">
  <header>
    <button class="grab" onclick={() => (collapsed = !collapsed)} aria-label={collapsed ? 'Perbesar panel' : 'Perkecil panel'} aria-expanded={!collapsed}></button>
    <div class="title">
      <span class="code" class:elevated={station.elevated}>{station.code}</span>
      <div>
        <h1>{station.name}</h1>
        <p class="sub">{station.elevated ? 'Stasiun layang' : 'Stasiun bawah tanah'} · {station.fullName}</p>
      </div>
    </div>
    <nav>
      <button disabled={!prev} onclick={() => select(prev.code)} aria-label="Stasiun sebelumnya{prev ? `: ${prev.name}` : ''}">‹</button>
      <button disabled={!next} onclick={() => select(next.code)} aria-label="Stasiun berikutnya{next ? `: ${next.name}` : ''}">›</button>
      <button onclick={() => select(null)} aria-label="Tutup">✕</button>
    </nav>
  </header>

  <div class="body">
    <h2>Kereta berikutnya</h2>
    <div class="deps">
      {#each directions as d}
        {@const list = nextDepartures(d.table, now)}
        <div class="dep">
          <h3>{d.label}</h3>
          {#if list.length}
            <ol>
              {#each list as t}
                <li><b>{t.inMin === 0 ? 'Sekarang' : `${t.inMin} mnt`}</b> <span>{t.time}</span></li>
              {/each}
            </ol>
          {:else}
            <p class="muted">Sudah habis hari ini</p>
          {/if}
        </div>
      {/each}
    </div>

    <h2>Pintu keluar</h2>
    {#if station.exits.length}
      <ExitSchematic {station} {prev} {next} />
    {:else}
      <p class="muted">Belum ada data pintu.</p>
    {/if}

    {#if exit}
      <div class="exit">
        <span class="badge">{exit.ref}</span>
        <div>
          <h3>Pintu {exit.ref}</h3>
          {#if exit.street}<p>{exit.street}</p>{/if}
          {#if exit.leadsTo.length}
            <p class="muted">Menuju:</p>
            <ul>{#each exit.leadsTo as to}<li>{to}</li>{/each}</ul>
          {/if}
          {#if exit.wheelchair && wheelchair[exit.wheelchair]}<p>♿ {wheelchair[exit.wheelchair]}</p>{/if}
          {#if exit.lift}<p>Lift: {exit.lift}</p>{/if}
          {#if exit.escalator}<p>Eskalator: {exit.escalator}</p>{/if}
          {#if exit.notes}<p>{exit.notes}</p>{/if}
          <a href={walkUrl(exit)} target="_blank" rel="noopener">Rute jalan kaki ↗</a>
        </div>
      </div>
    {:else if station.exits.length}
      <p class="muted">Ketuk huruf pintu di skema atau peta.</p>
    {/if}

    {#if station.notes || station.platform}
      <h2>Info</h2>
      {#if station.platform}<p>{station.platform}</p>{/if}
      {#if station.notes}<p>{station.notes}</p>{/if}
    {/if}

    {#if tj?.length || others.length}
      <h2>Integrasi moda</h2>
      {#if tj?.length}
        <p><b>Transjakarta:</b> {tj.join(', ')}</p>
      {/if}
      {#if others.length}
        <details>
          <summary>Operator lain ({others.length})</summary>
          {#each others as [op, routes]}<p><b>{op}:</b> {routes.join(', ')}</p>{/each}
        </details>
      {/if}
    {/if}

    {#if station.description}<p class="muted addr">{station.description}</p>{/if}

    <footer>
      Peta © <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, data ©
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL). Jadwal dari
      MRT Jakarta (tidak resmi, bisa berubah).
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
  .code.elevated { border-color: var(--red); }
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
  .dep ol { list-style: none; margin: 0; padding: 0; }
  .dep li { display: flex; justify-content: space-between; padding: 3px 0; font-variant-numeric: tabular-nums; }
  .dep li span { color: #55627a; }
  .muted { color: #55627a; font-size: 13px; margin: 6px 0; }
  .exit { display: flex; gap: 12px; margin-top: 12px; padding: 12px; border-radius: 12px; border: 2px solid var(--yellow); }
  .exit p { margin: 2px 0; font-size: 14px; }
  .exit ul { margin: 2px 0 6px; padding-left: 18px; font-size: 14px; }
  .exit a { display: inline-block; margin-top: 8px; padding: 9px 12px; border-radius: 10px; background: var(--navy); color: #fff; text-decoration: none; font-weight: 600; font-size: 14px; }
  .badge { flex: none; width: 52px; height: 52px; border-radius: 50%; background: var(--yellow); display: grid; place-items: center; font-size: 28px; font-weight: 800; }
  details summary { cursor: pointer; padding: 8px 0; min-height: 36px; }
  details p, .body > p { font-size: 14px; margin: 4px 0; }
  .addr { margin-top: 16px; }
  footer { margin-top: 20px; font-size: 11px; color: #7a8599; }
  footer a { color: inherit; }
</style>
