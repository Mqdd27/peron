<script>
  import { untrack } from 'svelte'
  import { personSvg } from './lib/network.js'
  import { followLine } from './lib/route.js'
  import { getWeather } from './lib/weather.js'
  import * as maplibregl from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
  import { sel, select, openStop, openLine, net, netReady, focusIds } from './lib/state.svelte.js'

  maplibregl.setWorkerUrl(workerUrl)

  /** @type {{ data: any, hidden?: boolean }} */
  let { data, hidden = false } = $props()
  let el
  let map = $state(null)
  let netLines = $state.raw(null) // network-lines.json, for snapping routes onto the real lines
  let tjShapes = $state.raw({}) // tj-shapes.json: GTFS road shape of every TJ trip pattern

  const NAVY = '#0b1f3a'
  const YELLOW = '#ffcc00'

  const isDesktop = () => matchMedia('(min-width: 768px)').matches
  const padding = () =>
    isDesktop()
      ? { left: 420, top: 120, right: 80, bottom: 60 } // top: clear the view toggle + mode chips
      : { left: 40, right: 40, top: 130, bottom: Math.round(innerHeight * 0.6) + 20 }

  $effect(() => {
    const line = data.line.color
    const m = new maplibregl.Map({
      container: el,
      style: 'https://tiles.openfreemap.org/styles/positron',
      bounds: bbox(data.stations),
      fitBoundsOptions: { padding: 40 },
      pitch: 60, // issue #6: real 3D map — tilted camera, rotatable, extruded buildings
      maxPitch: 85, // tilt down to near street level, with a sky at the horizon
      // Jabodetabek only (Rangkasbitung–Cikarang, Bogor–Tanjung Priok, with margin): no zooming out to all of
      // Indonesia, so only tiles for the area the network reaches are ever fetched.
      maxBounds: [[106.0, -6.95], [107.45, -5.8]],
      attributionControl: { compact: true, customAttribution: 'Jadwal: MRT Jakarta (tidak resmi)' },
    })
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    // Satellite toggle: Google satellite tiles, keyless. ponytail: unofficial endpoint (personal use), may break; official path is the Map Tiles API with a key.
    m.addControl({
      onAdd() {
        const d = document.createElement('div')
        d.className = 'maplibregl-ctrl maplibregl-ctrl-group'
        const css = 'font:700 10px/1 system-ui;color:#0b1f3a'
        d.innerHTML = `<button type="button" aria-pressed="false" title="Citra satelit" aria-label="Citra satelit" style="${css}">SAT</button>`
          + `<button type="button" title="Miringkan peta" aria-label="Miringkan peta" style="${css}">2D</button>`
          + `<button type="button" title="Putar ke kiri" aria-label="Putar peta ke kiri" style="font:16px/1 system-ui;color:#0b1f3a">↺</button>`
          + `<button type="button" title="Putar ke kanan" aria-label="Putar peta ke kanan" style="font:16px/1 system-ui;color:#0b1f3a">↻</button>`
          + `<button type="button" aria-pressed="false" title="Radar hujan" aria-label="Radar hujan" style="font:15px/1 system-ui">☔</button>`
        const [b, t, rl, rr, rain] = d.children
        // Rain radar (RainViewer, keyless). Latest frame fetched on each switch-on.
        // ponytail: one still frame, no animation/auto-refresh; free tier stops at z7, so it's overzoomed (soft) near street level.
        rain.onclick = async () => {
          const on = rain.getAttribute('aria-pressed') !== 'true'
          rain.setAttribute('aria-pressed', on)
          rain.style.background = on ? '#0b1f3a' : ''
          if (m.getLayer('rain')) m.removeLayer('rain')
          if (m.getSource('rain')) m.removeSource('rain')
          if (!on) return
          try {
            const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json()
            const f = j.radar.past.at(-1)
            if (rain.getAttribute('aria-pressed') !== 'true' || m.getSource('rain')) return // toggled off meanwhile
            const at = new Date(f.time * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
            rain.title = `Radar hujan · ${at} WIB (kosong = tidak ada hujan terdeteksi)`
            m.addSource('rain', { type: 'raster', tileSize: 256, maxzoom: 7, tiles: [`${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`], attribution: 'Radar © RainViewer' })
            m.addLayer({ id: 'rain', type: 'raster', source: 'rain', paint: { 'raster-opacity': 0.7 } }, m.getLayer('net-line') ? 'net-line' : 'track-casing')
          } catch {
            rain.setAttribute('aria-pressed', false)
            rain.style.background = ''
            rain.title = 'Radar hujan gagal dimuat — coba lagi'
          }
        }
        // Rotate buttons for mouse/trackpad users (touch: two-finger twist; mouse: right-drag). Compass resets north.
        rl.onclick = () => m.easeTo({ bearing: m.getBearing() - 45, duration: 400 })
        rr.onclick = () => m.easeTo({ bearing: m.getBearing() + 45, duration: 400 })
        // Tilt button: flat → tilted → street level → flat. Label shows the view it switches to.
        const STEPS = [0, 60, 80]
        const next = () => STEPS.find((p) => p > m.getPitch() + 5) ?? 0
        const label = () => (t.textContent = next() ? '3D' : '2D')
        t.onclick = () => m.easeTo({ pitch: next(), duration: 600 })
        m.on('pitchend', label)
        label()
        b.onclick = () => {
          if (!m.getLayer('sat')) return
          const on = b.getAttribute('aria-pressed') !== 'true'
          b.setAttribute('aria-pressed', on)
          b.style.background = on ? '#0b1f3a' : ''
          b.style.color = on ? '#fff' : '#0b1f3a'
          m.setLayoutProperty('sat', 'visibility', on ? 'visible' : 'none')
          // keep the 3D buildings over the photo, see-through so its real roofs still show
          for (const l of ['building-3d', 'building-roof']) m.setPaintProperty(l, 'fill-extrusion-opacity', ['interpolate', ['linear'], ['zoom'], 14, 0, 15, on ? 0.6 : 0.95])
        }
        return d
      },
      onRemove() {},
    }, 'top-right')

    m.on('load', () => {
      m.setSky({ 'sky-color': '#7fb4e6', 'horizon-color': '#dfe9f3', 'fog-color': '#eef2f6', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.6, 'atmosphere-blend': 0 })
      // 3D buildings from the basemap's own OpenMapTiles building layer, replacing the flat footprints.
      if (m.getLayer('building')) m.setLayoutProperty('building', 'visibility', 'none')
      // Window textures (drawn once on a canvas, no image files): low-rise = small punched windows,
      // towers = glass bands. Patterns cover roofs too, so a thin plain slab caps each building.
      const H = ['coalesce', ['get', 'render_height'], 6], B = ['coalesce', ['get', 'render_min_height'], 0]
      m.addImage('win-low', facade('#efe9df', '#8fa3b8', 24, 24, 10, 12), { pixelRatio: 2 })
      m.addImage('win-tall', facade('#cfd8e3', '#6f8fb0', 16, 20, 14, 13), { pixelRatio: 2 })
      const symbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id
      const fade = ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.95]
      m.addLayer({
        id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
        paint: { 'fill-extrusion-pattern': ['step', H, 'win-low', 30, 'win-tall'], 'fill-extrusion-height': H, 'fill-extrusion-base': B, 'fill-extrusion-opacity': fade },
      }, symbol)
      m.addLayer({
        id: 'building-roof', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], H, 0, '#e4ded4', 40, '#d3d9e1', 150, '#b4c0cf'],
          'fill-extrusion-height': ['+', H, 0.4], 'fill-extrusion-base': H, 'fill-extrusion-opacity': fade,
        },
      }, symbol)
      m.addSource('sat', {
        type: 'raster', tileSize: 256, maxzoom: 20,
        tiles: [0, 1, 2, 3].map((i) => `https://mt${i}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}`),
        attribution: 'Citra © Google',
      })
      m.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } }, 'building-3d')
      m.addSource('track', { type: 'geojson', data: data.geometry })
      m.addSource('stations', {
        type: 'geojson',
        promoteId: 'code',
        data: fc(data.stations.map((s) => pt(s, { code: s.code, name: s.name, elevated: s.elevated }))),
      })
      m.addSource('exits', {
        type: 'geojson',
        promoteId: 'id',
        data: fc(data.stations.flatMap((s) => s.exits.map((e) => pt(e, { id: e.id, ref: e.ref, station: s.code })))),
      })
      const ifSel = (on, off) => ['case', ['boolean', ['feature-state', 'selected'], false], on, off]
      m.addLayer({ id: 'track-casing', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 11] } })
      m.addLayer({ id: 'track', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': line, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 16, 6] } })
      m.addLayer({
        id: 'station-dot', type: 'circle', source: 'stations',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ifSel(8, 5), 16, ifSel(14, 10)],
          'circle-color': '#fff',
          'circle-stroke-width': ifSel(4, 3),
          'circle-stroke-color': ['case', ['get', 'elevated'], line, NAVY],
        },
      })
      m.addLayer({
        id: 'station-label', type: 'symbol', source: 'stations',
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [1.1, 0], 'text-anchor': 'left', 'text-optional': true },
        paint: { 'text-color': NAVY, 'text-halo-color': '#fff', 'text-halo-width': 1.6 },
      })
      m.addLayer({
        id: 'exit-dot', type: 'circle', source: 'exits', minzoom: 15,
        paint: { 'circle-radius': ifSel(13, 10), 'circle-color': YELLOW, 'circle-stroke-color': ifSel(NAVY, '#fff'), 'circle-stroke-width': ifSel(3, 1.5) },
      })
      m.addLayer({
        id: 'exit-label', type: 'symbol', source: 'exits', minzoom: 15,
        layout: { 'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true },
        paint: { 'text-color': NAVY },
      })
      // GPS dot (shared with the schematic via sel.me)
      m.addSource('me', { type: 'geojson', data: fc([]) })
      m.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 18, 'circle-color': '#2563eb', 'circle-opacity': 0.18, 'circle-pitch-alignment': 'map' } })
      const img = new Image(80, 120)
      img.onload = () => m.addImage('me', img, { pixelRatio: 2 })
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(personSvg())
      m.addLayer({ id: 'me-dot', type: 'symbol', source: 'me', layout: { 'icon-image': 'me', 'icon-size': 0.75, 'icon-anchor': 'bottom', 'icon-offset': [0, 3], 'icon-allow-overlap': true, 'icon-ignore-placement': true } })
      // Found route: only the ridden stretches, straight between stops (ponytail: not snapped to track geometry).
      m.addSource('route', { type: 'geojson', data: fc([]) })
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', ['get', 'walk']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 7, 16, 14] } })
      m.addLayer({ id: 'route-line', type: 'line', source: 'route', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', ['get', 'walk']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 8] } })
      m.addLayer({ id: 'route-stripe', type: 'line', source: 'route', filter: ['==', ['get', 'stripe'], true], paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 16, 2.5], 'line-dasharray': [2, 1.6] } })
      m.addLayer({ id: 'route-xfer', type: 'circle', source: 'route', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#0b1f3a', 'circle-stroke-width': 3 } })
      m.addLayer({ id: 'route-walk', type: 'line', source: 'route', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['get', 'walk']], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#55627a', 'line-width': 3, 'line-dasharray': [0.1, 2] } })
      m.addSource('focus', { type: 'geojson', data: fc([]) })
      m.addLayer({ id: 'focus-ring', type: 'circle', source: 'focus', paint: { 'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#0b1f3a', 'circle-stroke-width': 3 } })
      map = m

      // Other modes (issue #3): KRL, LRT, Transjakarta BRT from OSM, under the MRT layers.
      Promise.all([netReady, fetch(`${import.meta.env.BASE_URL}data/network-lines.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)])
        .then(([net, lines]) => {
          if (!net || !lines) return
          netLines = lines
          fetch(`${import.meta.env.BASE_URL}data/tj-shapes.json`).then((r) => r.json()).then((s) => (tjShapes = s)).catch(() => {})
          const byMode = (tj, rail) => ['match', ['get', 'mode'], 'tj', tj, rail]
          m.addSource('net-lines', { type: 'geojson', data: lines })
          m.addSource('net-stops', { type: 'geojson', data: net.stops })
          m.addLayer({ id: 'net-line', type: 'line', source: 'net-lines', layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, byMode(1.2, 2), 16, byMode(3, 5)] } }, 'track-casing')
          m.addLayer({ id: 'net-stop', type: 'circle', source: 'net-stops', minzoom: 10,
            paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, byMode(1.6, 2.6), 13, byMode(3, 4.5), 16, byMode(5, 7)], 'circle-color': '#fff', 'circle-stroke-width': 2,
              'circle-stroke-color': ['match', ['get', 'mode'], 'tj', '#1f5fbf', 'lrt', '#f26522', '#3fb6dc'] } }, 'track-casing')
          m.addLayer({ id: 'net-stop-label-rail', type: 'symbol', source: 'net-stops', minzoom: 11.5, filter: ['!=', ['get', 'mode'], 'tj'],
            layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11.5, 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true },
            paint: { 'text-color': '#24324a', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } }, 'station-dot')
          m.addLayer({ id: 'net-stop-label', type: 'symbol', source: 'net-stops', minzoom: 14, filter: ['==', ['get', 'mode'], 'tj'],
            layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
            paint: { 'text-color': '#3b4352', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } }, 'station-dot')
          applyMode(m, sel.mode, focusIds())
        })
    })

    const hit = (p) => {
      const box = [[p.x - 10, p.y - 10], [p.x + 10, p.y + 10]]
      const f = m.queryRenderedFeatures(box, { layers: ['exit-dot', 'station-dot', 'net-stop'].filter((l) => m.getLayer(l)) })
      return f.find((x) => x.layer.id === 'exit-dot') ?? f.find((x) => x.layer.id === 'station-dot') ?? f[0]
    }
    // Lines under the finger → schematic line ids ('track' = MRT). Shared corridors give several.
    const linesAt = (p) => {
      const box = [[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]]
      const f = m.queryRenderedFeatures(box, { layers: ['track', 'net-line'].filter((l) => m.getLayer(l)) })
      return [...new Set(f.map((x) => (x.layer.id === 'track' ? 'M' : x.properties.ref)))]
    }
    m.on('click', (e) => {
      const f = hit(e.point)
      if (!f) {
        const ids = linesAt(e.point)
        if (ids.length) openLine(ids)
        else sel.line = null
        return
      }
      if (f.layer.id === 'exit-dot') select(f.properties.station, f.properties.id)
      else if (f.layer.id === 'net-stop') openStop(net.stops.find((s) => s.mode === f.properties.mode && s.name === f.properties.name))
      else select(f.properties.code)
    })
    m.on('mousemove', (e) => (m.getCanvas().style.cursor = hit(e.point) || linesAt(e.point).length ? 'pointer' : ''))

    return () => m.remove()
  })

  // Focus: dim everything outside the chosen mode, or outside the lines of the open line panel.
  function applyMode(m, mode, ids) {
    const o = (mine) => (ids ? (ids.includes('M') ? 1 : 0.12) : mode === null || mode === mine ? 1 : 0.12)
    const onStop = ids && ['any', ...ids.map((id) => ['in', `,${id},`, ['concat', ',', ['coalesce', ['get', 'lines'], ''], ',', ['coalesce', ['get', 'routes'], ''], ',']])]
    const net = ids ? ['case', ['has', 'ref'], ['case', ['in', ['get', 'ref'], ['literal', ids]], 1, 0.08], ['case', onStop, 1, 0.12]]
      : mode === null ? 1 : ['case', ['==', ['get', 'mode'], mode], 1, 0.12]
    const set = (layer, props, v) => m.getLayer(layer) && props.forEach((p) => m.setPaintProperty(layer, p, v))
    set('track', ['line-opacity'], o('mrt'))
    set('track-casing', ['line-opacity'], o('mrt'))
    set('station-dot', ['circle-opacity', 'circle-stroke-opacity'], o('mrt'))
    set('station-label', ['text-opacity'], o('mrt'))
    set('net-line', ['line-opacity'], net)
    set('net-stop', ['circle-opacity', 'circle-stroke-opacity'], net)
    set('net-stop-label', ['text-opacity'], net)
    set('net-stop-label-rail', ['text-opacity'], net)
  }
  $effect(() => {
    const mode = sel.mode, ids = focusIds()
    if (map && !hidden) applyMode(map, mode, ids) // restyled when Peta opens; skips shader rebuilds behind Skema
  })

  $effect(() => {
    const geo = sel.line ? null : sel.route?.result?.geo
    if (!map || hidden) return // drawn when Peta opens; no GPU work while Skema is showing
    const ways = (id) => tjShapes[id] ?? (id === 'M' ? data.geometry.features.map((f) => f.geometry.coordinates) : (netLines?.features ?? []).filter((f) => f.properties.ref === id).map((f) => f.geometry.coordinates))
    const mode = (id) => netLines?.features.find((f) => f.properties.ref === id)?.properties.mode
    const spare = (id) => (netLines?.features ?? []).filter((f) => f.properties.mode === mode(id) && (f.properties.ref !== id || tjShapes[id])).map((f) => f.geometry.coordinates)
    const shape = (l) => (l.walk || !l.line ? l.coords : followLine(ways(l.line), l.coords, l.line === 'M' ? [] : spare(l.line), !!tjShapes[l.line]))
    map.getSource('route').setData(fc((geo ?? []).filter((l) => l.coords.length > 1).map((l) => ({ type: 'Feature', properties: { walk: l.walk, color: l.color, stripe: l.stripe }, geometry: { type: 'LineString', coordinates: shape(l) } })).concat(
      // a dot where each ride after the first starts: the transfer points
      (geo ?? []).filter((l, i) => i && !l.walk && l.coords.length).map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: l.coords[0] } })))))
    const all = (geo ?? []).flatMap((l) => l.coords)
    if (all.length > 1) {
      const lon = all.map((c) => c[0]), lat = all.map((c) => c[1])
      requestAnimationFrame(() => (map.resize(), map.fitBounds([[Math.min(...lon), Math.min(...lat)], [Math.max(...lon), Math.max(...lat)]], { padding: padding(), maxZoom: 15, duration: 600 }))) // after a Skema → Peta switch has sized the map
    }
  })

  // GPS dot; fly to it on the first fix after turning location on.
  let flown = false
  $effect(() => {
    const me = sel.me
    if (!map) return
    map.getSource('me').setData(fc(me ? [pt(me, {})] : []))
    if (!me) flown = false
    else if (!flown && !hidden) (flown = true), map.easeTo({ center: [me.lon, me.lat], zoom: Math.max(map.getZoom(), 15), duration: 700 })
  })

  // A stop picked in search: ring it and fly there (fresh picks only, see Schematic).
  $effect(() => {
    const f = sel.focus
    if (!map || !f || hidden || Date.now() - f.k > 3000) return
    map.getSource('focus').setData(fc([pt(f, {})]))
    map.flyTo({ center: [f.lon, f.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 900 })
  })

  // Switching Skema → Peta: centre on whatever station/halte panel is open.
  let wasHidden = hidden
  $effect(() => {
    const shown = wasHidden && !hidden
    wasHidden = hidden
    if (!map || !shown) return
    const s = untrack(() => data.stations.find((x) => x.code === sel.station)), stop = untrack(() => sel.stop)
    requestAnimationFrame(() => {
      map.resize()
      if (s) map.fitBounds(bbox([s, ...s.exits]), { padding: padding(), maxZoom: 17.5, duration: 700 })
      else if (stop) {
        map.getSource('focus').setData(fc([pt(stop, {})]))
        map.flyTo({ center: [stop.lon, stop.lat], zoom: Math.max(map.getZoom(), 16), padding: padding(), duration: 800 })
      }
    })
  })

  // Weather chip (issue #7) above the open station/halte; same cached request as the panel.
  $effect(() => {
    const p = data.stations.find((x) => x.code === sel.station) ?? sel.stop
    if (!map || !p) return
    let live = true, marker
    getWeather(p.lat, p.lon).then((w) => {
      if (!live) return
      const el = document.createElement('div')
      el.className = 'wx-chip'
      el.title = w.current.label
      el.textContent = `${w.current.icon} ${Math.round(w.current.temp)}°`
      marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -18] }).setLngLat([p.lon, p.lat]).addTo(map)
    }).catch(() => {}) // the panel shows the error; the map just has no chip
    return () => ((live = false), marker?.remove())
  })

  // Highlight + camera follow selection.
  let prev = { station: null, exit: null }
  $effect(() => {
    if (!map) return
    const { station, exit } = sel
    if (prev.station) map.setFeatureState({ source: 'stations', id: prev.station }, { selected: false })
    if (prev.exit) map.setFeatureState({ source: 'exits', id: prev.exit }, { selected: false })
    if (station) map.setFeatureState({ source: 'stations', id: station }, { selected: true })
    if (exit) map.setFeatureState({ source: 'exits', id: exit }, { selected: true })

    const s = data.stations.find((x) => x.code === station)
    const e = s?.exits.find((x) => x.id === exit)
    if (e) map.easeTo({ center: [e.lon, e.lat], zoom: Math.max(map.getZoom(), 17.5), padding: padding(), duration: 600 })
    else if (s && station !== prev.station) map.fitBounds(bbox([s, ...s.exits]), { padding: padding(), maxZoom: 17.5, duration: 700 })
    prev = { station, exit }
  })

  // One façade tile: wall colour with a single window in the middle; repeats across the building.
  function facade(wall, glass, w, h, ww, wh) {
    const c = document.createElement('canvas')
    c.width = w * 2, c.height = h * 2
    const x = c.getContext('2d')
    x.scale(2, 2)
    x.fillStyle = wall
    x.fillRect(0, 0, w, h)
    x.fillStyle = glass
    x.fillRect((w - ww) / 2, (h - wh) / 2, ww, wh)
    return x.getImageData(0, 0, c.width, c.height)
  }
  function bbox(pts) {
    const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat)
    return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
  }
  function pt(p, properties) {
    return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }
  }
  function fc(features) {
    return { type: 'FeatureCollection', features }
  }
</script>

<!-- hidden, not unmounted: keeps camera/tiles; stops Safari compositing the WebGL layer under the schematic -->
<div class="map" bind:this={el} style:visibility={hidden ? 'hidden' : null}></div>

<style>
  .map {
    position: fixed;
    inset: 0;
  }
  .map :global(.wx-chip) {
    pointer-events: none; padding: 3px 9px; border-radius: 999px; background: #fff; color: #0b1f3a;
    font: 700 13px/1.3 system-ui, sans-serif; white-space: nowrap; box-shadow: 0 2px 8px rgb(11 31 58 / 0.25);
  }
</style>
