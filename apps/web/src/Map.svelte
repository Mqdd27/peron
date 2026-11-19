<script>
  import { untrack } from 'svelte'
  import { personSvg } from './lib/network.js'
  import { followLine } from './lib/route.js'
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
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true, customAttribution: 'Jadwal: MRT Jakarta (tidak resmi)' },
    })
    m.touchZoomRotate.disableRotation()
    m.keyboard.disableRotation()
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    m.on('load', () => {
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
    const spare = (id) => (netLines?.features ?? []).filter((f) => f.properties.mode === mode(id) && f.properties.ref !== id).map((f) => f.geometry.coordinates)
    const shape = (l) => (l.walk || !l.line ? l.coords : followLine(ways(l.line), l.coords, l.line === 'M' ? [] : spare(l.line)))
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
</style>
