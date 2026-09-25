import {
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    CircleGeometry,
    Color,
    ConeGeometry,
    CylinderGeometry,
    DoubleSide,
    Group,
    InstancedMesh,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    PerspectiveCamera,
    PlaneGeometry,
    Raycaster,
    Scene,
    ShaderMaterial,
    SphereGeometry,
    SRGBColorSpace,
    TorusGeometry,
    Vector2,
    Vector3,
    WebGLRenderer,
} from 'three'

import { colors } from '../../../../styles/global'
import {
    CRITICAL_HIT_CHANCE,
    getBuildingType,
    getIntegrity,
    rollHitPoints,
    getOrbitView,
    getSkylineHeight,
    getSkylineScale,
    SKYLINE_MAX_HEIGHT,
    SKYLINE_WEEKS,
} from './skylineData'

/**
 * The imperative half of the Empty inbox skyline: a small living city on the white achievements
 * card, one building per day of the last quarter, seen from a camera slowly flying around it.
 *
 * Three layers, each with one job:
 *
 *  - THE CAMERA flies on its own (`getOrbitView`): a slow sweep around the front of the city
 *    with a gently rising and dipping elevation. It is independent of the page scroll. Every frame
 *    it computes how far back it has to be for the WHOLE city — tallest possible building and the
 *    legends included — to sit inside the canvas with a margin (`fitDistance`), so the city never
 *    touches the canvas edge. A city cut off by the edge of an invisible box is what breaks the
 *    illusion that it stands on the card.
 *  - THE BUILDINGS say how busy a day was, by height, colour (the app's blue ramp) and TYPE
 *    (`getBuildingType`): a little park for a day with nothing done, then a house, a mid-rise with a
 *    spinning rooftop fan, a stepped tower, and a skyscraper with an antenna and a beacon. A green
 *    roof (the 2D grid's UtilityGreen200) marks an empty-inbox day.
 *  - DEMOLITION is the toy on top: every tap on a building is a hit. A building takes a random
 *    number of hits (`rollHitPoints`, more for bigger types, sometimes a double-damage critical);
 *    each hit shakes it, flashes it, knocks floors off in a burst of debris and sparks, and the
 *    last one collapses it into a cloud of dust with a little camera shake, leaving rubble. It is
 *    purely local and temporary — kept in memory by date, so a statistics refresh does not undo
 *    it, and a reload brings the whole city back.
 *  - THE LIFE is decoration only and carries no data: a soft light sweep up the facades, cars
 *    on the road grid between the blocks, a single small flock of birds, and now and then a
 *    hot-air balloon or a small plane with its shadow. None of it is interactive, and all of it stops for reduced motion.
 *
 * Every colour is an app colour. The canvas is transparent, so the card's own white is the sky.
 * Loaded through a dynamic `import()` from `EmptyInboxSkyline`, so three.js is its own chunk.
 */

const FOOTPRINT = 0.72
const GRID_DAYS = 7
// Centre-to-centre distance between two days. Wider than a building so a road runs between every
// row and column: the city fills more of the card, and the lean of a tall building is a smaller
// share of the whole, so less room has to be reserved for it.
const PITCH = 1.55
const ROAD_WIDTH = 0.5
const BLOCK = PITCH - ROAD_WIDTH
const MARGIN_X = 2.2
const MARGIN_Z = 1.6
const GROUND_PX_PER_UNIT = 64
const RISE_DURATION = 1.1
const CAMERA_FOV = 32
// How far inside the canvas edge (in normalized device coordinates) the city has to stay.
const FRAME_MARGIN = 0.88
const SPIRE = 0.7
// Tallest thing that can stand on a plot: the highest building plus spire and beacon. Used to
// reserve room so nothing ever pokes out of the card.
const TALLEST = SKYLINE_MAX_HEIGHT * 1.15 + 0.1 + SPIRE + 0.12
const FROZEN_TIME = 20

const PLOT = colors.Grey100
const ROAD = colors.Grey300
const LANE = '#FFFFFF'
const PARK = colors.UtilityGreen100
const TREE = colors.UtilityGreen125
const SHADOW = colors.Grey200
const LABEL = colors.Text03
const INBOX_GREEN = colors.UtilityGreen200
const HIGHLIGHT = colors.UtilityYellow200
const METAL = colors.Grey400
const BEACON = colors.UtilityOrange200
const BIRD = colors.Text02
const BALLOON = colors.UtilityYellow200
const BALLOON_STRIPE = colors.UtilityOrange200
const BASKET = colors.Secondary300
const AIRPLANE = colors.Secondary200
const AIRPLANE_TAIL = colors.Primary100
const GROUND_SHADE = colors.Text01
// Building colours: all app colours. Blues dominate (listed more than once) so the city still reads
// as Alldone; violets and warm tones are the occasional accent. No greens — green means inbox zero.
const BODY_PALETTE = [
    colors.Primary100,
    colors.Primary100,
    colors.Primary300,
    colors.Secondary100,
    colors.Secondary200,
    colors.UtilityDarkBlue125,
    colors.UtilityDarkBlue125,
    colors.ProjectColor300,
    colors.UtilityViolet150,
    colors.Grey400,
]
const ACCENT_PALETTE = [
    colors.UtilityDarkBlue125,
    colors.Primary100,
    colors.Secondary200,
    colors.UtilityViolet125,
    colors.UtilityYellow150,
    colors.UtilityOrange150,
    colors.Grey300,
]
const CAR_COLORS = [
    colors.UtilityYellow200,
    colors.Primary100,
    colors.UtilityOrange200,
    colors.Secondary100,
    colors.Grey400,
    colors.UtilityGreen200,
]

const posX = week => (week - (SKYLINE_WEEKS - 1) / 2) * PITCH
const posZ = weekday => (weekday - (GRID_DAYS - 1) / 2) * PITCH
// Roads run along the outside of the city too, so these are the centre lines of the outer roads.
const CITY_HALF_WIDTH = (SKYLINE_WEEKS * PITCH) / 2
const CITY_HALF_DEPTH = (GRID_DAYS * PITCH) / 2

// Deterministic pseudo-random numbers: the city must look the same on every visit and every
// re-render, so nothing here may use Math.random.
const seeded = seed => {
    let state = seed % 2147483647
    if (state <= 0) state += 2147483646
    return () => {
        state = (state * 16807) % 2147483647
        return (state - 1) / 2147483646
    }
}

const HASH_GLSL = `
    uniform float uTime;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`

const solidVertexShader = `
    varying vec3 vWorld; varying vec3 vN; varying vec3 vColor; varying float vLocalY; varying vec2 vOrigin;
    void main() {
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vLocalY = position.y;
        vOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
        #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
        #else
            vColor = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * world;
    }`

// Soft, matte shading and a slow band of light sweeping up the facades (one per building, each on its
// own phase, so the city shimmers rather than flashes). No cloud shadows: anything drawn on the
// ground beyond the city reveals the edge of the canvas and breaks the "printed on the card" look.
const solidFragmentShader = `
    uniform float uMotion;
    varying vec3 vWorld; varying vec3 vN; varying vec3 vColor; varying float vLocalY; varying vec2 vOrigin;
    ${HASH_GLSL}
    void main() {
        vec3 n = normalize(vN);
        vec3 light = normalize(vec3(-0.35, 1.0, 0.45));
        float diff = max(dot(n, light), 0.0);
        vec3 col = vColor * (0.64 + 0.36 * diff);
        float side = 1.0 - step(0.6, n.y);
        float band = fract(uTime * 0.08 + hash(floor(vOrigin * 2.0 + 0.5))) * 3.4 - 1.2;
        float sheen = smoothstep(0.14, 0.0, abs(vLocalY - band)) * side * uMotion;
        col = mix(col, vec3(1.0), sheen * 0.24);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
    }`

/**
 * @param {HTMLElement} container an empty element the canvas is appended to; it must have a size
 * @param {Object} options
 * @param {(index: number) => void} options.onHover  -1 when the pointer leaves every building
 * @param {(index: number) => void} options.onSelect -1 for a tap on empty ground
 * @param {(count: number) => void} [options.onDemolish] called with the running total after each collapse
 * @param {boolean} options.reduceMotion
 */
export function createSkylineScene(container, { onHover, onSelect, onDemolish = () => {}, reduceMotion = false }) {
    const renderer = new WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = SRGBColorSpace
    renderer.setClearColor(new Color('#FFFFFF'), 0)
    const canvas = renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    container.appendChild(canvas)

    const scene = new Scene()
    const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.5, 400)

    const disposables = []
    const track = item => {
        disposables.push(item)
        return item
    }
    const time = { value: reduceMotion ? FROZEN_TIME : 0 }
    const motion = { value: reduceMotion ? 0 : 1 }

    // ---------------------------------------------------------------- shared geometry & materials
    const unitBox = track(new BoxGeometry(1, 1, 1))
    unitBox.translate(0, 0.5, 0)
    const unitPyramid = track(new ConeGeometry(Math.SQRT1_2, 1, 4))
    unitPyramid.rotateY(Math.PI / 4)
    unitPyramid.translate(0, 0.5, 0)
    const unitSphere = track(new SphereGeometry(0.5, 12, 8))
    unitSphere.translate(0, 0.5, 0)
    const unitCylinder = track(new CylinderGeometry(0.5, 0.5, 1, 8))
    unitCylinder.translate(0, 0.5, 0)

    const solidMaterial = track(
        new ShaderMaterial({
            uniforms: { uTime: time, uMotion: motion },
            vertexShader: solidVertexShader,
            fragmentShader: solidFragmentShader,
        })
    )
    const basic = color => track(new MeshBasicMaterial({ color: new Color(color) }))
    const roofMaterial = basic(INBOX_GREEN)
    const fanMaterial = basic(METAL)
    const beaconMaterial = basic(BEACON)
    const groundShadeMaterial = track(
        new MeshBasicMaterial({ color: new Color(GROUND_SHADE), transparent: true, opacity: 0.07, depthWrite: false })
    )

    // ---------------------------------------------------------------- ground
    const groundWidth = CITY_HALF_WIDTH * 2 + MARGIN_X * 2
    const groundDepth = CITY_HALF_DEPTH * 2 + MARGIN_Z * 2
    const groundCanvas = document.createElement('canvas')
    groundCanvas.width = Math.round(groundWidth * GROUND_PX_PER_UNIT)
    groundCanvas.height = Math.round(groundDepth * GROUND_PX_PER_UNIT)
    const groundTexture = track(new CanvasTexture(groundCanvas))
    groundTexture.colorSpace = SRGBColorSpace
    groundTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    const ground = new Mesh(
        track(new PlaneGeometry(groundWidth, groundDepth)),
        track(new MeshBasicMaterial({ map: groundTexture, transparent: true }))
    )
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)

    let days = []
    let labels = { months: [], weekdays: [] }
    let scale = 5

    const drawGround = () => {
        const context = groundCanvas.getContext('2d')
        const px = GROUND_PX_PER_UNIT
        const cx = x => (x + groundWidth / 2) * px
        const cz = z => (z + groundDepth / 2) * px
        context.clearRect(0, 0, groundCanvas.width, groundCanvas.height)
        const plot = FOOTPRINT * px
        const corner = 0.07 * px
        const roundRect = (x, y, w, h) => {
            context.beginPath()
            if (context.roundRect) context.roundRect(x, y, w, h, corner)
            else context.rect(x, y, w, h)
            context.fill()
        }
        // Asphalt under the whole city; the blocks are laid on it, so what shows between them is the
        // road grid.
        const roadHalf = ROAD_WIDTH / 2
        context.fillStyle = ROAD
        context.beginPath()
        const extentX = CITY_HALF_WIDTH + roadHalf
        const extentZ = CITY_HALF_DEPTH + roadHalf
        if (context.roundRect)
            context.roundRect(cx(-extentX), cz(-extentZ), extentX * 2 * px, extentZ * 2 * px, 0.3 * px)
        else context.rect(cx(-extentX), cz(-extentZ), extentX * 2 * px, extentZ * 2 * px)
        context.fill()
        // Dashed centre lines, one dash per block edge so they break at every junction.
        context.fillStyle = LANE
        const dash = 0.22 * px
        const dashWidth = 0.035 * px
        for (let row = 0; row <= GRID_DAYS; row++) {
            const z = -CITY_HALF_DEPTH + row * PITCH
            for (let week = 0; week < SKYLINE_WEEKS; week++) {
                const from = posX(week) - BLOCK / 2
                for (let x = from + 0.08; x + 0.22 <= from + BLOCK; x += 0.42) {
                    context.fillRect(cx(x), cz(z) - dashWidth / 2, dash, dashWidth)
                }
            }
        }
        for (let column = 0; column <= SKYLINE_WEEKS; column++) {
            const x = -CITY_HALF_WIDTH + column * PITCH
            for (let weekday = 0; weekday < GRID_DAYS; weekday++) {
                const from = posZ(weekday) - BLOCK / 2
                for (let z = from + 0.08; z + 0.22 <= from + BLOCK; z += 0.42) {
                    context.fillRect(cx(x) - dashWidth / 2, cz(z), dashWidth, dash)
                }
            }
        }
        // One block per day of the quarter: a park for the days nothing got done.
        const block = BLOCK * px
        const byCell = new Map(days.map(day => [`${day.week}:${day.weekday}`, day]))
        for (let week = 0; week < SKYLINE_WEEKS; week++) {
            for (let weekday = 0; weekday < GRID_DAYS; weekday++) {
                const day = byCell.get(`${week}:${weekday}`)
                context.fillStyle = day && day.tasks <= 0 ? PARK : PLOT
                roundRect(cx(posX(week)) - block / 2, cz(posZ(weekday)) - block / 2, block, block)
            }
        }
        // Contact shadows on the blocks, longer for taller buildings.
        context.fillStyle = SHADOW
        days.forEach(day => {
            if (day.tasks <= 0) return
            const length = Math.min(1, getSkylineHeight(day.tasks, scale) / SKYLINE_MAX_HEIGHT) * 0.14 * px
            roundRect(cx(posX(day.week)) - plot / 2 + length, cz(posZ(day.weekday)) - plot / 2 - length, plot, plot)
        })
        context.fillStyle = LABEL
        context.textBaseline = 'middle'
        const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        context.textAlign = 'left'
        context.font = `500 ${0.46 * px}px ${font}`
        labels.months.forEach(({ week, text }) => {
            context.fillText(text, cx(posX(week) - BLOCK / 2), cz(CITY_HALF_DEPTH + roadHalf + 0.5))
        })
        context.textAlign = 'right'
        context.font = `500 ${0.38 * px}px ${font}`
        labels.weekdays.forEach(({ weekday, text }) => {
            context.fillText(text, cx(-CITY_HALF_WIDTH - roadHalf - 0.25), cz(posZ(weekday)))
        })
        groundTexture.needsUpdate = true
    }

    // ---------------------------------------------------------------- buildings
    // Every building is a handful of PARTS, each an instance in one of a few instanced meshes, so a
    // quarter of varied architecture is still only seven draw calls.
    const KINDS = {
        box: { geometry: unitBox, material: solidMaterial, colored: true, pickable: true },
        pyramid: { geometry: unitPyramid, material: solidMaterial, colored: true, pickable: true },
        tree: { geometry: unitSphere, material: solidMaterial, colored: true },
        cylinder: { geometry: unitCylinder, material: solidMaterial, colored: true, pickable: true },
        dome: { geometry: unitSphere, material: solidMaterial, colored: true, pickable: true },
        spire: { geometry: unitCylinder, material: solidMaterial, colored: true },
        roof: { geometry: unitBox, material: roofMaterial },
        roofDisc: { geometry: unitCylinder, material: roofMaterial },
        fan: { geometry: unitBox, material: fanMaterial },
        beacon: { geometry: unitSphere, material: beaconMaterial },
    }
    let meshes = {}
    let parts = []
    let partsByBuilding = []
    let buildingOfInstance = new Map()
    let baseColors = []
    let rise = new Float32Array(0)
    let riseFrom = new Float32Array(0)
    let riseDelay = new Float32Array(0)
    let animationStart = 0
    let animating = false
    let todayIndex = -1
    let hoverIndex = -1
    let selectedIndex = -1
    let celebrationStart = -1
    // Demolition state, keyed by date so it survives a statistics refresh rebuilding the parts.
    const damage = new Map()
    let demolished = 0
    let cameraShake = 0
    const damageOf = b => (b >= 0 && b < days.length ? damage.get(days[b].dateKey) : null)

    const disposeBuildingMeshes = () => {
        Object.values(meshes).forEach(mesh => {
            scene.remove(mesh)
            mesh.dispose()
        })
        meshes = {}
    }

    // Architecture. Height always means "tasks done that day"; everything else is free, so each
    // day picks one of several designs for its height band and its own colours from the app
    // palette (seeded by date, so a day always looks the same). Green stays reserved for the
    // empty-inbox roofs, and every design tops out at exactly the day's height so the skyline
    // still reads as data.
    let buildingColors = []
    const buildParts = () => {
        const list = []
        const byBuilding = days.map(() => [])
        buildingColors = days.map(() => PLOT)
        days.forEach((day, b) => {
            const x = posX(day.week)
            const z = posZ(day.weekday)
            const type = getBuildingType(day.tasks, scale)
            const H = getSkylineHeight(day.tasks, scale)
            const random = seeded(day.week * 31 + day.weekday * 7 + 11)
            const pick = list => list[Math.floor(random() * list.length) % list.length]
            const body = pick(BODY_PALETTE)
            const accent = pick(ACCENT_PALETTE.filter(color => color !== body))
            buildingColors[b] = body
            const F = FOOTPRINT
            const add = (kind, part) => {
                const entry = { kind, b, x, z, y: 0, rot: 0, ...part }
                list.push(entry)
                byBuilding[b].push(entry)
                return entry
            }
            const box = (part, color = body) => add('box', { color, ...part })
            const flatRoof = (w, d, top, offset = {}) => {
                if (day.achieved) add('roof', { y: top, w: w + 0.03, h: 0.05, d: d + 0.03, isRoof: true, ...offset })
            }
            const discRoof = (w, top) => {
                if (day.achieved) add('roofDisc', { y: top, w: w + 0.03, h: 0.05, d: w + 0.03, isRoof: true })
            }
            const roofColor = color => (day.achieved ? INBOX_GREEN : color)
            const spireOnTop = top => {
                add('spire', { y: top, w: 0.05, h: SPIRE, d: 0.05, color: METAL })
                add('beacon', { y: top + SPIRE - 0.03, w: 0.12, h: 0.12, d: 0.12, blink: random() * Math.PI * 2 })
            }
            const stack = (count, width, depth, twist, color = body) => {
                const slab = H / count
                for (let i = 0; i < count; i++) {
                    box({ y: i * slab, w: width, h: slab * 0.94, d: depth, rot: i * twist }, i % 2 ? color : body)
                }
                flatRoof(width, depth, H - slab * 0.06, { rot: (count - 1) * twist })
            }

            const designs = {
                park: () => {
                    // A flat plaza (so the day can still be hovered and tapped) with a few trees.
                    box({ w: F, h: 0.03, d: F }, PARK)
                    const trees = 2 + Math.floor(random() * 2)
                    for (let i = 0; i < trees; i++) {
                        const size = 0.16 + random() * 0.1
                        add('tree', {
                            x: x + (random() - 0.5) * (F - size),
                            z: z + (random() - 0.5) * (F - size),
                            w: size,
                            h: size,
                            d: size,
                            color: TREE,
                        })
                    }
                    flatRoof(F, F, 0.03)
                },
                gable: () => {
                    const wall = Math.max(0.2, H - 0.28)
                    box({ w: F * 0.84, h: wall, d: F * 0.84 })
                    add('pyramid', {
                        y: wall,
                        w: F * 0.92,
                        h: H - wall,
                        d: F * 0.92,
                        color: roofColor(accent),
                        rot: random() < 0.5 ? 0 : Math.PI / 2,
                        isRoof: day.achieved,
                    })
                },
                silo: () => {
                    const domeHeight = Math.min(0.36, H * 0.45)
                    add('cylinder', { w: F * 0.72, h: H - domeHeight / 2, d: F * 0.72, color: body })
                    add('dome', {
                        y: H - domeHeight,
                        w: F * 0.72,
                        h: domeHeight,
                        d: F * 0.72,
                        color: roofColor(accent),
                        isRoof: day.achieved,
                    })
                },
                rowHouses: () => {
                    ;[-1, 1].forEach((side, i) => {
                        const top = i ? H : H * 0.82
                        const wall = Math.max(0.16, top - 0.22)
                        const offset = { x: x + side * F * 0.24 }
                        box({ ...offset, w: F * 0.44, h: wall, d: F * 0.84 }, i ? body : accent)
                        add('pyramid', {
                            ...offset,
                            y: wall,
                            w: F * 0.46,
                            h: top - wall,
                            d: F * 0.86,
                            color: roofColor(i ? accent : body),
                            isRoof: day.achieved,
                        })
                    })
                },
                shop: () => {
                    box({ w: F * 0.9, h: H, d: F * 0.8 })
                    box({ z: z + F * 0.45, y: H * 0.42, w: F * 0.9, h: 0.035, d: 0.18 }, accent)
                    flatRoof(F * 0.9, F * 0.8, H)
                },
                fanBlock: () => {
                    box({ w: F, h: H, d: F })
                    flatRoof(F, F, H)
                    const unit = F * 0.34
                    const ux = x + (random() - 0.5) * F * 0.3
                    const uz = z + (random() - 0.5) * F * 0.3
                    box({ x: ux, z: uz, y: H + 0.05, w: unit, h: 0.12, d: unit }, METAL)
                    add('fan', {
                        x: ux,
                        z: uz,
                        y: H + 0.17,
                        w: unit * 0.95,
                        h: 0.015,
                        d: 0.05,
                        spin: 2 + random() * 2,
                        rot: random() * Math.PI,
                    })
                },
                roundTower: () => {
                    const domeHeight = Math.min(0.4, H * 0.18)
                    add('cylinder', { w: F * 0.86, h: H - domeHeight / 2, d: F * 0.86, color: body })
                    add('cylinder', { y: H * 0.45, w: F * 0.96, h: 0.06, d: F * 0.96, color: accent })
                    add('dome', {
                        y: H - domeHeight,
                        w: F * 0.86,
                        h: domeHeight,
                        d: F * 0.86,
                        color: roofColor(accent),
                        isRoof: day.achieved,
                    })
                },
                lShape: () => {
                    box({ z: z - F * 0.26, w: F, h: H, d: F * 0.48 })
                    box({ x: x - F * 0.26, z: z + F * 0.24, w: F * 0.48, h: H * 0.62, d: F * 0.52 }, accent)
                    flatRoof(F, F * 0.48, H, { z: z - F * 0.26 })
                },
                twistedStack: () => stack(4, F * 0.82, F * 0.82, 0.28, accent),
                stepped: () => {
                    const split = H * 0.7
                    box({ w: F * 0.92, h: split, d: F * 0.92 })
                    box({ y: split, w: F * 0.66, h: H - split, d: F * 0.66 }, accent)
                    flatRoof(F * 0.66, F * 0.66, H)
                    box({ y: H + 0.05, w: F * 0.34, h: 0.14, d: F * 0.34 }, METAL)
                },
                banded: withSpire => () => {
                    add('cylinder', { w: F * 0.8, h: H, d: F * 0.8, color: body })
                    for (let y = 0.5; y < H - 0.2; y += 0.55) {
                        add('cylinder', { y, w: F * 0.86, h: 0.045, d: F * 0.86, color: accent })
                    }
                    discRoof(F * 0.8, H)
                    if (withSpire) spireOnTop(H)
                },
                spiral: () => stack(Math.max(5, Math.round(H / 0.32)), F * 0.8, F * 0.5, 0.2, accent),
                twins: () => {
                    ;[-1, 1].forEach((side, i) => {
                        const top = i ? H : H * 0.86
                        box({ x: x + side * F * 0.26, w: F * 0.38, h: top, d: F * 0.6 }, i ? body : accent)
                        flatRoof(F * 0.38, F * 0.6, top, { x: x + side * F * 0.26 })
                    })
                    box({ y: H * 0.58, w: F * 0.3, h: 0.1, d: F * 0.22 }, METAL)
                },
                obelisk: () => {
                    const shaft = H * 0.74
                    box({ w: F * 0.66, h: shaft, d: F * 0.66 })
                    add('pyramid', {
                        y: shaft,
                        w: F * 0.66,
                        h: H - shaft,
                        d: F * 0.66,
                        color: roofColor(accent),
                        isRoof: day.achieved,
                    })
                },
                spireScraper: () => {
                    const first = H * 0.42
                    const second = H * 0.82
                    box({ w: F, h: first, d: F })
                    box({ y: first, w: F * 0.76, h: second - first, d: F * 0.76 })
                    box({ y: second, w: F * 0.54, h: H - second, d: F * 0.54 }, accent)
                    flatRoof(F * 0.54, F * 0.54, H)
                    spireOnTop(H)
                },
            }
            const byType = {
                park: [designs.park],
                house: [designs.gable, designs.silo, designs.rowHouses, designs.shop],
                midrise: [designs.fanBlock, designs.roundTower, designs.lShape, designs.twistedStack],
                tower: [designs.stepped, designs.banded(false), designs.spiral, designs.obelisk, designs.twins],
                skyscraper: [
                    designs.spireScraper,
                    designs.banded(true),
                    designs.twins,
                    designs.spiral,
                    designs.obelisk,
                ],
            }
            pick(byType[type])()
        })
        return { list, byBuilding }
    }

    const createMeshes = () => {
        disposeBuildingMeshes()
        buildingOfInstance = new Map()
        const counts = {}
        parts.forEach(part => {
            counts[part.kind] = (counts[part.kind] || 0) + 1
        })
        Object.entries(KINDS).forEach(([kind, spec]) => {
            const count = counts[kind] || 0
            const mesh = new InstancedMesh(spec.geometry, spec.material, Math.max(count, 1))
            mesh.count = count
            mesh.frustumCulled = false
            if (spec.colored) mesh.setColorAt(0, new Color(PLOT))
            meshes[kind] = mesh
            if (spec.pickable) buildingOfInstance.set(mesh, [])
            scene.add(mesh)
        })
        const next = {}
        parts.forEach(part => {
            const index = next[part.kind] || 0
            next[part.kind] = index + 1
            part.index = index
            const mesh = meshes[part.kind]
            if (KINDS[part.kind].colored) {
                part.base = new Color(part.color)
                mesh.setColorAt(index, part.base)
            }
            if (KINDS[part.kind].pickable) buildingOfInstance.get(mesh)[index] = part.b
        })
        Object.values(meshes).forEach(mesh => {
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        })
    }

    const white = new Color('#FFFFFF')
    const flashColor = new Color()
    const paint = b => {
        if (b < 0 || b >= partsByBuilding.length) return
        partsByBuilding[b].forEach(part => {
            if (!KINDS[part.kind].pickable || part.isRoof || part.color === METAL) return
            let color = part.base
            if (b === hoverIndex) color = part.base.clone().lerp(white, 0.3)
            meshes[part.kind].setColorAt(part.index, color)
            meshes[part.kind].instanceColor.needsUpdate = true
        })
    }

    // Today's green roof popping in, on the same celebration run as the 2D dot.
    const CELEBRATION_SECONDS = 1.6
    const celebrationScale = now => {
        if (celebrationStart < 0) return 1
        const t = (now - celebrationStart) / CELEBRATION_SECONDS
        if (t >= 1) return 1
        if (t < 0.35) return (t / 0.35) * 1.6
        return 1.6 - 0.6 * ((t - 0.35) / 0.65)
    }

    const dummy = new Object3D()
    const updateBuildings = (now, t) => {
        if (!parts.length) return
        const pop = celebrationScale(now)
        parts.forEach(part => {
            const state = damageOf(part.b)
            const integrity = state ? state.integrity : 1
            const r = rise[part.b] * integrity
            let { w, d } = part
            let h = part.h * r
            let rotation = part.rot
            let jitterX = 0
            let jitterZ = 0
            if (state) {
                // Rooftop equipment is the first thing a hit knocks off.
                if (state.stripped && (part.kind === 'fan' || part.kind === 'spire' || part.kind === 'beacon')) h = 0
                if (state.collapsed && integrity < 0.02) h = 0
                const shake = Math.max(0, 1 - (now - state.shakeStart) / 0.35)
                if (shake > 0 && !reduceMotion) {
                    jitterX = Math.sin(now * 90 + part.b) * 0.06 * shake
                    jitterZ = Math.cos(now * 77 + part.b) * 0.06 * shake
                }
            }
            if (part.kind === 'fan' && !reduceMotion) rotation += t * part.spin
            if (part.kind === 'beacon') {
                const blink = reduceMotion ? 1 : 0.55 + 0.75 * Math.max(0, Math.sin(t * 2.6 + part.blink)) ** 6
                w *= blink
                d *= blink
                h = part.h * blink * (r > 0.98 ? 1 : 0)
            }
            if (part.isRoof && part.b === todayIndex && pop !== 1) {
                w *= pop
                d *= pop
            }
            dummy.position.set(part.x + jitterX, part.y * r, part.z + jitterZ)
            dummy.rotation.set(0, rotation, 0)
            dummy.scale.set(w, Math.max(h, 0.0001), d)
            dummy.updateMatrix()
            meshes[part.kind].setMatrixAt(part.index, dummy.matrix)
        })
        // Hit flash: the struck building blinks white and fades back to its colour.
        damage.forEach(state => {
            if (!state.flashing) return
            const b = days.findIndex(day => day.dateKey === state.dateKey)
            const amount = Math.max(0, 1 - (now - state.flashStart) / 0.22)
            if (b < 0) return
            if (amount <= 0) {
                state.flashing = false
                paint(b)
                return
            }
            partsByBuilding[b].forEach(part => {
                if (!KINDS[part.kind].pickable || part.isRoof || part.color === METAL) return
                flashColor.copy(part.base).lerp(white, amount * 0.85)
                meshes[part.kind].setColorAt(part.index, flashColor)
                meshes[part.kind].instanceColor.needsUpdate = true
            })
        })
        Object.values(meshes).forEach(mesh => {
            mesh.instanceMatrix.needsUpdate = true
        })
    }

    const stepRise = now => {
        if (!animating) return
        const t = now - animationStart
        let done = true
        for (let b = 0; b < rise.length; b++) {
            const progress = reduceMotion ? 1 : Math.min(1, Math.max(0, (t - riseDelay[b]) / RISE_DURATION))
            if (progress < 1) done = false
            // A little overshoot, so each building lands rather than stops.
            const eased = progress >= 1 ? 1 : 1 + 1.6 * Math.pow(progress - 1, 3) + 0.6 * Math.pow(progress - 1, 2)
            rise[b] = riseFrom[b] + (1 - riseFrom[b]) * eased
        }
        if (done) animating = false
    }

    // Today's marker: a small gold pin hovering over today's building.
    const marker = new Mesh(track(new ConeGeometry(0.16, 0.36, 4)), basic(HIGHLIGHT))
    marker.rotation.x = Math.PI
    marker.visible = false
    scene.add(marker)

    // ---------------------------------------------------------------- demolition effects
    // Three fixed pools (debris chunks, sparks, dust puffs) recycled round-robin, plus the rubble
    // left behind. Pools, not per-hit objects, so hammering the city never allocates.
    const makePool = (geometry, material, size, colored) => {
        const mesh = new InstancedMesh(geometry, material, size)
        mesh.frustumCulled = false
        if (colored) for (let i = 0; i < size; i++) mesh.setColorAt(i, new Color(PLOT))
        dummy.scale.set(0, 0, 0)
        dummy.updateMatrix()
        for (let i = 0; i < size; i++) mesh.setMatrixAt(i, dummy.matrix)
        scene.add(mesh)
        return { mesh, items: Array.from({ length: size }, () => ({ age: 1, life: 0 })), next: 0 }
    }
    const debris = makePool(unitBox, solidMaterial, 360, true)
    const sparks = makePool(unitSphere, basic(HIGHLIGHT), 90, false)
    const dust = makePool(
        unitSphere,
        track(
            new MeshBasicMaterial({
                color: new Color(colors.Grey300),
                transparent: true,
                opacity: 0.6,
                depthWrite: false,
            })
        ),
        140,
        false
    )
    const rubble = makePool(unitBox, solidMaterial, 91 * 6, true)
    const emit = (pool, item) => {
        const index = pool.next
        pool.next = (pool.next + 1) % pool.items.length
        pool.items[index] = { age: 0, ...item }
        if (item.color && pool.mesh.instanceColor) {
            pool.mesh.setColorAt(index, new Color(item.color))
            pool.mesh.instanceColor.needsUpdate = true
        }
        return index
    }
    const GRAVITY = 11
    const updatePools = dt => {
        ;[debris, sparks, dust].forEach(pool => {
            let changed = false
            pool.items.forEach((p, i) => {
                if (p.age >= p.life) {
                    if (!p.cleared) {
                        p.cleared = true
                        dummy.scale.set(0, 0, 0)
                        dummy.position.set(0, -10, 0)
                        dummy.updateMatrix()
                        pool.mesh.setMatrixAt(i, dummy.matrix)
                        changed = true
                    }
                    return
                }
                p.age += dt
                changed = true
                if (pool === dust) {
                    p.x += p.vx * dt
                    p.y += p.vy * dt
                    p.z += p.vz * dt
                    p.vx *= 0.94
                    p.vz *= 0.94
                    const k = p.age / p.life
                    const size = p.size * (0.4 + 0.9 * Math.sqrt(k)) * (1 - k * k)
                    dummy.position.set(p.x, p.y, p.z)
                    dummy.rotation.set(0, 0, 0)
                    dummy.scale.set(size, size, size)
                } else {
                    p.vy -= GRAVITY * (pool === sparks ? 0.35 : 1) * dt
                    p.x += p.vx * dt
                    p.y += p.vy * dt
                    p.z += p.vz * dt
                    if (p.y < 0) {
                        p.y = 0
                        p.vy *= -0.3
                        p.vx *= 0.55
                        p.vz *= 0.55
                        p.spin *= 0.5
                    }
                    p.rot += p.spin * dt
                    const fade = Math.min(1, (p.life - p.age) / 0.35)
                    const size = p.size * fade
                    dummy.position.set(p.x, p.y, p.z)
                    dummy.rotation.set(p.rot, p.rot * 0.7, p.rot * 0.3)
                    dummy.scale.set(size, size * (p.flat || 1), size)
                }
                dummy.updateMatrix()
                pool.mesh.setMatrixAt(i, dummy.matrix)
            })
            if (changed) pool.mesh.instanceMatrix.needsUpdate = true
        })
    }

    const burst = (b, strength, top) => {
        const day = days[b]
        const x = posX(day.week)
        const z = posZ(day.weekday)
        const color = buildingColors[b] || PLOT
        const chunks = Math.round(8 * strength)
        for (let i = 0; i < chunks; i++) {
            const angle = Math.random() * Math.PI * 2
            const speed = 1.2 + Math.random() * 2.4 * strength
            emit(debris, {
                x: x + (Math.random() - 0.5) * FOOTPRINT * 0.6,
                y: top * (0.6 + Math.random() * 0.4),
                z: z + (Math.random() - 0.5) * FOOTPRINT * 0.6,
                vx: Math.cos(angle) * speed,
                vy: 2 + Math.random() * 3.5 * strength,
                vz: Math.sin(angle) * speed,
                rot: Math.random() * 6,
                spin: (Math.random() - 0.5) * 18,
                size: 0.06 + Math.random() * 0.1,
                flat: 0.5 + Math.random() * 0.6,
                life: 1.4 + Math.random() * 0.9,
                color: Math.random() < 0.25 ? METAL : color,
            })
        }
        const sparkCount = Math.round(6 * strength)
        for (let i = 0; i < sparkCount; i++) {
            const angle = Math.random() * Math.PI * 2
            const speed = 2.5 + Math.random() * 3
            emit(sparks, {
                x,
                y: top,
                z,
                vx: Math.cos(angle) * speed,
                vy: 1 + Math.random() * 3,
                vz: Math.sin(angle) * speed,
                rot: 0,
                spin: 0,
                size: 0.05 + Math.random() * 0.04,
                life: 0.25 + Math.random() * 0.25,
            })
        }
    }

    const dustCloud = (b, amount) => {
        const day = days[b]
        const x = posX(day.week)
        const z = posZ(day.weekday)
        for (let i = 0; i < amount; i++) {
            const angle = (i / amount) * Math.PI * 2 + Math.random() * 0.4
            const speed = 0.8 + Math.random() * 1.4
            emit(dust, {
                x: x + Math.cos(angle) * 0.2,
                y: 0.1 + Math.random() * 0.4,
                z: z + Math.sin(angle) * 0.2,
                vx: Math.cos(angle) * speed,
                vy: 0.3 + Math.random() * 0.5,
                vz: Math.sin(angle) * speed,
                size: 0.35 + Math.random() * 0.35,
                life: 1.1 + Math.random() * 0.9,
            })
        }
    }

    const leaveRubble = b => {
        const day = days[b]
        const x = posX(day.week)
        const z = posZ(day.weekday)
        const color = buildingColors[b] || PLOT
        for (let i = 0; i < 6; i++) {
            const size = 0.12 + Math.random() * 0.16
            const index = emit(rubble, {
                life: Infinity,
                color: i % 3 === 0 ? METAL : color,
            })
            dummy.position.set(
                x + (Math.random() - 0.5) * FOOTPRINT * 0.7,
                0,
                z + (Math.random() - 0.5) * FOOTPRINT * 0.7
            )
            dummy.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4)
            dummy.scale.set(size, size * (0.4 + Math.random() * 0.5), size * (0.7 + Math.random() * 0.5))
            dummy.updateMatrix()
            rubble.mesh.setMatrixAt(index, dummy.matrix)
        }
        rubble.mesh.instanceMatrix.needsUpdate = true
    }

    const currentTop = b => getSkylineHeight(days[b].tasks, scale) * rise[b] * (damageOf(b) ? damageOf(b).integrity : 1)

    /** One tap on building `b`. */
    const hit = b => {
        const day = days[b]
        if (!day) return
        let state = damage.get(day.dateKey)
        if (!state) {
            const maxHitPoints = rollHitPoints(getBuildingType(day.tasks, scale))
            state = {
                dateKey: day.dateKey,
                hitPoints: maxHitPoints,
                maxHitPoints,
                integrity: 1,
                target: 1,
                shakeStart: -10,
                flashStart: -10,
                flashing: false,
                stripped: false,
                collapsed: false,
            }
            damage.set(day.dateKey, state)
        }
        if (state.collapsed) return
        const now = performance.now() / 1000
        const critical = Math.random() < CRITICAL_HIT_CHANCE
        const top = currentTop(b)
        state.hitPoints -= critical ? 2 : 1
        state.shakeStart = now
        state.flashStart = now
        state.flashing = true
        state.stripped = true
        state.target = getIntegrity(state.hitPoints, state.maxHitPoints)
        if (!reduceMotion) burst(b, critical ? 1.8 : 1, Math.max(top, 0.2))
        if (critical && !reduceMotion) cameraShake = Math.max(cameraShake, 0.12)
        if (state.hitPoints <= 0) {
            state.collapsed = true
            state.target = 0
            if (!reduceMotion) {
                burst(b, 2.4, Math.max(top, 0.2))
                dustCloud(b, 16)
                cameraShake = Math.max(cameraShake, 0.3)
            }
            leaveRubble(b)
            demolished += 1
            onDemolish(demolished)
        }
        if (reduceMotion) state.integrity = state.target
    }

    const stepDamage = dt => {
        damage.forEach(state => {
            if (state.integrity === state.target) return
            // A hit knocks floors off quickly; a collapse sinks a little slower, into its dust.
            const speed = state.collapsed ? 2.6 : 12
            const next = state.integrity + (state.target - state.integrity) * Math.min(1, dt * speed)
            state.integrity = Math.abs(next - state.target) < 0.002 ? state.target : next
        })
        cameraShake = Math.max(0, cameraShake - dt * 0.9)
    }

    // ---------------------------------------------------------------- life: cars
    // Cars on every road, both directions, driving on the right. Cars along the weeks use the
    // long east-west roads; cars along the days use the short north-south ones.
    const CAR_COUNT = 44
    const carRandom = seeded(97)
    const cars = Array.from({ length: CAR_COUNT }, (_, i) => {
        const alongX = carRandom() < 0.6
        const direction = carRandom() < 0.5 ? 1 : -1
        const road = alongX
            ? -CITY_HALF_DEPTH + Math.floor(carRandom() * (GRID_DAYS + 1)) * PITCH
            : -CITY_HALF_WIDTH + Math.floor(carRandom() * (SKYLINE_WEEKS + 1)) * PITCH
        return {
            alongX,
            direction,
            lane: road + direction * 0.11 * (alongX ? 1 : -1),
            half: alongX ? CITY_HALF_WIDTH : CITY_HALF_DEPTH,
            speed: 0.7 + carRandom() * 0.9,
            offset: carRandom() * 100,
            color: CAR_COLORS[i % CAR_COLORS.length],
        }
    })
    const carMesh = new InstancedMesh(unitBox, solidMaterial, CAR_COUNT)
    carMesh.frustumCulled = false
    cars.forEach((car, i) => carMesh.setColorAt(i, new Color(car.color)))
    carMesh.visible = !reduceMotion
    scene.add(carMesh)
    const updateCars = t => {
        cars.forEach((car, i) => {
            const span = car.half * 2
            const travelled = (car.offset + t * car.speed) % span
            const along = car.direction > 0 ? -car.half + travelled : car.half - travelled
            // Cars shrink in and out at the city limits instead of popping.
            const edge = Math.min(1, (car.half - Math.abs(along)) / 0.5)
            if (car.alongX) dummy.position.set(along, 0, car.lane)
            else dummy.position.set(car.lane, 0, along)
            dummy.rotation.set(0, car.alongX ? 0 : Math.PI / 2, 0)
            dummy.scale.set(0.3 * edge, 0.11 * edge, 0.15 * edge)
            dummy.updateMatrix()
            carMesh.setMatrixAt(i, dummy.matrix)
        })
        carMesh.instanceMatrix.needsUpdate = true
    }

    // ---------------------------------------------------------------- life: birds
    const wingGeometry = track(new BufferGeometry())
    wingGeometry.setAttribute(
        'position',
        new BufferAttribute(new Float32Array([0, 0, 0, 0.26, 0, 0.05, 0.05, 0, 0.13]), 3)
    )
    const birdMaterial = track(new MeshBasicMaterial({ color: new Color(BIRD), side: DoubleSide }))
    const birdRandom = seeded(211)
    // Deliberately sparse: the sky is the quiet part of the scene, the city is the busy one.
    const flocks = [0].map(f => {
        const members = Array.from({ length: 3 }, (_, i) => {
            const bird = new Group()
            const left = new Mesh(wingGeometry, birdMaterial)
            const right = new Mesh(wingGeometry, birdMaterial)
            left.scale.x = -1
            bird.add(left, right)
            bird.userData = {
                left,
                right,
                // V formation behind the leader.
                side: i === 0 ? 0 : i % 2 ? -1 : 1,
                rank: Math.ceil(i / 2),
                phase: birdRandom() * Math.PI * 2,
            }
            scene.add(bird)
            return bird
        })
        return {
            members,
            radiusX: CITY_HALF_WIDTH * (0.55 + f * 0.18),
            radiusZ: (2.2 + f * 0.9) * PITCH,
            speed: (0.12 + birdRandom() * 0.06) * (f % 2 ? -1 : 1),
            phase: birdRandom() * Math.PI * 2,
            altitude: 3.6 + f * 0.5,
        }
    })
    const updateBirds = t => {
        flocks.forEach(flock => {
            const angle = flock.phase + t * flock.speed
            const cx = Math.cos(angle) * flock.radiusX
            const cz = Math.sin(angle * 2) * flock.radiusZ * 0.5
            const vx = -Math.sin(angle) * flock.radiusX * flock.speed
            const vz = Math.cos(angle * 2) * flock.radiusZ * flock.speed
            const heading = Math.atan2(-vx, -vz)
            const forward = { x: Math.sin(heading) * -1, z: Math.cos(heading) * -1 }
            const sideways = { x: -forward.z, z: forward.x }
            flock.members.forEach(bird => {
                const { side, rank, phase, left, right } = bird.userData
                bird.position.set(
                    cx - forward.x * rank * 0.35 + sideways.x * side * rank * 0.3,
                    flock.altitude + Math.sin(t * 1.3 + phase) * 0.08,
                    cz - forward.z * rank * 0.35 + sideways.z * side * rank * 0.3
                )
                bird.rotation.set(0, heading, 0)
                const flap = 0.15 + 0.55 * Math.sin(t * 9 + phase)
                left.rotation.z = -flap
                right.rotation.z = flap
            })
        })
    }

    // ---------------------------------------------------------------- life: balloon
    const balloon = new Group()
    const envelope = new Mesh(track(new SphereGeometry(0.42, 20, 14)), basic(BALLOON))
    envelope.scale.y = 1.12
    envelope.position.y = 0.62
    const stripe = new Mesh(track(new TorusGeometry(0.42, 0.045, 8, 28)), basic(BALLOON_STRIPE))
    stripe.rotation.x = Math.PI / 2
    stripe.position.y = 0.62
    const basket = new Mesh(unitBox, basic(BASKET))
    basket.scale.set(0.16, 0.12, 0.16)
    balloon.add(envelope, stripe, basket)
    scene.add(balloon)
    const balloonShadow = new Mesh(track(new CircleGeometry(0.42, 24)), groundShadeMaterial)
    balloonShadow.rotation.x = -Math.PI / 2
    balloonShadow.position.y = 0.006
    scene.add(balloonShadow)
    // One slow crossing, then a long gap with an empty sky.
    const BALLOON_CROSSING = 55
    const BALLOON_LOOP = 150
    const updateBalloon = t => {
        const progress = ((t + 20) % BALLOON_LOOP) / BALLOON_CROSSING
        const crossing = progress <= 1
        balloon.visible = crossing
        balloonShadow.visible = crossing
        if (!crossing) return
        // Everything that flies stays over the city and fades in and out by scale, never by crossing
        // the canvas edge: something sliding in from nowhere would reveal the frame around the city.
        const x = (progress * 2 - 1) * (CITY_HALF_WIDTH - 1)
        const appear = Math.min(1, progress / 0.08, (1 - progress) / 0.08)
        balloon.scale.setScalar(appear)
        balloonShadow.scale.setScalar(appear)
        const z = -1.6 + Math.sin(t * 0.21) * 1.2
        balloon.position.set(x, 3.2 + Math.sin(t * 0.7) * 0.15, z)
        balloonShadow.position.set(x + 0.6, 0.006, z - 0.9)
    }

    // ---------------------------------------------------------------- life: airplane
    const airplane = new Group()
    const fuselage = new Mesh(unitBox, basic(AIRPLANE))
    fuselage.scale.set(0.14, 0.12, 0.95)
    fuselage.position.y = -0.06
    const wings = new Mesh(unitBox, basic(AIRPLANE))
    wings.scale.set(1.05, 0.03, 0.16)
    wings.position.set(0, -0.02, -0.05)
    const tailplane = new Mesh(unitBox, basic(AIRPLANE_TAIL))
    tailplane.scale.set(0.38, 0.03, 0.1)
    tailplane.position.set(0, 0, 0.4)
    const fin = new Mesh(unitBox, basic(AIRPLANE_TAIL))
    fin.scale.set(0.03, 0.2, 0.12)
    fin.position.set(0, 0, 0.4)
    airplane.add(fuselage, wings, tailplane, fin)
    scene.add(airplane)
    const airplaneShadow = new Group()
    const shadowBody = new Mesh(unitBox, groundShadeMaterial)
    shadowBody.scale.set(0.14, 0.001, 0.95)
    const shadowWings = new Mesh(unitBox, groundShadeMaterial)
    shadowWings.scale.set(1.05, 0.001, 0.16)
    shadowWings.position.z = -0.05
    airplaneShadow.add(shadowBody, shadowWings)
    scene.add(airplaneShadow)
    const FLIGHT_SECONDS = 16
    const FLIGHT_PAUSE = 45
    const updateAirplane = t => {
        const cycle = FLIGHT_SECONDS + FLIGHT_PAUSE
        const flightIndex = Math.floor(t / cycle)
        const progress = (t % cycle) / FLIGHT_SECONDS
        const flying = progress <= 1
        airplane.visible = flying
        airplaneShadow.visible = flying
        if (!flying) return
        const reverse = flightIndex % 2 === 1
        const span = CITY_HALF_WIDTH - 0.5
        const x = (reverse ? 1 - progress : progress) * span * 2 - span
        const appear = Math.min(1, progress / 0.1, (1 - progress) / 0.1)
        airplane.scale.setScalar(appear)
        airplaneShadow.scale.setScalar(appear)
        const drift = reverse ? -2 : 2.4
        const z = (reverse ? 1.8 : -2.6) + (progress - 0.5) * drift
        // Nose is local -z, the same convention as the birds.
        const vx = reverse ? -span * 2 : span * 2
        const heading = Math.atan2(-vx, -drift)
        airplane.position.set(x, 4.3, z)
        airplane.rotation.set(0, heading, 0)
        airplaneShadow.position.set(x + 0.6, 0.007, z - 0.8)
        airplaneShadow.rotation.set(0, heading, 0)
    }

    ;[balloon, balloonShadow, airplane, airplaneShadow].forEach(object => {
        object.visible = !reduceMotion
    })
    flocks.forEach(flock =>
        flock.members.forEach(bird => {
            bird.visible = !reduceMotion
        })
    )

    // ---------------------------------------------------------------- camera: the flight
    // The corners of everything that must stay in view: the city block incl. its outer roads, the
    // legends printed beside it, and the tallest building that could stand there.
    const boundsX = CITY_HALF_WIDTH + ROAD_WIDTH / 2 + 0.25 + 1.4
    const boundsZ = CITY_HALF_DEPTH + ROAD_WIDTH / 2 + 0.5 + 0.45
    const bounds = []
    ;[-1, 1].forEach(sx =>
        [-1, 1].forEach(sz => [0, TALLEST].forEach(y => bounds.push(new Vector3(sx * boundsX, y, sz * boundsZ))))
    )
    const target = new Vector3(0, TALLEST * 0.18, 0)
    const direction = new Vector3()
    const projected = new Vector3()
    const fits = distance => {
        camera.position.copy(target).addScaledVector(direction, distance)
        camera.lookAt(target)
        camera.updateMatrixWorld()
        return bounds.every(corner => {
            projected.copy(corner).project(camera)
            return Math.abs(projected.x) <= FRAME_MARGIN && Math.abs(projected.y) <= FRAME_MARGIN && projected.z < 1
        })
    }
    // Closest distance at which the whole city fits, by bisection (the fit is monotonic in distance).
    const fitDistance = () => {
        let near = 4
        let far = 200
        for (let i = 0; i < 22; i++) {
            const middle = (near + far) / 2
            if (fits(middle)) far = middle
            else near = middle
        }
        return far
    }
    let distance = null
    const placeCamera = t => {
        const { azimuth, elevation } = getOrbitView(reduceMotion ? null : t)
        direction.set(
            Math.cos(elevation) * Math.sin(azimuth),
            Math.sin(elevation),
            Math.cos(elevation) * Math.cos(azimuth)
        )
        const wanted = fitDistance()
        // Follow the fitted distance smoothly, but never sit closer than it: a lag in that direction
        // would clip the city for a moment.
        distance = distance == null ? wanted : Math.max(wanted, distance + (wanted - distance) * 0.05)
        camera.position.copy(target).addScaledVector(direction, distance)
        const shake = cameraShake * 0.35
        camera.lookAt(
            target.x + shake * Math.sin(t * 61),
            target.y + shake * Math.cos(t * 47),
            target.z + shake * Math.cos(t * 53)
        )
        camera.updateMatrixWorld()
    }

    const resize = () => {
        const width = container.clientWidth
        const height = container.clientHeight
        if (!width || !height) return
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        distance = null
    }

    // ---------------------------------------------------------------- interaction
    // Hover (mouse) and tap only. Page scrolling is never intercepted; the one event stopped here is
    // the click, so a tap on the city is not also a press on the card around it.
    const raycaster = new Raycaster()
    const pointerNdc = new Vector2()
    let downAt = null
    const pick = (clientX, clientY) => {
        const pickables = [...buildingOfInstance.keys()]
        if (!pickables.length) return -1
        const rect = canvas.getBoundingClientRect()
        pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
        raycaster.setFromCamera(pointerNdc, camera)
        const hit = raycaster.intersectObjects(pickables, false)[0]
        if (!hit || hit.instanceId == null) return -1
        const owner = buildingOfInstance.get(hit.object)[hit.instanceId]
        return owner == null ? -1 : owner
    }
    const setHover = index => {
        if (index === hoverIndex) return
        const previous = hoverIndex
        hoverIndex = index
        paint(previous)
        paint(index)
        canvas.style.cursor = index >= 0 && !(damageOf(index) && damageOf(index).collapsed) ? 'crosshair' : 'default'
        onHover(index)
    }
    const selectIndex = index => {
        const previous = selectedIndex
        selectedIndex = index
        paint(previous)
        paint(index)
    }
    const onPointerDown = event => {
        downAt = { x: event.clientX, y: event.clientY }
    }
    const onPointerMove = event => {
        if (event.pointerType === 'mouse') setHover(pick(event.clientX, event.clientY))
    }
    const onPointerUp = event => {
        if (!downAt) return
        const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y)
        downAt = null
        if (moved > 8) return
        const index = pick(event.clientX, event.clientY)
        selectIndex(index)
        onSelect(index)
        if (index >= 0) hit(index)
    }
    const onPointerCancel = () => {
        downAt = null
    }
    const onPointerLeave = event => {
        if (event.pointerType === 'mouse') setHover(-1)
    }
    const stopClick = event => event.stopPropagation()
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('click', stopClick)

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    if (resizeObserver) resizeObserver.observe(container)
    resize()

    // ---------------------------------------------------------------- loop
    // Only runs while the card is on screen: every frame reads the scroll position and moves the
    // traffic, which is exactly the work to skip when nobody can see the city.
    let frameId = 0
    let disposed = false
    let visible = true
    const startTime = performance.now() / 1000
    let lastFrame = startTime
    const frame = () => {
        frameId = 0
        if (disposed || !visible) return
        const now = performance.now() / 1000
        const dt = Math.min(0.05, now - lastFrame)
        lastFrame = now
        const t = reduceMotion ? FROZEN_TIME : now - startTime
        time.value = t
        stepRise(now)
        stepDamage(dt)
        updatePools(dt)
        updateBuildings(now, t)
        if (!reduceMotion) {
            updateCars(t)
            updateBirds(t)
            updateBalloon(t)
            updateAirplane(t)
        }
        const todayState = damageOf(todayIndex)
        marker.visible = false
        if (todayIndex >= 0 && !(todayState && todayState.collapsed)) {
            const day = days[todayIndex]
            const type = getBuildingType(day.tasks, scale)
            const top =
                (type === 'park' ? 0.2 : getSkylineHeight(day.tasks, scale) + (type === 'skyscraper' ? SPIRE : 0.2)) *
                rise[todayIndex] *
                (todayState ? todayState.integrity : 1)
            marker.visible = true
            marker.position.set(
                posX(day.week),
                top + 0.55 + (reduceMotion ? 0 : Math.sin(t * 2.2) * 0.1),
                posZ(day.weekday)
            )
            marker.rotation.y = reduceMotion ? 0 : t * 0.8
        }
        placeCamera(t)
        renderer.render(scene, camera)
        frameId = requestAnimationFrame(frame)
    }
    const startLoop = () => {
        if (!frameId && !disposed) frameId = requestAnimationFrame(frame)
    }
    const intersectionObserver =
        typeof IntersectionObserver !== 'undefined'
            ? new IntersectionObserver(entries => {
                  visible = entries.some(entry => entry.isIntersecting)
                  if (visible) startLoop()
              })
            : null
    if (intersectionObserver) intersectionObserver.observe(container)
    startLoop()

    return {
        /**
         * Replaces the city. A day whose task count did not change keeps standing; a changed or new
         * day grows again, so a statistics update animates only the buildings it affects.
         */
        setDays(nextDays, nextLabels) {
            const previous = new Map(days.map((day, b) => [day.dateKey, { tasks: day.tasks, rise: rise[b] }]))
            days = nextDays
            labels = nextLabels || labels
            scale = getSkylineScale(days)
            drawGround()
            ;({ list: parts, byBuilding: partsByBuilding } = buildParts())
            createMeshes()

            rise = new Float32Array(days.length)
            riseFrom = new Float32Array(days.length)
            riseDelay = new Float32Array(days.length)
            const firstBuild = previous.size === 0
            days.forEach((day, b) => {
                const before = previous.get(day.dateKey)
                const unchanged = before && before.tasks === day.tasks
                riseFrom[b] = unchanged ? before.rise : 0
                rise[b] = riseFrom[b]
                riseDelay[b] = reduceMotion || unchanged ? 0 : firstBuild ? day.week * 0.07 + day.weekday * 0.03 : 0
            })
            todayIndex = days.findIndex(day => day.isToday)
            if (selectedIndex >= days.length) selectedIndex = -1
            hoverIndex = -1
            days.forEach((_, b) => paint(b))
            animationStart = performance.now() / 1000
            animating = true
            updateBuildings(animationStart, time.value)
            startLoop()
        },
        select(index) {
            selectIndex(index)
        },
        celebrateToday() {
            if (!reduceMotion) celebrationStart = performance.now() / 1000
        },
        destroy() {
            disposed = true
            if (frameId) cancelAnimationFrame(frameId)
            if (resizeObserver) resizeObserver.disconnect()
            if (intersectionObserver) intersectionObserver.disconnect()
            canvas.removeEventListener('pointerdown', onPointerDown)
            canvas.removeEventListener('pointermove', onPointerMove)
            canvas.removeEventListener('pointerup', onPointerUp)
            canvas.removeEventListener('pointercancel', onPointerCancel)
            canvas.removeEventListener('pointerleave', onPointerLeave)
            canvas.removeEventListener('click', stopClick)
            disposeBuildingMeshes()
            carMesh.dispose()
            ;[debris, sparks, dust, rubble].forEach(pool => pool.mesh.dispose())
            disposables.forEach(item => item.dispose())
            renderer.dispose()
            if (renderer.forceContextLoss) renderer.forceContextLoss()
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
        },
    }
}
