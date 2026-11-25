<script>
  // Current weather + 12 h forecast around the open station/halte (issue #7). Failures stay inside this box.
  import { getWeather } from './lib/weather.js'

  /** @type {{ lat: number, lon: number }} */
  let { lat, lon } = $props()
  let w = $state(null), err = $state(null), loading = $state(false)

  $effect(() => {
    const la = lat, lo = lon
    let live = true
    loading = true, err = null
    getWeather(la, lo)
      .then((r) => live && (w = r))
      .catch((e) => live && ((err = e.message), (w = null)))
      .finally(() => live && (loading = false))
    return () => (live = false)
  })

  const hhmm = (t) => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
  const MSG = { offline: 'Sedang offline — cuaca tidak bisa dimuat.', nocoord: 'Koordinat lokasi ini tidak tersedia.' }
</script>

<h2>Cuaca sekitar</h2>
<div class="wx" aria-live="polite">
  {#if w}
    <div class="now">
      <span class="icon" aria-hidden="true">{w.current.icon}</span>
      <div>
        <p class="temp">{Math.round(w.current.temp)}°C <span class="label">{w.current.label}</span></p>
        <p class="meta">Terasa {Math.round(w.current.feels)}°C · Lembap {w.current.humidity}% · Angin {Math.round(w.current.wind)} km/j</p>
      </div>
    </div>
    <ol class="hours" aria-label="Prakiraan 12 jam">
      {#each w.hours as h}
        <li><span class="t">{h.time}</span><span aria-label={h.label}>{h.icon}</span><b>{Math.round(h.temp)}°</b><span class="pop" title="Peluang hujan">{h.pop ?? 0}%</span></li>
      {/each}
    </ol>
    <p class="muted">Estimasi model cuaca, bukan sensor di lokasi · diperbarui {hhmm(w.at)} · <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a></p>
  {:else if loading}
    <p class="muted">Memuat cuaca…</p>
  {:else if err}
    <p class="muted">{MSG[err] ?? 'Cuaca gagal dimuat. Coba lagi nanti.'}</p>
  {/if}
</div>

<style>
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #55627a; margin: 18px 0 8px; }
  .wx { display: grid; gap: 8px; }
  .now { display: flex; gap: 10px; align-items: center; }
  .icon { font-size: 32px; line-height: 1; }
  .temp { margin: 0; font-size: 22px; font-weight: 700; color: var(--navy); }
  .label { font-size: 14px; font-weight: 600; color: #3b4352; margin-left: 4px; }
  .meta { margin: 2px 0 0; font-size: 12.5px; color: #55627a; }
  .hours { display: flex; gap: 6px; overflow-x: auto; margin: 0; padding: 0 0 4px; list-style: none; scrollbar-width: thin; }
  .hours li { flex: none; display: grid; justify-items: center; gap: 2px; min-width: 44px; padding: 6px 4px; border-radius: 10px; background: #f1f4f8; font-size: 12px; color: #3b4352; }
  .hours b { color: var(--navy); font-size: 13px; }
  .t { color: #55627a; }
  .pop { color: #1f5fbf; font-size: 11px; }
  .muted { margin: 0; font-size: 12px; color: #6b7588; }
  .muted a { color: inherit; }
</style>
