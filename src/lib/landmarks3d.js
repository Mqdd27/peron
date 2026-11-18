// Low-poly isometric landmark models, rendered ONCE with three.js into transparent PNG sprites for the schematic.
// ponytail: static snapshots, not a live 3D scene — a WebGL canvas tracking SVG pan/zoom is what made Safari lag.
// Upgrade path if live 3D is ever wanted: one shared canvas, render only on gesture end.
import * as THREE from 'three'

const C = {
  stone: 0xeceae4, white: 0xfbfaf7, gold: 0xe2b33a, grass: 0x9ccf7a, grassDark: 0x6fae55, leaf: 0x4f9a46,
  leaf2: 0x76b852, trunk: 0x8a6a4a, water: 0x7cc6e6, glass: 0x9fc4dc, glassDark: 0x5f8fb3, roof: 0xb4552d,
  wood: 0xd9b48a, seat: 0xd23b33, steel: 0xc9ced8, navy: 0x0b1f3a,
}
const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true })
function mesh(geo, color, [x = 0, y = 0, z = 0] = [], ry = 0) {
  const m = new THREE.Mesh(geo, mat(color))
  m.position.set(x, y, z)
  m.rotation.y = ry
  return m
}
const box = (w, h, d, c, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), c, [x, y + h / 2, z])
const cyl = (rt, rb, h, seg, c, x = 0, y = 0, z = 0, ry = 0) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), c, [x, y + h / 2, z], ry)

function tree(g, x, z, s = 1, c = C.leaf) {
  g.add(cyl(0.12 * s, 0.15 * s, 0.6 * s, 5, C.trunk, x, 0.1, z))
  g.add(mesh(new THREE.IcosahedronGeometry(0.55 * s, 0), c, [x, 0.95 * s, z]))
}

const MODELS = {
  monas(g) {
    g.add(box(5, 0.35, 5, C.grass))
    g.add(box(3.4, 0.5, 3.4, C.stone, 0, 0.35))
    g.add(cyl(1.3, 1.6, 0.6, 4, C.white, 0, 0.85, 0, Math.PI / 4)) // cawan
    g.add(cyl(0.32, 0.55, 5.6, 4, C.white, 0, 1.45, 0, Math.PI / 4)) // tugu
    g.add(cyl(0.45, 0.25, 0.3, 8, C.gold, 0, 7.05))
    g.add(mesh(new THREE.ConeGeometry(0.32, 0.9, 7), C.gold, [0, 7.8, 0])) // lidah api
    for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) tree(g, x, z, 0.7)
  },
  stadium(g) {
    const oval = (o) => (o.scale.z = 0.72, o)
    g.add(box(7, 0.25, 5.4, C.grassDark))
    g.add(oval(cyl(3.3, 3.3, 1.5, 40, C.steel, 0, 0.25)))
    g.add(oval(cyl(2.9, 2.5, 1.6, 40, C.seat, 0, 0.3)))
    g.add(oval(cyl(2.2, 2.2, 0.32, 40, C.grass, 0, 0.25)))
    const ring = mesh(new THREE.TorusGeometry(3.25, 0.22, 4, 40), C.white, [0, 1.85, 0])
    ring.rotation.x = Math.PI / 2
    g.add(oval(ring))
  },
  park(g) {
    g.add(box(6, 0.3, 4.6, C.grass))
    g.add(oval2(cyl(1.2, 1.2, 0.34, 20, C.water, 0.9, 0.05, 0.6)))
    const pts = [[-2.2, -1.5, 1.1], [-1.1, -1.7, 0.9], [-2.3, 0.2, 1], [-1, 1.5, 1.2], [2.2, -1.4, 1], [2.3, 1.6, 0.8], [0.4, -1.8, 0.8]]
    pts.forEach(([x, z, s], i) => tree(g, x, z, s, i % 2 ? C.leaf : C.leaf2))
    g.add(box(1.8, 0.08, 0.3, C.wood, -0.3, 0.6, 0.6)) // jembatan
  },
  mall(g) {
    g.add(box(5.4, 0.25, 4.4, C.stone))
    g.add(box(4.4, 1.6, 3.2, C.glass, 0, 0.25))
    g.add(box(4.6, 0.18, 3.4, C.white, 0, 1.85))
    g.add(box(3.2, 1.0, 2.2, C.glassDark, -0.3, 2.03))
    g.add(box(1.2, 3.6, 1.2, C.glass, 1.6, 2.03, -0.6))
    g.add(box(1.3, 0.15, 1.3, C.white, 1.6, 5.63, -0.6))
    g.add(box(2.2, 0.5, 0.06, C.seat, -0.3, 1.0, 1.62)) // signage
  },
  pavilion(g) {
    g.add(box(6, 0.25, 4.6, C.grass))
    g.add(oval2(cyl(1.4, 1.4, 0.3, 20, C.water, -1.5, 0.05, 1)))
    g.add(box(2.8, 0.35, 2.8, C.stone, 0.8, 0.25, -0.5))
    for (const [x, z] of [[-0.3, -1.6], [1.9, -1.6], [-0.3, 0.6], [1.9, 0.6]]) g.add(box(0.18, 1.1, 0.18, C.wood, x, 0.6, z))
    g.add(cyl(0.05, 2.5, 1.6, 4, C.roof, 0.8, 1.7, -0.5, Math.PI / 4)) // atap joglo
    tree(g, -2.3, -1.6, 0.9)
    tree(g, 2.5, 1.5, 0.8, C.leaf2)
  },
  mosque(g) {
    g.add(box(6, 0.3, 5, C.grass))
    g.add(box(3.6, 1.4, 3.6, C.white, -0.4, 0.3, 0))
    g.add(box(3.9, 0.15, 3.9, C.stone, -0.4, 1.7, 0))
    g.add(mesh(new THREE.SphereGeometry(1.55, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), C.steel, [-0.4, 1.85, 0]))
    g.add(cyl(0.03, 0.08, 0.7, 6, C.gold, -0.4, 3.4))
    g.add(cyl(0.28, 0.32, 5.2, 8, C.white, 2.2, 0.3, -1.6)) // menara
    g.add(cyl(0.38, 0.38, 0.18, 8, C.stone, 2.2, 4.4, -1.6))
    g.add(mesh(new THREE.ConeGeometry(0.3, 0.8, 8), C.steel, [2.2, 5.9, -1.6]))
    tree(g, 2.3, 1.7, 0.8)
    tree(g, -2.6, 1.9, 0.7, C.leaf2)
  },
  airport(g) {
    g.add(box(8, 0.25, 5, C.grassDark))
    const runway = box(7.4, 0.06, 1, 0x5d6573, 0, 0.25, 1.2)
    g.add(runway)
    for (let i = -3; i <= 3; i++) g.add(box(0.5, 0.02, 0.1, C.white, i, 0.31, 1.2))
    g.add(box(3, 0.9, 1.4, C.glass, -1.4, 0.25, -1.4))
    g.add(cyl(0.22, 0.28, 2.2, 8, C.white, 2.2, 0.25, -1.6))
    g.add(cyl(0.5, 0.35, 0.45, 8, C.glassDark, 2.2, 2.45, -1.6))
    const plane = new THREE.Group()
    const body = mesh(new THREE.CylinderGeometry(0.22, 0.22, 3, 10), C.white)
    body.rotation.z = Math.PI / 2
    plane.add(body)
    plane.add(mesh(new THREE.ConeGeometry(0.22, 0.5, 10), C.white, [1.75, 0, 0]).rotateZ(-Math.PI / 2))
    plane.add(box(0.7, 0.05, 3, C.steel, 0.1, -0.05, 0))
    plane.add(box(0.4, 0.6, 0.06, C.navy, -1.35, 0.1, 0))
    plane.add(box(0.35, 0.04, 1.1, C.steel, -1.3, 0.05, 0))
    plane.position.set(0.6, 1.9, 1.2)
    plane.rotation.z = 0.18
    g.add(plane)
  },
  oldtown(g) { // Museum Fatahillah-style colonial hall on a stone plaza
    g.add(box(7, 0.25, 5.4, C.stone))
    g.add(box(5.6, 1.7, 2.2, C.white, 0, 0.25, -0.8))
    for (let i = -2; i <= 2; i++) g.add(box(0.5, 0.7, 0.04, C.glassDark, i * 1.05, 0.65, 0.32))
    const roof = cyl(0.05, 3.2, 1.1, 4, C.roof, 0, 1.95, -0.8, Math.PI / 4)
    roof.scale.set(1.25, 1, 0.55)
    g.add(roof)
    g.add(box(0.9, 0.9, 0.9, C.white, 0, 2.6, -0.8)) // menara jam
    g.add(mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), C.roof, [0, 3.5, -0.8]))
    g.add(cyl(0.02, 0.05, 0.5, 5, C.gold, 0, 3.95, -0.8))
    g.add(cyl(0.5, 0.6, 0.3, 10, C.steel, 0, 0.25, 1.6)) // air mancur
    tree(g, -3, 1.8, 0.7)
    tree(g, 3, 1.8, 0.7, C.leaf2)
  },
  zoo(g) { // Ragunan: trees, pond, giraffe and elephant
    g.add(box(6.4, 0.3, 5, C.grass))
    g.add(oval2(cyl(1.1, 1.1, 0.34, 18, C.water, 1.6, 0.05, 1.2)))
    for (const [x, z, sc, c] of [[-2.5, -1.8, 1.1, C.leaf], [-1.2, -2, 0.9, C.leaf2], [2.5, -1.8, 1, C.leaf], [-2.6, 1.6, 0.9, C.leaf2], [0.4, -2.1, 0.8, C.leaf]]) tree(g, x, z, sc, c)
    const gir = 0xe0a94a
    for (const [x, z] of [[-0.9, 0.1], [-0.3, 0.1], [-0.9, 0.5], [-0.3, 0.5]]) g.add(box(0.1, 1, 0.1, gir, x, 0.3, z))
    g.add(box(0.9, 0.45, 0.55, gir, -0.6, 1.3, 0.3))
    const neck = box(0.18, 1.4, 0.18, gir, -0.15, 1.5, 0.3)
    neck.rotation.z = -0.3
    g.add(neck)
    g.add(box(0.4, 0.2, 0.22, gir, 0.25, 2.85, 0.3))
    const ele = 0x9aa1ad
    g.add(box(1.2, 0.8, 0.8, ele, 0.9, 0.75, -0.3))
    for (const [x, z] of [[0.5, -0.6], [1.3, -0.6], [0.5, 0], [1.3, 0]]) g.add(box(0.22, 0.45, 0.22, ele, x, 0.3, z))
    g.add(box(0.5, 0.55, 0.6, ele, 1.65, 1.0, -0.3))
    g.add(box(0.16, 0.6, 0.16, ele, 1.95, 0.5, -0.3))
  },
}
function oval2(o) { o.scale.z = 0.7; return o }

/** @returns {Record<string, string>} model name → PNG data URL */
export function renderLandmarks(names, px = 320) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(px, px, false)
  const out = {}
  for (const name of names) {
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a3, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.9)
    sun.position.set(-4, 10, 6)
    scene.add(sun)
    const g = new THREE.Group()
    MODELS[name](g)
    scene.add(g)
    const sphere = new THREE.Box3().setFromObject(g).getBoundingSphere(new THREE.Sphere())
    const r = sphere.radius * 1.02
    const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.1, 100)
    cam.position.copy(sphere.center).add(new THREE.Vector3(1, 0.9, 1.15).normalize().multiplyScalar(40))
    cam.lookAt(sphere.center)
    renderer.clear()
    renderer.render(scene, cam)
    out[name] = renderer.domElement.toDataURL('image/png')
    scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose() })
  }
  renderer.dispose()
  renderer.forceContextLoss()
  return out
}
