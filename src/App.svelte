<script>
  import { fly } from 'svelte/transition'
  import Map from './Map.svelte'
  import StationPanel from './StationPanel.svelte'
  import StopPanel from './StopPanel.svelte'
  import LinePanel from './LinePanel.svelte'
  import Schematic from './Schematic.svelte'
  import { sel, select, openStop, gps, toggleGps, net, drawnStop, schematic } from './lib/state.svelte.js'
  import { nearestStop } from './lib/geo.js'

  let data = $state(null)
  let view = $state('skema')
  let error = $state(null)

  fetch(`${import.meta.env.BASE_URL}data/mrt.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d) => {
      data = d
      readHash()
    })
    .catch((e) => (error = e.message))

  // Deep link: #BLM or #BLM:A
  function readHash() {
    const [code, ref] = decodeURIComponent(location.hash.slice(1)).toUpperCase().split(':')
    const s = data?.stations.find((x) => x.code === code)
    const e = s?.exits.find((x) => x.ref === ref)
    select(s?.code ?? null, e?.id ?? null)
  }
  $effect(() => {
    const h = sel.exit ?? sel.station
    if (!data) return // don't wipe the incoming deep link before readHash() runs
    history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search)
  })

  let station = $derived(data?.stations.find((s) => s.code === sel.station))

  const MODES = [
    { id: null, label: 'Semua' },
    { id: 'mrt', label: 'MRT', color: '#e2231a' },
    { id: 'krl', label: 'KRL', color: '#3fb6dc' },
    { id: 'lrt', label: 'LRT', color: '#f26522' },
    { id: 'tj', label: 'TJ', color: '#1f5fbf' },
  ]
  const MODE_NAME = { mrt: 'MRT', krl: 'KRL', lrt: 'LRT', tj: 'TJ' }
  let near = $derived(sel.me && data ? nearestStop(data.stations, net.stops, sel.me) : null)
  // Station search across every mode; follows the mode chips.
  let finding = $state(false)
  let q = $state('')
  let groups = $derived.by(() => {
    if (!data) return []
    const n = q.trim().toLowerCase()
    const all = [
      ...[...data.stations].reverse().map((s) => ({ mode: 'mrt', name: s.name, code: s.code, sub: s.code, elevated: s.elevated })),
      ...net.stops.map((s) => ({ ...s, sub: s.routes ? `Koridor ${s.routes.replaceAll(',', ', ')}` : '' })),
    ]
    const seen = new Set()
    return MODES.filter((m) => m.id && (sel.mode === null || sel.mode === m.id))
      .map((m) => ({
        ...m,
        items: all
          .filter((s) => s.mode === m.id && (!n || s.name.toLowerCase().includes(n)) && !seen.has(m.id + s.name) && seen.add(m.id + s.name))
          .sort(m.id === 'mrt' ? () => 0 : (a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((g) => g.items.length)
  })
  function pick(s) {
    finding = false
    if (s.code) return select(s.code)
    if (view === 'skema' && !drawnStop(s)) view = 'peta' // not drawn on the schematic → show it on the map
    openStop(net.stops.find((x) => x.mode === s.mode && x.name === s.name) ?? s)
  }
  const dist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`)
</script>

<svelte:window onhashchange={readHash} onkeydown={(e) => e.key === 'Escape' && (finding = false)} />

{#if error}
  <p class="msg">Gagal memuat data ({error}). Coba muat ulang.</p>
{:else if data}
  <Map {data} hidden={view === 'skema'} />
  {#if view === 'skema' && schematic()}<Schematic {data} sch={schematic()} />{/if}
  <div class="seg" role="group" aria-label="Tampilan">
    <button aria-pressed={view === 'skema'} onclick={() => (view = 'skema')}>Skema</button>
    <button aria-pressed={view === 'peta'} onclick={() => (view = 'peta')}>Peta</button>
  </div>
  <div class="bar">
    <div class="modes" role="group" aria-label="Fokus moda">
      {#each MODES as m}
        <button aria-pressed={sel.mode === m.id} onclick={() => (sel.mode = m.id)}>
          {#if m.color}<span class="sw" style:background={m.color}></span>{/if}{m.label}
        </button>
      {/each}
    </div>
    <button class="loc" aria-pressed={gps.on} onclick={toggleGps} aria-label={gps.on ? 'Matikan lokasi saya' : 'Tampilkan lokasi saya'}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.2" /><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" /><circle cx="10" cy="10" r="6.5" class="ring" /></svg>
    </button>
  </div>
  {#if gps.error}
    <p class="gps err" role="status">{gps.error}</p>
  {:else if gps.on}
    <p class="gps" role="status">
      {#if !near}Mencari lokasi…
      {:else}
        Terdekat: <b>{near.name}</b> <span class="md">{MODE_NAME[near.mode]}</span> · {dist(near.dist)}
        {#if near.code}<button onclick={() => select(near.code)}>Buka</button>{/if}
      {/if}
    </p>
  {/if}
  {#if station}
    <StationPanel {data} {station} />
  {:else if sel.stop}
    <StopPanel {data} stop={sel.stop} />
  {:else if sel.line}
    <LinePanel {data} line={sel.line} />
  {:else}
    <button class="find" aria-expanded={finding} onclick={() => (finding = !finding)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="M12.6 12.6 17 17" /></svg>
      Cari stasiun
    </button>
    {#if finding}
      <nav class="list" aria-label="Cari stasiun dan halte" in:fly={{ y: 24, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220 }}>
        <div class="head">
          <input type="search" placeholder="Cari stasiun atau halte…" aria-label="Cari stasiun atau halte" bind:value={q} />
          <button class="x" aria-label="Tutup" onclick={() => (finding = false)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>
          </button>
        </div>
        <div class="groups">
          {#each groups as g (g.id)}
            <h2><span class="sw" style:background={g.color}></span>{g.label}<span class="n">{g.items.length}</span></h2>
            <ul>
              {#each g.items as s (s.mode + s.name)}
                <li>
                  <button onclick={() => pick(s)}>
                    <span class="dot" style:border-color={s.mode === 'mrt' ? (s.elevated ? 'var(--red)' : 'var(--navy)') : g.color}></span>
                    <span class="name">{s.name}</span>
                    {#if s.sub}<span class="code">{s.sub}</span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="empty">Tidak ada stasiun atau halte yang cocok.</p>
          {/each}
        </div>
      </nav>
    {/if}
  {/if}
{:else}
  <p class="msg">Memuat…</p>
{/if}

<style>
  .seg {
    position: fixed; z-index: 3; top: calc(10px + env(safe-area-inset-top)); left: 50%; translate: -50% 0;
    display: flex; padding: 3px; gap: 2px; background: #fff; border-radius: 999px; box-shadow: 0 2px 10px rgb(11 31 58 / 0.18);
  }
  .seg button { min-height: 36px; padding: 0 16px; border: 0; border-radius: 999px; box-shadow: none; background: none; font-weight: 600; }
  .seg button[aria-pressed='true'] { background: var(--navy); color: #fff; }
  @media (min-width: 768px) { .seg { left: calc(50% + 195px); } }
  .bar, .gps {
    position: fixed; z-index: 3; left: 12px; right: 64px; display: flex; gap: 6px; align-items: center;
  }
  .bar { top: calc(60px + env(safe-area-inset-top)); }
  .modes { display: flex; gap: 4px; padding: 3px; background: #fff; border-radius: 999px; box-shadow: 0 2px 10px rgb(11 31 58 / 0.18); overflow-x: auto; scrollbar-width: none; }
  .modes button, .loc { min-height: 32px; padding: 0 11px; gap: 6px; border: 0; border-radius: 999px; box-shadow: none; background: none; font-size: 13px; font-weight: 600; flex: none; }
  .modes button[aria-pressed='true'] { background: var(--navy); color: #fff; }
  .sw { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .loc { width: 38px; height: 38px; padding: 0; justify-content: center; background: #fff; box-shadow: 0 2px 10px rgb(11 31 58 / 0.18); }
  .loc svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
  .loc svg circle:not(.ring) { fill: currentColor; stroke: none; }
  .loc[aria-pressed='true'] { background: #2563eb; color: #fff; }
  .gps {
    top: calc(106px + env(safe-area-inset-top)); right: auto; margin: 0; padding: 6px 6px 6px 14px; max-width: calc(100% - 88px);
    background: #fff; border-radius: 999px; box-shadow: 0 2px 10px rgb(11 31 58 / 0.18); font-size: 13px; color: var(--navy);
  }
  .modes button, .gps button { width: auto; }
  .loc { flex: none; min-width: 38px; }
  .gps { white-space: nowrap; gap: 4px; }
  .md { font-size: 11px; font-weight: 700; color: #55627a; }
  .gps:not(:has(button)) { padding-right: 14px; }
  .gps.err { color: #b42318; padding-right: 14px; }
  .gps button { min-height: 30px; padding: 0 12px; border: 0; box-shadow: none; background: var(--navy); color: #fff; font-size: 13px; font-weight: 600; }
  @media (min-width: 768px) {
    .bar, .gps { left: calc(50% + 195px); right: auto; translate: -50% 0; max-width: none; }
  }
  .msg { position: fixed; inset: 0; display: grid; place-items: center; margin: 0; color: var(--navy); }
  .find {
    position: fixed; z-index: 2; left: 50%; translate: -50% 0; bottom: calc(16px + env(safe-area-inset-bottom));
    min-height: 44px; padding: 0 18px; gap: 8px; border: 0; font-weight: 600; box-shadow: 0 4px 16px rgb(11 31 58 / 0.22);
  }
  .find[aria-expanded='true'] { background: var(--navy); color: #fff; }
  .find svg, .x svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .list {
    position: fixed; z-index: 3; left: 0; right: 0; bottom: 0; max-height: 68dvh;
    display: flex; flex-direction: column; background: #fff; border-radius: 18px 18px 0 0;
    box-shadow: 0 -4px 24px rgb(11 31 58 / 0.18); padding-bottom: env(safe-area-inset-bottom);
  }
  .head { display: flex; gap: 8px; padding: 12px 12px 8px; }
  .head input {
    flex: 1; min-width: 0; min-height: 42px; padding: 0 14px; border: 1px solid #d5dae3; border-radius: 999px;
    font: inherit; font-size: 16px; color: var(--navy); background: #f4f6f9;
  }
  .head input:focus { outline: 2px solid #2563eb; outline-offset: 1px; background: #fff; }
  .x { width: 42px; min-height: 42px; padding: 0; justify-content: center; flex: none; }
  .groups { overflow-y: auto; padding: 0 8px 12px; overscroll-behavior: contain; }
  h2 {
    position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 8px 6px;
    background: #fff; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #55627a;
  }
  h2 .n { margin-left: auto; font-weight: 600; letter-spacing: 0; }
  ul { list-style: none; margin: 0; padding: 0; }
  .list li button {
    display: flex; align-items: center; gap: 10px; width: 100%; min-height: 42px; padding: 6px 8px;
    border: 0; border-radius: 10px; background: none; box-shadow: none; text-align: left;
  }
  .list li button:hover, .list li button:focus-visible { background: #f1f4f8; }
  .empty { margin: 16px 8px; color: #55627a; font-size: 14px; }
  button {
    display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 14px;
    border: 1px solid #d5dae3; border-radius: 999px; background: #fff; color: var(--navy);
    font: inherit; font-size: 14px; cursor: pointer; box-shadow: 0 2px 8px rgb(11 31 58 / 0.1);
  }
  .dot { width: 12px; height: 12px; border-radius: 50%; border: 3px solid var(--navy); flex: none; }
  .name { flex: 1; }
  .code { font-size: 11px; color: #7a8599; font-weight: 700; text-align: right; }
  @media (min-width: 768px) {
    .find { left: 16px; translate: none; bottom: 16px; }
    .list { left: 16px; right: auto; bottom: 72px; width: 340px; max-height: calc(100dvh - 160px); border-radius: 16px; box-shadow: 0 4px 24px rgb(11 31 58 / 0.18); }
  }
</style>
