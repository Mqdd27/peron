<script>
  import * as maplibregl from 'maplibre-gl'
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
  import { sel, select, openStop, net, netReady } from './lib/state.svelte.js'

  maplibregl.setWorkerUrl(workerUrl)

  /** @type {{ data: any, hidden?: boolean }} */
  let { data, hidden = false } = $props()
  let el
  let map = $state(null)

  const NAVY = '#0b1f3a'
  const YELLOW = '#ffcc00'

  const isDesktop = () => matchMedia('(min-width: 768px)').matches
  const padding = () =>
    isDesktop()
      ? { left: 420, top: 60, right: 60, bottom: 60 }
      : { left: 40, right: 40, top: 70, bottom: Math.round(innerHeight * 0.6) + 20 }

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
      m.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 18, 'circle-color': '#2563eb', 'circle-opacity': 0.18 } })
      m.addLayer({ id: 'me-dot', type: 'circle', source: 'me', paint: { 'circle-radius': 7, 'circle-color': '#2563eb', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } })
      m.addSource('focus', { type: 'geojson', data: fc([]) })
      m.addLayer({ id: 'focus-ring', type: 'circle', source: 'focus', paint: { 'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#0b1f3a', 'circle-stroke-width': 3 } })
      map = m

      // Other modes (issue #3): KRL, LRT, Transjakarta BRT from OSM, under the MRT layers.
      netReady
        .then((net) => {
          if (!net) return
          const byMode = (tj, rail) => ['match', ['get', 'mode'], 'tj', tj, rail]
          m.addSource('net-lines', { type: 'geojson', data: net.lines })
          m.addSource('net-stops', { type: 'geojson', data: net.stops })
          m.addLayer({ id: 'net-line', type: 'line', source: 'net-lines', layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, byMode(1.2, 2), 16, byMode(3, 5)] } }, 'track-casing')
          m.addLayer({ id: 'net-stop', type: 'circle', source: 'net-stops', minzoom: 12.5,
            paint: { 'circle-radius': byMode(3, 4), 'circle-color': '#fff', 'circle-stroke-width': 2,
              'circle-stroke-color': ['match', ['get', 'mode'], 'tj', '#1f5fbf', 'lrt', '#f26522', '#3fb6dc'] } }, 'track-casing')
          m.addLayer({ id: 'net-stop-label', type: 'symbol', source: 'net-stops', minzoom: 14.5,
            layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
            paint: { 'text-color': '#3b4352', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } }, 'station-dot')
          applyMode(m, sel.mode)
        })
    })

    const hit = (p) => {
      const box = [[p.x - 10, p.y - 10], [p.x + 10, p.y + 10]]
      const f = m.queryRenderedFeatures(box, { layers: ['exit-dot', 'station-dot', 'net-stop'].filter((l) => m.getLayer(l)) })
      return f.find((x) => x.layer.id === 'exit-dot') ?? f.find((x) => x.layer.id === 'station-dot') ?? f[0]
    }
    m.on('click', (e) => {
      const f = hit(e.point)
      if (!f) return
      if (f.layer.id === 'exit-dot') select(f.properties.station, f.properties.id)
      else if (f.layer.id === 'net-stop') openStop(net.stops.find((s) => s.mode === f.properties.mode && s.name === f.properties.name))
      else select(f.properties.code)
    })
    m.on('mousemove', (e) => (m.getCanvas().style.cursor = hit(e.point) ? 'pointer' : ''))

    return () => m.remove()
  })

  // Mode focus: dim every layer that isn't the chosen mode.
  function applyMode(m, mode) {
    const o = (mine) => (mode === null || mode === mine ? 1 : 0.12)
    const net = mode === null ? 1 : ['case', ['==', ['get', 'mode'], mode], 1, 0.12]
    const set = (layer, props, v) => m.getLayer(layer) && props.forEach((p) => m.setPaintProperty(layer, p, v))
    set('track', ['line-opacity'], o('mrt'))
    set('track-casing', ['line-opacity'], o('mrt'))
    set('station-dot', ['circle-opacity', 'circle-stroke-opacity'], o('mrt'))
    set('station-label', ['text-opacity'], o('mrt'))
    set('net-line', ['line-opacity'], net)
    set('net-stop', ['circle-opacity', 'circle-stroke-opacity'], net)
    set('net-stop-label', ['text-opacity'], net)
  }
  $effect(() => {
    const mode = sel.mode
    if (map) applyMode(map, mode)
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
