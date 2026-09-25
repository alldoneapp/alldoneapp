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
    WebGLRenderer,
} from 'three'

import { colors } from '../../../../styles/global'
import {
    getBuildingType,
    getFlyoverView,
    getSkylineColor,
    getSkylineHeight,
    getSkylineScale,
    SKYLINE_MAX_HEIGHT,
    SKYLINE_MAX_TILT,
    SKYLINE_WEEKS,
} from './skylineData'

/**
 * The imperative half of the Empty inbox skyline: a small living city on the white achievements
 * card, one building per day of the last quarter, seen from a plane flying over it.
 *
 * Three layers, each with one job:
 *
 *  - THE GROUND is printed on the card. The camera is an off-axis projection that always looks
 *    straight down and slides with the page scroll; its frustum is re-aimed every frame so the
 *    ground plane lands on the same pixels. Plots, streets and the month/weekday legend therefore
 *    never move — only what stands up from the ground leans.
 *  - THE BUILDINGS say how busy a day was, by height, colour (the app's blue ramp) and TYPE
 *    (`getBuildingType`): a little park for a day with nothing done, then a house, a mid-rise with a
 *    spinning rooftop fan, a stepped tower, and a skyscraper with an antenna and a beacon. A green
 *    roof (the 2D grid's UtilityGreen200) marks an empty-inbox day.
 *  - THE LIFE is decoration only and carries no data: a soft light sweep up the facades, cloud
 *    shadows drifting over the city, cars on the streets, flocks of birds, a hot-air balloon and a
 *    small plane with its shadow. None of it is interactive, and all of it stops for reduced motion.
 *
 * Every colour is an app colour. The canvas is transparent, so the card's own white is the sky.
 * Loaded through a dynamic `import()` from `EmptyInboxSkyline`, so three.js is its own chunk.
 */

const FOOTPRINT = 0.72
const GRID_DAYS = 7
const MARGIN_X = 2.6
const MARGIN_Z = 2.4
const GROUND_PX_PER_UNIT = 64
const RISE_DURATION = 1.1
const CAMERA_HEIGHT = 24
const SPIRE = 0.7
// Tallest thing that can stand on a plot: the highest building plus spire and beacon. Used to
// reserve room so nothing ever pokes out of the card.
const TALLEST = SKYLINE_MAX_HEIGHT * 1.15 + 0.1 + SPIRE + 0.12
const REDUCED_MOTION_PROGRESS = 0.5
const FROZEN_TIME = 20

const PLOT = colors.Grey200
const PARK = colors.UtilityGreen100
const TREE = colors.UtilityGreen125
const SHADOW = colors.Grey300
const LABEL = colors.Text03
const INBOX_GREEN = colors.UtilityGreen200
const HIGHLIGHT = colors.UtilityYellow200
const ROOF_DARK = colors.Primary400
const METAL = colors.Grey400
const BEACON = colors.UtilityOrange200
const BIRD = colors.Text02
const BALLOON = colors.UtilityYellow200
const BALLOON_STRIPE = colors.UtilityOrange200
const BASKET = colors.Secondary300
const AIRPLANE = colors.Secondary200
const AIRPLANE_TAIL = colors.Primary100
const GROUND_SHADE = colors.Text01
const CAR_COLORS = [
    colors.UtilityYellow200,
    colors.Primary100,
    colors.UtilityOrange200,
    colors.Secondary100,
    colors.Grey400,
    colors.UtilityGreen200,
]

const posX = week => week - (SKYLINE_WEEKS - 1) / 2
const posZ = weekday => weekday - (GRID_DAYS - 1) / 2
const CITY_HALF_WIDTH = SKYLINE_WEEKS / 2 + 0.5

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

const NOISE_GLSL = `
    uniform float uTime;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float cloudShadow(vec2 p) {
        p = p * 0.16 + vec2(uTime * 0.03, uTime * 0.011);
        float n = noise(p) * 0.65 + noise(p * 2.3 + 3.7) * 0.35;
        return smoothstep(0.55, 0.8, n);
    }`

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

// Soft, matte shading; a slow band of light sweeping up the facades (one per building, each on its
// own phase, so the city shimmers rather than flashes); and the drifting cloud shadows.
const solidFragmentShader = `
    uniform float uMotion;
    varying vec3 vWorld; varying vec3 vN; varying vec3 vColor; varying float vLocalY; varying vec2 vOrigin;
    ${NOISE_GLSL}
    void main() {
        vec3 n = normalize(vN);
        vec3 light = normalize(vec3(-0.35, 1.0, 0.45));
        float diff = max(dot(n, light), 0.0);
        vec3 col = vColor * (0.64 + 0.36 * diff);
        float side = 1.0 - step(0.6, n.y);
        float band = fract(uTime * 0.08 + hash(floor(vOrigin * 2.0 + 0.5))) * 3.4 - 1.2;
        float sheen = smoothstep(0.14, 0.0, abs(vLocalY - band)) * side * uMotion;
        col = mix(col, vec3(1.0), sheen * 0.24);
        col *= 1.0 - cloudShadow(vWorld.xz) * 0.13;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
    }`

const cloudVertexShader = `
    varying vec3 vWorld;
    void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
    }`

const cloudFragmentShader = `
    uniform vec3 uShade;
    varying vec3 vWorld;
    ${NOISE_GLSL}
    void main() {
        gl_FragColor = vec4(uShade, cloudShadow(vWorld.xz) * 0.08);
        #include <colorspace_fragment>
    }`

/**
 * @param {HTMLElement} container an empty element the canvas is appended to; it must have a size
 * @param {Object} options
 * @param {(index: number) => void} options.onHover  -1 when the pointer leaves every building
 * @param {(index: number) => void} options.onSelect -1 for a tap on empty ground
 * @param {boolean} options.reduceMotion
 */
export function createSkylineScene(container, { onHover, onSelect, reduceMotion = false }) {
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
    const camera = new PerspectiveCamera(30, 1, 1, 80)
    // Screen-up is "back" in the city, so the view reads weeks left to right and Monday..Sunday top
    // to bottom, like the 2D grid it replaces.
    camera.up.set(0, 0, -1)

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
    const groundWidth = SKYLINE_WEEKS + MARGIN_X * 2
    const groundDepth = GRID_DAYS + MARGIN_Z * 2
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

    // Cloud shadows passing over the ground (the buildings darken by the same function).
    const cloudLayer = new Mesh(
        track(new PlaneGeometry(groundWidth + 8, groundDepth + 8)),
        track(
            new ShaderMaterial({
                uniforms: { uTime: time, uShade: { value: new Color(colors.Secondary300) } },
                vertexShader: cloudVertexShader,
                fragmentShader: cloudFragmentShader,
                transparent: true,
                depthWrite: false,
            })
        )
    )
    cloudLayer.rotation.x = -Math.PI / 2
    cloudLayer.position.y = 0.004
    scene.add(cloudLayer)

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
        // Contact shadows under the buildings, longer for taller ones.
        context.fillStyle = SHADOW
        days.forEach(day => {
            if (day.tasks <= 0) return
            const length = Math.min(1, getSkylineHeight(day.tasks, scale) / SKYLINE_MAX_HEIGHT) * 0.4 * px
            roundRect(
                cx(posX(day.week)) - plot / 2 + length * 0.45,
                cz(posZ(day.weekday)) - plot / 2 - length,
                plot,
                plot
            )
        })
        // Every plot of the quarter; parks for the days nothing got done, empty plots for the rest
        // of the current week.
        const byCell = new Map(days.map(day => [`${day.week}:${day.weekday}`, day]))
        for (let week = 0; week < SKYLINE_WEEKS; week++) {
            for (let weekday = 0; weekday < GRID_DAYS; weekday++) {
                const day = byCell.get(`${week}:${weekday}`)
                context.fillStyle = day && day.tasks <= 0 ? PARK : PLOT
                roundRect(cx(posX(week)) - plot / 2, cz(posZ(weekday)) - plot / 2, plot, plot)
            }
        }
        context.fillStyle = LABEL
        context.textBaseline = 'middle'
        const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        context.textAlign = 'left'
        context.font = `500 ${0.42 * px}px ${font}`
        labels.months.forEach(({ week, text }) => {
            context.fillText(text, cx(posX(week) - FOOTPRINT / 2), cz(posZ(GRID_DAYS - 1) + 1.0))
        })
        context.textAlign = 'right'
        context.font = `500 ${0.34 * px}px ${font}`
        labels.weekdays.forEach(({ weekday, text }) => {
            context.fillText(text, cx(posX(0) - 0.7), cz(posZ(weekday)))
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
        spire: { geometry: unitCylinder, material: solidMaterial, colored: true },
        roof: { geometry: unitBox, material: roofMaterial },
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

    const disposeBuildingMeshes = () => {
        Object.values(meshes).forEach(mesh => {
            scene.remove(mesh)
            mesh.dispose()
        })
        meshes = {}
    }

    const buildParts = () => {
        const list = []
        const byBuilding = days.map(() => [])
        days.forEach((day, b) => {
            const x = posX(day.week)
            const z = posZ(day.weekday)
            const type = getBuildingType(day.tasks, scale)
            const height = getSkylineHeight(day.tasks, scale)
            const color = getSkylineColor(day.tasks, scale)
            const random = seeded(day.week * 31 + day.weekday * 7 + 11)
            const add = (kind, part) => {
                const entry = { kind, b, x, z, y: 0, rot: 0, ...part }
                list.push(entry)
                byBuilding[b].push(entry)
                return entry
            }
            const F = FOOTPRINT
            const greenRoof = (w, top) => {
                if (day.achieved) add('roof', { y: top, w: w + 0.03, h: 0.05, d: w + 0.03, isRoof: true })
            }
            if (type === 'park') {
                // A flat plaza (so the day can still be hovered and tapped) with a few trees.
                add('box', { w: F, h: 0.03, d: F, color: PARK })
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
                greenRoof(F, 0.03)
                return
            }
            if (type === 'house') {
                const body = Math.max(0.26, height - 0.28)
                add('box', { w: F * 0.84, h: body, d: F * 0.84, color })
                const roofColor = day.achieved
                    ? INBOX_GREEN
                    : new Color(color).lerp(new Color(ROOF_DARK), 0.45).getHexString()
                add('pyramid', {
                    y: body,
                    w: F * 0.92,
                    h: 0.28,
                    d: F * 0.92,
                    color: day.achieved ? INBOX_GREEN : `#${roofColor}`,
                    rot: random() < 0.5 ? 0 : Math.PI / 2,
                    isRoof: day.achieved,
                })
                return
            }
            if (type === 'midrise') {
                add('box', { w: F, h: height, d: F, color })
                greenRoof(F, height)
                const unit = F * 0.34
                const ux = x + (random() - 0.5) * F * 0.3
                const uz = z + (random() - 0.5) * F * 0.3
                add('box', { x: ux, z: uz, y: height + 0.05, w: unit, h: 0.12, d: unit, color: METAL })
                add('fan', {
                    x: ux,
                    z: uz,
                    y: height + 0.17,
                    w: unit * 0.95,
                    h: 0.015,
                    d: 0.05,
                    spin: 2 + random() * 2,
                    rot: random() * Math.PI,
                })
                return
            }
            if (type === 'tower') {
                const split = height * 0.7
                add('box', { w: F * 0.92, h: split, d: F * 0.92, color })
                add('box', { y: split, w: F * 0.66, h: height - split, d: F * 0.66, color })
                greenRoof(F * 0.66, height)
                add('box', { y: height + 0.05, w: F * 0.34, h: 0.14, d: F * 0.34, color: METAL })
                return
            }
            // skyscraper
            const first = height * 0.42
            const second = height * 0.82
            add('box', { w: F, h: first, d: F, color })
            add('box', { y: first, w: F * 0.76, h: second - first, d: F * 0.76, color })
            add('box', { y: second, w: F * 0.54, h: height - second, d: F * 0.54, color })
            greenRoof(F * 0.54, height)
            add('spire', { y: height, w: 0.05, h: SPIRE, d: 0.05, color: METAL })
            add('beacon', { y: height + SPIRE - 0.03, w: 0.12, h: 0.12, d: 0.12, blink: random() * Math.PI * 2 })
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
    const highlight = new Color(HIGHLIGHT)
    const paint = b => {
        if (b < 0 || b >= partsByBuilding.length) return
        partsByBuilding[b].forEach(part => {
            if (!KINDS[part.kind].pickable || part.isRoof || part.color === METAL) return
            let color = part.base
            if (b === selectedIndex) color = highlight
            else if (b === hoverIndex) color = part.base.clone().lerp(white, 0.35)
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
            const r = rise[part.b]
            let { w, d } = part
            let h = part.h * r
            let rotation = part.rot
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
            dummy.position.set(part.x, part.y * r, part.z)
            dummy.rotation.set(0, rotation, 0)
            dummy.scale.set(w, Math.max(h, 0.0001), d)
            dummy.updateMatrix()
            meshes[part.kind].setMatrixAt(part.index, dummy.matrix)
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

    // ---------------------------------------------------------------- life: cars
    const CAR_COUNT = 16
    const carRandom = seeded(97)
    const cars = Array.from({ length: CAR_COUNT }, (_, i) => {
        const street = Math.floor(carRandom() * (GRID_DAYS - 1))
        const direction = carRandom() < 0.5 ? 1 : -1
        return {
            z: posZ(street) + 0.5 + direction * 0.045,
            direction,
            speed: 0.55 + carRandom() * 0.6,
            offset: carRandom() * CITY_HALF_WIDTH * 2,
            color: CAR_COLORS[i % CAR_COLORS.length],
        }
    })
    const carMesh = new InstancedMesh(unitBox, solidMaterial, CAR_COUNT)
    carMesh.frustumCulled = false
    cars.forEach((car, i) => carMesh.setColorAt(i, new Color(car.color)))
    carMesh.visible = !reduceMotion
    scene.add(carMesh)
    const updateCars = t => {
        const span = CITY_HALF_WIDTH * 2
        cars.forEach((car, i) => {
            const travelled = (car.offset + t * car.speed) % span
            const x = car.direction > 0 ? -CITY_HALF_WIDTH + travelled : CITY_HALF_WIDTH - travelled
            // Cars shrink in and out at the city limits instead of popping.
            const edge = Math.min(1, (CITY_HALF_WIDTH - Math.abs(x)) / 0.5)
            dummy.position.set(x, 0, car.z)
            dummy.rotation.set(0, 0, 0)
            dummy.scale.set(0.24 * edge, 0.09 * edge, 0.1 * edge)
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
    const flocks = [0, 1, 2].map(f => {
        const members = Array.from({ length: 5 }, (_, i) => {
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
            radiusZ: 2.2 + f * 0.9,
            speed: (0.12 + birdRandom() * 0.06) * (f % 2 ? -1 : 1),
            phase: birdRandom() * Math.PI * 2,
            altitude: 6.2 + f * 0.9,
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
    const BALLOON_LOOP = 70
    const updateBalloon = t => {
        const progress = (t % BALLOON_LOOP) / BALLOON_LOOP
        const x = -CITY_HALF_WIDTH - 2 + progress * (CITY_HALF_WIDTH * 2 + 4)
        const z = -1.6 + Math.sin(t * 0.21) * 1.2
        balloon.position.set(x, 5 + Math.sin(t * 0.7) * 0.18, z)
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
    const FLIGHT_PAUSE = 12
    const updateAirplane = t => {
        const cycle = FLIGHT_SECONDS + FLIGHT_PAUSE
        const flightIndex = Math.floor(t / cycle)
        const progress = (t % cycle) / FLIGHT_SECONDS
        const flying = progress <= 1
        airplane.visible = flying
        airplaneShadow.visible = flying
        if (!flying) return
        const reverse = flightIndex % 2 === 1
        const span = CITY_HALF_WIDTH + 6
        const x = (reverse ? 1 - progress : progress) * span * 2 - span
        const drift = reverse ? -2 : 2.4
        const z = (reverse ? 1.8 : -2.6) + (progress - 0.5) * drift
        // Nose is local -z, the same convention as the birds.
        const vx = reverse ? -span * 2 : span * 2
        const heading = Math.atan2(-vx, -drift)
        airplane.position.set(x, 8.5, z)
        airplane.rotation.set(0, heading, 0)
        airplaneShadow.position.set(x + 1.2, 0.007, z - 1.6)
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

    // ---------------------------------------------------------------- camera: the flyover
    // Off-axis projection: the camera looks straight down and slides parallel to the ground as the
    // page scrolls; the frustum is re-aimed so y = 0 always maps to the same pixels. See the file
    // header for why this — and not an orbiting camera — is what makes the city part of the card.
    let viewWidth = SKYLINE_WEEKS + MARGIN_X * 2
    let viewDepth = GRID_DAYS + MARGIN_Z * 2
    let flight = null
    const readScrollProgress = () => {
        if (reduceMotion) return REDUCED_MOTION_PROGRESS
        const rect = container.getBoundingClientRect()
        const viewport = window.innerHeight || document.documentElement.clientHeight || 1
        return (rect.top + rect.height / 2) / viewport
    }
    const placeCamera = () => {
        const wanted = getFlyoverView(readScrollProgress())
        if (!flight || reduceMotion) flight = { ...wanted }
        else flight.tilt += (wanted.tilt - flight.tilt) * 0.12
        const offsetZ = CAMERA_HEIGHT * Math.tan(flight.tilt)
        camera.position.set(0, CAMERA_HEIGHT, offsetZ)
        camera.lookAt(0, 0, offsetZ)
        const toNear = camera.near / CAMERA_HEIGHT
        camera.projectionMatrix.makePerspective(
            (-viewWidth / 2) * toNear,
            (viewWidth / 2) * toNear,
            (viewDepth / 2 + offsetZ) * toNear,
            (-viewDepth / 2 + offsetZ) * toNear,
            camera.near,
            camera.far
        )
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    }

    const resize = () => {
        const width = container.clientWidth
        const height = container.clientHeight
        if (!width || !height) return
        renderer.setSize(width, height, false)
        const aspect = width / height
        // Seen from above a roof sits further out than its base (by k = H / (H - h)), and at the
        // steepest tilt it is pushed further by the camera offset times (k - 1). Reserve both for
        // the tallest possible building, plus the legends, so nothing ever reaches the card edge.
        const k = CAMERA_HEIGHT / (CAMERA_HEIGHT - TALLEST)
        const maxOffset = CAMERA_HEIGHT * Math.tan(SKYLINE_MAX_TILT)
        const outerWeek = (SKYLINE_WEEKS - 1) / 2 + FOOTPRINT / 2
        const outerRow = (GRID_DAYS - 1) / 2 + FOOTPRINT / 2
        const weekdayLegend = (SKYLINE_WEEKS - 1) / 2 + 0.7 + 1.3
        const monthLegend = (GRID_DAYS - 1) / 2 + 1.0 + 0.45
        const neededWidth = 2 * Math.max(outerWeek * k + 0.3, weekdayLegend)
        const neededDepth = 2 * Math.max(outerRow * k + maxOffset * (k - 1) + 0.3, monthLegend)
        viewWidth = Math.max(neededWidth, neededDepth * aspect)
        viewDepth = viewWidth / aspect
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
        canvas.style.cursor = index >= 0 ? 'pointer' : 'default'
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
    const frame = () => {
        frameId = 0
        if (disposed || !visible) return
        const now = performance.now() / 1000
        const t = reduceMotion ? FROZEN_TIME : now - startTime
        time.value = t
        stepRise(now)
        updateBuildings(now, t)
        if (!reduceMotion) {
            updateCars(t)
            updateBirds(t)
            updateBalloon(t)
            updateAirplane(t)
        }
        if (todayIndex >= 0) {
            const day = days[todayIndex]
            const type = getBuildingType(day.tasks, scale)
            const top =
                (type === 'park' ? 0.2 : getSkylineHeight(day.tasks, scale) + (type === 'skyscraper' ? SPIRE : 0.2)) *
                rise[todayIndex]
            marker.visible = true
            marker.position.set(
                posX(day.week),
                top + 0.55 + (reduceMotion ? 0 : Math.sin(t * 2.2) * 0.1),
                posZ(day.weekday)
            )
            marker.rotation.y = reduceMotion ? 0 : t * 0.8
        }
        placeCamera()
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
            disposables.forEach(item => item.dispose())
            renderer.dispose()
            if (renderer.forceContextLoss) renderer.forceContextLoss()
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
        },
    }
}
