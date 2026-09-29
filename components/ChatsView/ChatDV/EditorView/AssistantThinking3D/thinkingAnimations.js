import {
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    CircleGeometry,
    Color,
    CylinderGeometry,
    DoubleSide,
    ExtrudeGeometry,
    Group,
    IcosahedronGeometry,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshBasicMaterial,
    MeshPhysicalMaterial,
    MeshStandardMaterial,
    OctahedronGeometry,
    Path,
    PlaneGeometry,
    Shape,
    SphereGeometry,
    TorusGeometry,
    Vector3,
} from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * The ten scenes a loading assistant card can play. Each builder returns `{ root, update(t) }`:
 * `root` is placed at the origin of a square stage whose camera sees a sphere of radius ~1.4, and
 * `update` receives the seconds since the card started showing it.
 *
 * `update` is a function of ABSOLUTE time wherever possible, never of the frame delta: the stage
 * stops drawing a card that is scrolled away or in a background tab, and a scene that integrated
 * deltas would come back in a state that depends on how long it was hidden. The two scenes with a
 * real state machine (the cube's layer turns, the network's pulses) derive their state from `t` too.
 *
 * `update(t, fx)` also receives what the user is doing to the scene (`thinkingInteraction.js`):
 * `fx.sincePoke` — seconds since the last click/tap, `Infinity` before the first. Pokes already
 * speed the whole scene up by advancing `t` faster; `fx` is for each scene's own reaction on top.
 */

export const NO_FX = { sincePoke: Infinity, energy: 0, attention: 0, pokes: 0 }

// 1 at the moment of a poke, decaying to 0 — the envelope of every scene's reaction.
const kick = (fx, rate = 4) => (Number.isFinite(fx.sincePoke) ? Math.exp(-fx.sincePoke * rate) : 0)
// A single 0 → 1 → 0 hop lasting `duration` seconds, started `delay` seconds after the poke.
const hop = (fx, duration, delay = 0) => {
    if (!Number.isFinite(fx.sincePoke)) return 0
    const progress = (fx.sincePoke - delay) / duration
    return progress > 0 && progress < 1 ? Math.sin(progress * Math.PI) : 0
}

export const THINKING_PALETTES = {
    // On the light-blue chat card: the app's saturated blues, violet, green and gold.
    light: {
        primary: '#007FFF',
        secondary: '#8743FF',
        accent: '#00C282',
        gold: '#FFAE47',
        warm: '#FF7043',
        paper: '#FFFFFF',
        line: '#5AACFF',
    },
    // On the dark navy popup card: the same hues one step brighter, so they do not sink into it.
    dark: {
        primary: '#5AACFF',
        secondary: '#A16BFF',
        accent: '#06EEC1',
        gold: '#FFCE8F',
        warm: '#FF8A65',
        paper: '#EBF5FF',
        line: '#A3D1FF',
    },
}

const TAU = Math.PI * 2
const clamp01 = value => Math.min(1, Math.max(0, value))
const easeInOut = value => (value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2)
const easeOutBack = value => {
    const c = 1.70158
    const x = value - 1
    return 1 + (c + 1) * x * x * x + c * x * x
}
// A deterministic 0..1 hash, so every "random" choice a scene makes is a function of an index.
const hash01 = seed => {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
    return x - Math.floor(x)
}

const standard = (color, options = {}) =>
    new MeshStandardMaterial({ color: new Color(color), metalness: 0.25, roughness: 0.35, ...options })

const glowing = (color, intensity = 0.6, options = {}) =>
    standard(color, { emissive: new Color(color), emissiveIntensity: intensity, ...options })

// 1. An atom: a pulsing gold nucleus with three electrons on tilted orbits.
function atom(palette) {
    const root = new Group()
    const nucleus = new Mesh(new IcosahedronGeometry(0.34, 3), glowing(palette.gold, 0.45, { metalness: 0.6 }))
    root.add(nucleus)
    const colors = [palette.primary, palette.secondary, palette.accent]
    const orbits = colors.map((color, index) => {
        const plane = new Group()
        plane.rotation.set(index * 1.05 + 0.3, index * 0.9, index * 0.6)
        plane.add(new Mesh(new TorusGeometry(1.05, 0.012, 6, 96), standard(palette.line, { roughness: 0.6 })))
        const electron = new Mesh(new SphereGeometry(0.1, 20, 14), glowing(color, 0.9))
        plane.add(electron)
        root.add(plane)
        return electron
    })
    return {
        root,
        update(t, fx = NO_FX) {
            const poked = kick(fx, 3.5)
            nucleus.scale.setScalar(1 + 0.07 * Math.sin(t * 4) + 0.4 * poked)
            nucleus.material.emissiveIntensity = 0.45 + 1.2 * poked
            nucleus.rotation.set(t * 0.7, t * 0.9, 0)
            orbits.forEach((electron, index) => {
                const angle = t * (2.2 + index * 0.45) + index * 2.1
                electron.position.set(Math.cos(angle) * 1.05, Math.sin(angle) * 1.05, 0)
                electron.parent.scale.setScalar(1 + 0.14 * poked)
            })
            root.rotation.set(0.2, t * 0.4, 0)
        },
    }
}

// 2. A puzzle cube turning its layers, one quarter turn at a time.
const CUBE_MOVE_PERIOD = 0.95
const CUBE_TURN_TIME = 0.6
const CUBE_PITCH = 0.36
const CUBE_AXES = ['x', 'y', 'z']
function cube(palette) {
    const root = new Group()
    const pivot = new Group()
    root.add(pivot)
    // Faces +x, -x, +y, -y, +z, -z — each cubie carries all six, the hidden ones are simply unseen.
    const faceMaterials = [
        palette.primary,
        palette.accent,
        palette.paper,
        palette.gold,
        palette.secondary,
        palette.warm,
    ].map(color => standard(color, { roughness: 0.3, metalness: 0.1 }))
    const geometry = new BoxGeometry(0.33, 0.33, 0.33)
    const cubies = []
    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            for (let z = -1; z <= 1; z++) {
                const cubie = new Mesh(geometry, faceMaterials)
                cubie.position.set(x * CUBE_PITCH, y * CUBE_PITCH, z * CUBE_PITCH)
                root.add(cubie)
                cubies.push(cubie)
            }
        }
    }
    let activeMove = -1
    let activeCubies = []
    let activeAxis = 'x'
    let activeDirection = 1

    const snap = cubie => {
        cubie.position.set(
            Math.round(cubie.position.x / CUBE_PITCH) * CUBE_PITCH,
            Math.round(cubie.position.y / CUBE_PITCH) * CUBE_PITCH,
            Math.round(cubie.position.z / CUBE_PITCH) * CUBE_PITCH
        )
        const quarter = Math.PI / 2
        cubie.rotation.set(
            Math.round(cubie.rotation.x / quarter) * quarter,
            Math.round(cubie.rotation.y / quarter) * quarter,
            Math.round(cubie.rotation.z / quarter) * quarter
        )
    }
    const finishMove = () => {
        if (activeMove < 0) return
        pivot.rotation.set(0, 0, 0)
        pivot.rotation[activeAxis] = (activeDirection * Math.PI) / 2
        // `attach` re-reads root's world matrix, so pivot's must be computed from the same one.
        root.updateMatrixWorld(true)
        activeCubies.forEach(cubie => {
            root.attach(cubie)
            snap(cubie)
        })
        pivot.rotation.set(0, 0, 0)
        activeCubies = []
    }
    const startMove = move => {
        activeMove = move
        activeAxis = CUBE_AXES[Math.floor(hash01(move) * 3)]
        const layer = Math.floor(hash01(move + 0.5) * 3) - 1
        activeDirection = hash01(move + 0.25) < 0.5 ? -1 : 1
        pivot.rotation.set(0, 0, 0)
        root.updateMatrixWorld(true)
        activeCubies = cubies.filter(cubie => Math.round(cubie.position[activeAxis] / CUBE_PITCH) === layer)
        activeCubies.forEach(cubie => pivot.attach(cubie))
    }
    return {
        root,
        update(t, fx = NO_FX) {
            const move = Math.floor(t / CUBE_MOVE_PERIOD)
            if (move !== activeMove) {
                finishMove()
                startMove(move)
            }
            const progress = easeInOut(clamp01((t - move * CUBE_MOVE_PERIOD) / CUBE_TURN_TIME))
            pivot.rotation.set(0, 0, 0)
            pivot.rotation[activeAxis] = (activeDirection * progress * Math.PI) / 2
            root.rotation.set(0.55, t * 0.45 + 0.6, 0)
        },
    }
}

// 3. A double helix with a glow travelling up its strands.
function helix(palette) {
    const root = new Group()
    const spinner = new Group()
    root.add(spinner)
    const count = 14
    const radius = 0.5
    const beads = []
    const beadGeometry = new SphereGeometry(0.085, 16, 12)
    const rungGeometry = new CylinderGeometry(0.018, 0.018, radius * 2, 6)
    rungGeometry.rotateZ(Math.PI / 2)
    const rungMaterial = standard(palette.line, { roughness: 0.6 })
    for (let index = 0; index < count; index++) {
        const y = -0.95 + (index / (count - 1)) * 1.9
        const angle = y * 3.1
        const pair = new Group()
        pair.position.y = y
        pair.rotation.y = angle
        const left = new Mesh(beadGeometry, glowing(palette.primary, 0.35))
        const right = new Mesh(beadGeometry, glowing(palette.secondary, 0.35))
        left.position.x = -radius
        right.position.x = radius
        pair.add(left, right, new Mesh(rungGeometry, rungMaterial))
        spinner.add(pair)
        beads.push({ y, left, right })
    }
    return {
        root,
        update(t, fx = NO_FX) {
            beads.forEach(({ y, left, right }) => {
                const wave = Math.pow(Math.max(0, Math.cos(y * 2.2 - t * 3.6)), 8)
                // A poke sends a flash from the middle of the strand out to both ends.
                const flash = hop(fx, 0.45, Math.abs(y) * 0.25)
                const scale = 1 + 0.55 * wave + 0.5 * flash
                left.scale.setScalar(scale)
                right.scale.setScalar(scale)
                left.material.emissiveIntensity = 0.35 + wave + 1.4 * flash
                right.material.emissiveIntensity = 0.35 + wave + 1.4 * flash
            })
            spinner.rotation.y = t * 1.1
            root.rotation.set(0, 0, 0.42)
        },
    }
}

// 4. A little neural network: signals hop between the nodes of an icosahedron.
const PULSE_HOP_TIME = 0.55
function network(palette) {
    const root = new Group()
    const source = new IcosahedronGeometry(1.05, 0)
    const points = []
    const position = source.getAttribute('position')
    for (let index = 0; index < position.count; index++) {
        const point = new Vector3().fromBufferAttribute(position, index)
        if (!points.some(existing => existing.distanceTo(point) < 1e-4)) points.push(point)
    }
    source.dispose()
    const edgeLength = Math.min(
        ...points.flatMap((a, i) => points.slice(i + 1).map(b => a.distanceTo(b))).filter(d => d > 1e-4)
    )
    const neighbours = points.map((a, i) =>
        points.map((b, j) => j).filter(j => j !== i && Math.abs(points[j].distanceTo(a) - edgeLength) < 1e-3)
    )
    const linePositions = []
    neighbours.forEach((list, i) =>
        list.forEach(j => {
            if (j > i) linePositions.push(...points[i].toArray(), ...points[j].toArray())
        })
    )
    const lineGeometry = new BufferGeometry()
    lineGeometry.setAttribute('position', new BufferAttribute(new Float32Array(linePositions), 3))
    root.add(
        new LineSegments(lineGeometry, new LineBasicMaterial({ color: palette.line, transparent: true, opacity: 0.7 }))
    )
    const nodeGeometry = new SphereGeometry(0.09, 16, 12)
    const nodes = points.map(point => {
        const node = new Mesh(nodeGeometry, glowing(palette.primary, 0.3))
        node.position.copy(point)
        root.add(node)
        return node
    })
    const core = new Mesh(new IcosahedronGeometry(0.22, 2), glowing(palette.secondary, 0.5))
    root.add(core)
    const pulseColors = [palette.accent, palette.gold, palette.secondary, palette.accent, palette.gold]
    const pulses = pulseColors.map((color, index) => {
        const mesh = new Mesh(new SphereGeometry(0.07, 12, 10), new MeshBasicMaterial({ color }))
        root.add(mesh)
        return { mesh, seed: index * 17 + 3 }
    })
    // The node a pulse sits on after `hop` hops, derived from scratch so it only depends on `t`.
    const nodeAfter = (seed, hop) => {
        let node = Math.floor(hash01(seed) * points.length)
        for (let step = 1; step <= hop % 64; step++) {
            const list = neighbours[node]
            node = list[Math.floor(hash01(seed + step * 7.3 + Math.floor(hop / 64) * 3.1) * list.length)]
        }
        return node
    }
    const scratch = new Vector3()
    return {
        root,
        update(t, fx = NO_FX) {
            const arrivals = new Array(points.length).fill(0)
            pulses.forEach(({ mesh, seed }, index) => {
                const local = t / PULSE_HOP_TIME + index * 0.37
                const hop = Math.floor(local)
                const progress = easeInOut(local - hop)
                const from = nodeAfter(seed, hop)
                const to = nodeAfter(seed, hop + 1)
                scratch.lerpVectors(points[from], points[to], progress)
                mesh.position.copy(scratch)
                arrivals[to] = Math.max(arrivals[to], Math.pow(progress, 6))
                arrivals[from] = Math.max(arrivals[from], Math.pow(1 - progress, 6))
            })
            nodes.forEach((node, index) => {
                // A poke fires the core, and the signal reaches the nodes a moment later.
                const answer = hop(fx, 0.4, 0.12 + hash01(index + 40) * 0.2)
                node.scale.setScalar(1 + 0.6 * arrivals[index] + 0.7 * answer)
                node.material.emissiveIntensity = 0.3 + arrivals[index] + 1.5 * answer
            })
            const fired = kick(fx, 5)
            core.scale.setScalar(1 + 0.08 * Math.sin(t * 3) + 0.6 * fired)
            core.material.emissiveIntensity = 0.5 + 1.5 * fired
            root.rotation.set(0.3, t * 0.5, 0)
        },
    }
}

// 5. Two gears meshing, and a small gold one driven by the big one — "the tiny gears are turning".
const gearShape = (teeth, pitchRadius) => {
    const outer = pitchRadius + 0.08
    const inner = pitchRadius - 0.08
    const shape = new Shape()
    const step = TAU / teeth
    for (let i = 0; i < teeth; i++) {
        const a = i * step
        const corners = [
            [a - step * 0.25, inner],
            [a - step * 0.15, outer],
            [a + step * 0.15, outer],
            [a + step * 0.25, inner],
            [a + step * 0.5, inner],
        ]
        corners.forEach(([angle, radius], index) => {
            const x = Math.cos(angle) * radius
            const y = Math.sin(angle) * radius
            if (i === 0 && index === 0) shape.moveTo(x, y)
            else shape.lineTo(x, y)
        })
    }
    shape.closePath()
    const hole = new Path()
    hole.absarc(0, 0, pitchRadius * 0.28, 0, TAU, true)
    shape.holes.push(hole)
    const geometry = new ExtrudeGeometry(shape, {
        depth: 0.16,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.015,
        bevelSegments: 2,
        curveSegments: 8,
    })
    geometry.translate(0, 0, -0.08)
    return geometry
}
function gears(palette) {
    const root = new Group()
    const specs = [
        { teeth: 12, pitch: 0.62, color: palette.primary },
        { teeth: 8, pitch: 0.42, color: palette.secondary },
        { teeth: 6, pitch: 0.3, color: palette.gold },
    ]
    // The train is taller above its driver than below it; centre it, and keep it slightly under
    // life size so the tilted gold gear (the one nearest the camera) never touches the frame.
    const train = new Group()
    train.position.y = -0.14
    train.scale.setScalar(0.8)
    root.add(train)
    const meshes = specs.map(({ teeth, pitch, color }) => {
        const mesh = new Mesh(gearShape(teeth, pitch), standard(color, { metalness: 0.55, roughness: 0.3 }))
        train.add(mesh)
        return mesh
    })
    // Gear 1 meshes with gear 0 along `theta01`, gear 2 with gear 0 along `theta02`.
    const theta01 = -0.55
    const theta02 = 2.3
    meshes[0].position.set(-0.2, 0.12, 0)
    const placeAround = (mesh, theta, pitch) =>
        mesh.position.set(
            meshes[0].position.x + Math.cos(theta) * (specs[0].pitch + pitch),
            meshes[0].position.y + Math.sin(theta) * (specs[0].pitch + pitch),
            0
        )
    placeAround(meshes[1], theta01, specs[1].pitch)
    placeAround(meshes[2], theta02, specs[2].pitch)
    // A driven gear's angle so that where the driver has a tooth on the line between centres, the
    // driven gear has a gap: aB = theta + π - π/nB - (nA/nB)(aA - theta).
    const drivenAngle = (driverAngle, theta, nA, nB) =>
        theta + Math.PI - Math.PI / nB - (nA / nB) * (driverAngle - theta)
    return {
        root,
        update(t, fx = NO_FX) {
            const driver = t * 1.1
            meshes[0].rotation.z = driver
            meshes[1].rotation.z = drivenAngle(driver, theta01, specs[0].teeth, specs[1].teeth)
            meshes[2].rotation.z = drivenAngle(driver, theta02, specs[0].teeth, specs[2].teeth)
            root.rotation.set(-0.45 + 0.08 * Math.sin(t * 0.8), 0.45 + 0.15 * Math.sin(t * 0.5), 0)
        },
    }
}

// 6. A book leafing through its pages, forwards and then back again.
const PAGE_COUNT = 5
const PAGE_STAGGER = 0.32
const PAGE_FLIP_TIME = 0.75
const BOOK_CYCLE = PAGE_COUNT * PAGE_STAGGER + PAGE_FLIP_TIME + 0.35
function book(palette) {
    const root = new Group()
    const coverMaterial = standard(palette.primary, { roughness: 0.5 })
    const coverGeometry = new BoxGeometry(0.95, 1.25, 0.05)
    const leftCover = new Mesh(coverGeometry, coverMaterial)
    const rightCover = new Mesh(coverGeometry, coverMaterial)
    leftCover.position.set(-0.49, 0, -0.06)
    rightCover.position.set(0.49, 0, -0.06)
    const blockGeometry = new BoxGeometry(0.88, 1.15, 0.06)
    const blockMaterial = standard(palette.paper, { roughness: 0.8 })
    const leftBlock = new Mesh(blockGeometry, blockMaterial)
    const rightBlock = new Mesh(blockGeometry, blockMaterial)
    leftBlock.position.set(-0.46, 0, -0.01)
    rightBlock.position.set(0.46, 0, -0.01)
    root.add(leftCover, rightCover, leftBlock, rightBlock)
    const pageGeometry = new PlaneGeometry(0.88, 1.15, 8, 1)
    pageGeometry.translate(0.44, 0, 0)
    const lineMaterial = new MeshBasicMaterial({ color: palette.line, side: DoubleSide })
    const pages = []
    for (let index = 0; index < PAGE_COUNT; index++) {
        const pivot = new Group()
        pivot.position.z = 0.025 + index * 0.004
        const page = new Mesh(pageGeometry, standard(palette.paper, { roughness: 0.75, side: DoubleSide }))
        pivot.add(page)
        // Three faint lines of "text" so the page reads as a page while it turns.
        for (let line = 0; line < 3; line++) {
            const text = new Mesh(new PlaneGeometry(0.55 - line * 0.1, 0.04), lineMaterial)
            text.position.set(0.44 - line * 0.05, 0.3 - line * 0.18, 0.002)
            pivot.add(text)
        }
        root.add(pivot)
        pages.push(pivot)
    }
    return {
        root,
        update(t, fx = NO_FX) {
            const cycle = Math.floor(t / BOOK_CYCLE)
            const local = t - cycle * BOOK_CYCLE
            const forwards = cycle % 2 === 0
            pages.forEach((pivot, index) => {
                const order = forwards ? index : PAGE_COUNT - 1 - index
                const progress = easeInOut(clamp01((local - order * PAGE_STAGGER) / PAGE_FLIP_TIME))
                const angle = (forwards ? progress : 1 - progress) * Math.PI
                pivot.rotation.y = -angle
                // A page lifts off the block while it turns, which is what sells it as paper.
                pivot.position.z = 0.025 + index * 0.004 + Math.sin(angle) * 0.02
            })
            root.rotation.set(-0.75, 0.12 * Math.sin(t * 0.6), 0)
            root.position.y = 0.05 * Math.sin(t * 1.3)
        },
    }
}

// 7. An iridescent blob that keeps changing its mind about its shape.
function blob(palette) {
    const root = new Group()
    const base = new IcosahedronGeometry(0.95, 12)
    base.deleteAttribute('normal')
    base.deleteAttribute('uv')
    const geometry = mergeVertices(base)
    base.dispose()
    geometry.computeVertexNormals()
    const positions = geometry.getAttribute('position')
    const rest = Float32Array.from(positions.array)
    const material = new MeshPhysicalMaterial({
        color: new Color(palette.primary),
        emissive: new Color(palette.secondary),
        emissiveIntensity: 0.18,
        metalness: 0.15,
        roughness: 0.18,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        iridescence: 1,
        iridescenceIOR: 1.4,
    })
    const mesh = new Mesh(geometry, material)
    root.add(mesh)
    return {
        root,
        update(t, fx = NO_FX) {
            // A poke sets it jiggling like jelly, a ripple that dies out over about a second.
            const jiggle = 0.16 * kick(fx, 3)
            const since = Number.isFinite(fx.sincePoke) ? fx.sincePoke : 0
            const array = positions.array
            for (let i = 0; i < array.length; i += 3) {
                const x = rest[i]
                const y = rest[i + 1]
                const z = rest[i + 2]
                const wobble =
                    1 +
                    0.13 * Math.sin(x * 3.1 + t * 1.9) * Math.sin(y * 2.7 + t * 1.5) * Math.sin(z * 2.9 + t * 1.2) +
                    0.05 * Math.sin(x * 6 - y * 5 + t * 2.6) +
                    jiggle * Math.sin(x * 4.2 + y * 3.1 + z * 2.3 - since * 22)
                array[i] = x * wobble
                array[i + 1] = y * wobble
                array[i + 2] = z * wobble
            }
            positions.needsUpdate = true
            geometry.computeVertexNormals()
            mesh.rotation.set(t * 0.3, t * 0.45, 0)
        },
    }
}

// 8. A tower of blocks building itself, then tidying away and starting over.
const TOWER_BLOCKS = 6
const TOWER_DROP_INTERVAL = 0.42
const TOWER_DROP_TIME = 0.4
const TOWER_BLOCK_HEIGHT = 0.24
const TOWER_HOLD = 0.8
const TOWER_CLEAR_TIME = 0.35
const TOWER_CYCLE = TOWER_BLOCKS * TOWER_DROP_INTERVAL + TOWER_HOLD + TOWER_CLEAR_TIME
function tower(palette) {
    const root = new Group()
    const colors = [palette.primary, palette.secondary, palette.accent, palette.gold, palette.warm, palette.primary]
    const geometry = new BoxGeometry(0.8, TOWER_BLOCK_HEIGHT * 0.92, 0.8)
    const blocks = colors.map((color, index) => {
        const block = new Mesh(geometry, standard(color, { roughness: 0.4 }))
        block.rotation.y = index * 0.28
        root.add(block)
        return block
    })
    const restY = index => -0.72 + TOWER_BLOCK_HEIGHT / 2 + index * TOWER_BLOCK_HEIGHT
    return {
        root,
        update(t, fx = NO_FX) {
            const local = t % TOWER_CYCLE
            const clearStart = TOWER_BLOCKS * TOWER_DROP_INTERVAL + TOWER_HOLD
            const clear = clamp01((local - clearStart) / TOWER_CLEAR_TIME)
            blocks.forEach((block, index) => {
                const fall = clamp01((local - index * TOWER_DROP_INTERVAL) / TOWER_DROP_TIME)
                const landed = local - index * TOWER_DROP_INTERVAL - TOWER_DROP_TIME
                const y = restY(index) + (1 - fall * fall) * 2.6
                // A poke makes the stack jump, a wave running up from the bottom block.
                block.position.y = y + hop(fx, 0.35, index * 0.05) * (0.08 + index * 0.03)
                block.rotation.y = index * 0.28 + hop(fx, 0.35, index * 0.05) * (index % 2 ? 0.4 : -0.4)
                block.visible = fall > 0
                // A short squash when it lands, so the stack has weight.
                const squash = landed > 0 && landed < 0.18 ? Math.sin((landed / 0.18) * Math.PI) * 0.18 : 0
                const shrink = 1 - easeInOut(clear)
                block.scale.set((1 + squash * 0.5) * shrink, (1 - squash) * shrink, (1 + squash * 0.5) * shrink)
            })
            root.rotation.set(0.35, t * 0.35 + 0.5, 0)
        },
    }
}

// 9. A faceted crystal with a counter-rotating core and twinkling sparkles around it.
function crystal(palette) {
    const root = new Group()
    const shell = new Mesh(
        new OctahedronGeometry(0.72, 0),
        new MeshPhysicalMaterial({
            color: new Color(palette.secondary),
            emissive: new Color(palette.secondary),
            emissiveIntensity: 0.15,
            metalness: 0.1,
            roughness: 0.05,
            clearcoat: 1,
            iridescence: 0.8,
            flatShading: true,
            transparent: true,
            opacity: 0.88,
        })
    )
    shell.scale.y = 1.35
    const core = new Mesh(
        new OctahedronGeometry(0.28, 0),
        glowing(palette.gold, 0.8, { flatShading: true, metalness: 0.6 })
    )
    root.add(shell, core)
    const sparkleGeometry = new OctahedronGeometry(0.06, 0)
    const sparkles = Array.from({ length: 8 }, (_, index) => {
        const sparkle = new Mesh(
            sparkleGeometry,
            new MeshBasicMaterial({ color: index % 2 ? palette.accent : palette.gold })
        )
        root.add(sparkle)
        return {
            sparkle,
            phase: hash01(index + 1) * TAU,
            height: (hash01(index + 9) - 0.5) * 1.4,
            speed: 0.6 + hash01(index + 4),
        }
    })
    return {
        root,
        update(t, fx = NO_FX) {
            shell.rotation.y = t * 0.8
            core.rotation.set(t * 1.2, -t * 1.6, 0)
            root.position.y = 0.06 * Math.sin(t * 1.6)
            // A poke flares the core and blows the sparkles outwards before they drift back.
            const burst = kick(fx, 3)
            core.scale.setScalar(1 + 0.5 * burst)
            core.material.emissiveIntensity = 0.8 + 1.5 * burst
            const orbit = 0.98 * (1 + 0.2 * burst)
            sparkles.forEach(({ sparkle, phase, height, speed }) => {
                const angle = phase + t * speed
                sparkle.position.set(
                    Math.cos(angle) * orbit,
                    (height + 0.1 * Math.sin(t * 2 + phase)) * (1 - 0.25 * burst),
                    Math.sin(angle) * orbit
                )
                const twinkle = Math.max(0, Math.sin(t * 3.2 + phase * 3))
                sparkle.scale.setScalar(0.3 + twinkle * 1.2 + burst * 0.7)
                sparkle.rotation.set(t * 2, t * 3, 0)
            })
        },
    }
}

// 10. The classic "typing…" dots, as three bouncing marbles with their shadows.
function dots(palette) {
    const root = new Group()
    const colors = [palette.primary, palette.secondary, palette.accent]
    const shadowMaterial = color =>
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false })
    const marbles = colors.map((color, index) => {
        const x = (index - 1) * 0.62
        const marble = new Mesh(
            new SphereGeometry(0.22, 32, 20),
            glowing(color, 0.25, { roughness: 0.2, metalness: 0.2 })
        )
        const shadow = new Mesh(new CircleGeometry(0.2, 32), shadowMaterial(color))
        shadow.rotation.x = -Math.PI / 2
        shadow.position.set(x, -0.45, 0)
        marble.position.x = x
        root.add(marble, shadow)
        return { marble, shadow }
    })
    const floor = -0.45 + 0.22
    // The smallest scene at card size, so it is drawn a little larger than the others.
    root.scale.setScalar(1.3)
    return {
        root,
        update(t, fx = NO_FX) {
            marbles.forEach(({ marble, shadow }, index) => {
                const phase = t * 4.6 - index * 0.75
                const lift = Math.max(0, Math.sin(phase))
                const height = lift * lift * 0.7 + hop(fx, 0.5, index * 0.09) * 0.2
                // Squash on the floor, stretch on the way up.
                const stretch = lift > 0.05 ? 1 + 0.12 * Math.cos(phase) * lift : 0.82
                marble.position.y = floor + height - (1 - stretch) * 0.1
                marble.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch))
                const spread = 1 - height * 0.7
                shadow.scale.setScalar(spread)
                shadow.material.opacity = 0.28 * spread
            })
            root.rotation.set(0.35, 0.18 * Math.sin(t * 0.7), 0)
        },
    }
}

const BUILDERS = { atom, cube, helix, network, gears, book, blob, tower, crystal, dots }

/** Builds a scene by name; an unknown name falls back to the atom rather than showing nothing. */
export function buildThinkingAnimation(name, appearance = 'light') {
    const palette = THINKING_PALETTES[appearance] || THINKING_PALETTES.light
    const builder = BUILDERS[name] || BUILDERS.atom
    return builder(palette)
}

export const THINKING_ANIMATION_BUILDER_NAMES = Object.keys(BUILDERS)
