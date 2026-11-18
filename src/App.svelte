<script>
  import Map from './Map.svelte'
  import StationPanel from './StationPanel.svelte'
  import Schematic from './Schematic.svelte'
  import { sel, select } from './lib/state.svelte.js'

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
</script>

<svelte:window onhashchange={readHash} />

{#if error}
  <p class="msg">Gagal memuat data ({error}). Coba muat ulang.</p>
{:else if data}
  <Map {data} hidden={view === 'skema'} />
  {#if view === 'skema'}<Schematic {data} />{/if}
  <div class="seg" role="group" aria-label="Tampilan">
    <button aria-pressed={view === 'skema'} onclick={() => (view = 'skema')}>Skema</button>
    <button aria-pressed={view === 'peta'} onclick={() => (view = 'peta')}>Peta</button>
  </div>
  {#if station}
    <StationPanel {data} {station} />
  {:else}
    <nav class="list" aria-label="Daftar stasiun">
      <h1>Peron <span>MRT Jakarta · {data.line.name}</span></h1>
      <ul>
        {#each [...data.stations].reverse() as s (s.code)}
          <li>
            <button onclick={() => select(s.code)}>
              <span class="dot" class:elevated={s.elevated}></span>
              <span class="name">{s.name}</span>
              <span class="code">{s.code}</span>
            </button>
          </li>
        {/each}
      </ul>
    </nav>
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
  .msg { position: fixed; inset: 0; display: grid; place-items: center; margin: 0; color: var(--navy); }
  .list {
    position: fixed; z-index: 2; left: 0; right: 0; bottom: 0;
    padding: 10px 0 calc(12px + env(safe-area-inset-bottom));
    background: linear-gradient(transparent, rgb(255 255 255 / 0.9) 30%);
  }
  h1 { font-size: 15px; margin: 0 16px 8px; color: var(--navy); }
  h1 span { font-weight: 400; color: #55627a; font-size: 13px; }
  ul { list-style: none; margin: 0; padding: 0 16px; display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
  li { flex: none; }
  button {
    display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 14px;
    border: 1px solid #d5dae3; border-radius: 999px; background: #fff; color: var(--navy);
    font: inherit; font-size: 14px; cursor: pointer; box-shadow: 0 2px 8px rgb(11 31 58 / 0.1);
  }
  .dot { width: 12px; height: 12px; border-radius: 50%; border: 3px solid var(--navy); flex: none; }
  .dot.elevated { border-color: var(--red); }
  .code { font-size: 11px; color: #7a8599; font-weight: 700; }
  @media (min-width: 768px) {
    .list {
      left: 16px; right: auto; bottom: 16px; width: 300px; max-height: calc(100dvh - 32px);
      display: flex; flex-direction: column; padding: 14px 0 10px;
      background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgb(11 31 58 / 0.18);
    }
    ul { flex-direction: column; overflow-y: auto; gap: 2px; padding: 0 8px; }
    button { width: 100%; border: 0; box-shadow: none; border-radius: 10px; }
    button:hover { background: #f4f6f9; }
    .name { flex: 1; text-align: left; }
  }
</style>
