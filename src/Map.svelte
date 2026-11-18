<script>
  import * as maplibregl from 'maplibre-gl'
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
  import { sel, select } from './lib/state.svelte.js'

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
    m.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right')

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
      map = m
    })

    const hit = (p) => {
      const box = [[p.x - 10, p.y - 10], [p.x + 10, p.y + 10]]
      const f = m.queryRenderedFeatures(box, { layers: ['exit-dot', 'station-dot'].filter((l) => m.getLayer(l)) })
      return f.find((x) => x.layer.id === 'exit-dot') ?? f[0]
    }
    m.on('click', (e) => {
      const f = hit(e.point)
      if (!f) return
      if (f.layer.id === 'exit-dot') select(f.properties.station, f.properties.id)
      else select(f.properties.code)
    })
    m.on('mousemove', (e) => (m.getCanvas().style.cursor = hit(e.point) ? 'pointer' : ''))

    return () => m.remove()
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
