<script>
  import { projectToAxis } from './lib/geo.js'
  import { sel, select } from './lib/state.svelte.js'

  /** @type {{ station: any, prev: any, next: any }} */
  let { station, prev, next } = $props()

  const W = 360, H = 210, CX = W / 2, CY = H / 2, BOX_H = 26, PLATFORM_M = 100

  let layout = $derived.by(() => {
    const pos = projectToAxis(station, prev, next, station.exits)
    const maxAlong = Math.max(PLATFORM_M / 2 + 10, ...pos.map((p) => Math.abs(p.along)))
    const maxAcross = Math.max(30, ...pos.map((p) => Math.abs(p.across)))
    const k = Math.min((W / 2 - 24) / maxAlong, (H / 2 - 22) / maxAcross)
    const half = (PLATFORM_M / 2) * k
    const exits = station.exits.map((e, i) => {
      const x = CX + pos[i].along * k
      let y = CY - pos[i].across * k
      // Keep exits off the platform box so the badge never sits on the track.
      if (Math.abs(y - CY) < BOX_H / 2 + 16) y = CY + (y < CY ? -1 : 1) * (BOX_H / 2 + 16)
      const ex = Math.max(CX - half, Math.min(CX + half, x))
      const ey = y < CY ? CY - BOX_H / 2 : CY + BOX_H / 2
      return { e, x, y, ex, ey }
    })
    return { half, exits }
  })

  function key(ev, e) {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      select(station.code, e.id)
    }
  }
</script>

<figure>
  <svg viewBox="0 0 {W} {H}" role="group" aria-label="Skema pintu keluar {station.name}">
    <line x1="8" x2={W - 8} y1={CY} y2={CY} class="rail" />
    <rect x={CX - layout.half} y={CY - BOX_H / 2} width={layout.half * 2} height={BOX_H} rx="5" class="platform" />
    <text x={CX} y={CY + 4} class="plabel">Peron</text>
    <text x="8" y={H - 6} class="dir">← Lebak Bulus</text>
    <text x={W - 8} y={H - 6} class="dir" text-anchor="end">Bundaran HI →</text>
    {#each layout.exits as { e, x, y, ex, ey } (e.id)}
      <line x1={ex} y1={ey} x2={x} y2={y} class="lead" />
      <g
        class="exit"
        class:on={sel.exit === e.id}
        role="button"
        tabindex="0"
        aria-label="Pintu {e.ref}"
        aria-pressed={sel.exit === e.id}
        onclick={() => select(station.code, e.id)}
        onkeydown={(ev) => key(ev, e)}
      >
        <circle cx={x} cy={y} r="18" class="hit" />
        <circle cx={x} cy={y} r="13" />
        <text x={x} y={y + 4.5}>{e.ref}</text>
      </g>
    {/each}
  </svg>
  <figcaption>Skema perkiraan dari koordinat OpenStreetMap, bukan denah resmi.</figcaption>
</figure>

<style>
  figure { margin: 0; }
  svg { width: 100%; height: auto; display: block; background: #f4f6f9; border-radius: 12px; }
  .rail { stroke: var(--red); stroke-width: 3; }
  .platform { fill: #fff; stroke: var(--navy); stroke-width: 1.5; }
  .plabel { font-size: 11px; fill: var(--navy); text-anchor: middle; font-weight: 600; }
  .dir { font-size: 11px; fill: #55627a; }
  .lead { stroke: var(--navy); stroke-width: 1.2; stroke-dasharray: 3 3; opacity: 0.6; }
  .exit { cursor: pointer; outline: none; }
  .exit .hit { fill: transparent; }
  .exit circle:not(.hit) { fill: var(--yellow); stroke: #fff; stroke-width: 1.5; }
  .exit text { font-size: 13px; font-weight: 700; text-anchor: middle; fill: var(--navy); pointer-events: none; }
  .exit.on circle:not(.hit) { stroke: var(--navy); stroke-width: 3; }
  .exit:focus-visible .hit { stroke: #2563eb; stroke-width: 3; }
  figcaption { font-size: 12px; color: #55627a; margin-top: 6px; }
</style>
