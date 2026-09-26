import {
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    Color,
    ConeGeometry,
    CylinderGeometry,
    DirectionalLight,
    DoubleSide,
    Group,
    HemisphereLight,
    InstancedMesh,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    NeutralToneMapping,
    AdditiveBlending,
    Object3D,
    PCFShadowMap,
    PMREMGenerator,
    Quaternion,
    PerspectiveCamera,
    PlaneGeometry,
    Raycaster,
    Scene,
    SphereGeometry,
    SRGBColorSpace,
    TorusGeometry,
    Vector2,
    Vector3,
    WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import { colors } from '../../../../styles/global'
import {
    CRITICAL_HIT_CHANCE,
    getBuildingType,
    getDaylight,
    getIntegrity,
    rollHitPoints,
    getOrbitView,
    getProjectColorAt,
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
 *    spinning rooftop fan, a stepped tower, and a skyscraper with an antenna and a beacon. An empty-inbox
 *    day plants a small gold flag on the building's highest point, waving in the wind. (It used
 *    to be a green roof, which clashed as soon as buildings took their projects' colours — a green
 *    project's building was indistinguishable from an inbox-zero one. A flag on a pole reads the
 *    same on any colour.)
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
const FRAME_MARGIN = 0.94
const SPIRE = 0.7
// Tallest thing that can stand on a plot: the highest building plus spire and beacon. Used to
// reserve room so nothing ever pokes out of the card.
const TALLEST = SKYLINE_MAX_HEIGHT * 1.15 + 0.1 + SPIRE + 0.12
const FROZEN_TIME = 20

// Ground. Light, slightly warm concrete for pavements, a pale asphalt, real grass — muted enough to
// sit on the white card, realistic enough to read as a city.
const PLOT = '#ECEAE5'
const CURB = '#D8D5CE'
const ROAD = '#C9CDD1'
const ASPHALT_SPECKLE = 'rgba(90,96,104,0.06)'
const LANE = '#FFFFFF'
const PARK = '#B9D3A6'
const PARK_SPECKLE = 'rgba(70,120,60,0.10)'
const LABEL = colors.Text03
const FLAG = colors.UtilityYellow200
const FLAG_POLE = colors.Text02
const FLAG_POLE_HEIGHT = 0.55
const HIGHLIGHT = colors.UtilityYellow200
const METAL = '#9AA1A8'
const ROOF_CAP = '#A7ADB3'
const WATER_TANK = '#8F7F70'
const COPPER = '#7FA697'
const BEACON = colors.UtilityOrange200
const BIRD = colors.Text02
const BALLOON = colors.UtilityYellow200
const BALLOON_STRIPE = colors.UtilityOrange200
const BASKET = colors.Secondary300
const AIRPLANE = colors.Secondary200
const AIRPLANE_TAIL = colors.Primary100
const LAMP_POST = '#6E757C'
const LAMP_LIGHT = colors.UtilityYellow150
// Night lights. Warm white for lamps and headlights, red for tail and port lights, green starboard.
const WARM_LIGHT = colors.UtilityYellow100
const TAIL_LIGHT = colors.Red200
const PORT_LIGHT = colors.Red200
const STARBOARD_LIGHT = colors.UtilityGreen200
const HELICOPTER = colors.Secondary300
// Trees: trunk and three canopy greens.
const TRUNK = '#7A6552'
const CANOPY = ['#6E9F62', '#7FAE6E', '#5E8F57']

// Facades: real building materials. Stone, plaster and brick for the low and mid-rise city, tinted
// glass for the towers. The data speaks through height; the projects speak through small touches
// (lobby bands, awnings, small roofs, tower bands, bridges) in their own colours.
const MASONRY_PALETTE = ['#EDE8DF', '#E3DDD2', '#D9D2C5', '#F2F0EB', '#CDBBA6', '#B98B72', '#E6E1D8']
const GLASS_PALETTE = ['#8FA6BF', '#9AAFC4', '#7F96B0', '#A7B7C8', '#8A9DB3']
// Accents when the day has no second project to lend its colour.
const NEUTRAL_ACCENT = ['#6F7A86', '#8C7B6B', '#5F6F7F']
const CAR_COLORS = ['#F4F4F2', '#2B2F36', '#B7BCC2', '#2D4A7A', '#A63D3D', '#D9D6CF', '#44505C']
const CAR_GLASS = '#3A4350'

const STRIPPED_KINDS = new Set(['fan', 'spire', 'beacon', 'flag', 'flagPole', 'tank'])

// Laid out like a calendar page: weekdays are the columns (x), weeks the rows (z), the oldest week
// furthest from the camera and the current week nearest to it.
const COLUMNS = GRID_DAYS
const ROWS = SKYLINE_WEEKS
const colX = column => (column - (COLUMNS - 1) / 2) * PITCH
const rowZ = row => (row - (ROWS - 1) / 2) * PITCH
const cellX = day => colX(day.weekday)
const cellZ = day => rowZ(day.week)
// Roads run along the outside of the city too, so these are the centre lines of the outer roads.
const CITY_HALF_WIDTH = (COLUMNS * PITCH) / 2
const CITY_HALF_DEPTH = (ROWS * PITCH) / 2

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

// Architectural detail for the buildings' ordinary lit material, injected rather than written as a
// custom shader so they keep three's lighting and shadows: faint floor lines on the facades (no
// windows — lit windows read as noise at this size) and a soft darkening where walls meet the ground,
// which is most of what makes a block look like it stands on the street rather than floats on it.
const FACADE_VERTEX = `
    vec4 facadeWorld = vec4(transformed, 1.0);
    vec3 facadeNormal = objectNormal;
    #ifdef USE_INSTANCING
        facadeWorld = instanceMatrix * facadeWorld;
        facadeNormal = mat3(instanceMatrix) * facadeNormal;
    #endif
    vFacadeWorld = (modelMatrix * facadeWorld).xyz;
    vFacadeNormal = normalize(mat3(modelMatrix) * facadeNormal);`
// Two facade styles on the same idea. MASONRY: punched windows in a wall, deep and regular. GLASS:
// a curtain wall — nearly all window, thin mullions, a darker spandrel band at each floor. In both,
// the windows are a real reflective glass surface (low roughness, some metalness, so they pick up
// the environment and the sun), the wall darkens a little where it meets the street, and at night a
// seeded share of the windows glows warm.
const facadeFragment = style => `
    float facadeSide = 1.0 - step(0.6, abs(vFacadeNormal.y));
    float wallOnly = 1.0 - step(0.2, abs(vFacadeNormal.y));
    float across = abs(vFacadeNormal.x) > abs(vFacadeNormal.z) ? vFacadeWorld.z : vFacadeWorld.x;
    vec2 windowCell = vec2(across / ${style === 'glass' ? '0.13' : '0.16'}, vFacadeWorld.y / 0.25);
    vec2 windowIn = fract(windowCell);
    ${
        style === 'glass'
            ? 'float windowMask = step(0.07, windowIn.x) * step(windowIn.x, 0.93) * step(0.2, windowIn.y) * step(windowIn.y, 0.94);'
            : 'float windowMask = step(0.26, windowIn.x) * step(windowIn.x, 0.74) * step(0.24, windowIn.y) * step(windowIn.y, 0.74);'
    }
    windowMask *= wallOnly * step(0.2, vFacadeWorld.y);
    float groundOcclusion = mix(0.7, 1.0, smoothstep(0.0, 0.5, vFacadeWorld.y));
    diffuseColor.rgb *= mix(1.0, groundOcclusion, facadeSide);
    ${
        style === 'glass'
            ? 'diffuseColor.rgb = mix(diffuseColor.rgb * 0.82, diffuseColor.rgb * 0.62, windowMask);'
            : 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.23, 0.29), windowMask * 0.85);'
    }
    float windowLit = step(0.64, fract(sin(dot(floor(windowCell) + floor(vFacadeWorld.xz * 1.3) * 7.0, vec2(127.1, 311.7))) * 43758.5453));`
const FACADE_SURFACE = `
    roughnessFactor = mix(roughnessFactor, 0.12, windowMask);
    metalnessFactor = mix(metalnessFactor, 0.55, windowMask);`
// Added to the emitted light, so a lit window glows independently of how the wall is lit.
const WINDOW_GLOW_FRAGMENT = `
    totalEmissiveRadiance += uWindowColor * windowMask * windowLit * uWindowGlow * 1.4;`
const windowGlow = { value: 0 }
const windowColor = { value: new Color(colors.UtilityYellow150) }
const withFacadeDetail = (material, style) => {
    material.onBeforeCompile = shader => {
        shader.uniforms.uWindowGlow = windowGlow
        shader.uniforms.uWindowColor = windowColor
        shader.vertexShader = shader.vertexShader
            .replace('void main() {', 'varying vec3 vFacadeWorld;\nvarying vec3 vFacadeNormal;\nvoid main() {')
            .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${FACADE_VERTEX}`)
        shader.fragmentShader = shader.fragmentShader
            .replace(
                'void main() {',
                'uniform float uWindowGlow;\nuniform vec3 uWindowColor;\nvarying vec3 vFacadeWorld;\nvarying vec3 vFacadeNormal;\nvoid main() {'
            )
            .replace('#include <color_fragment>', `#include <color_fragment>\n${facadeFragment(style)}`)
            .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FACADE_SURFACE}`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${WINDOW_GLOW_FRAGMENT}`)
    }
    material.customProgramCacheKey = () => `facade-${style}`
    return material
}

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
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    // Neutral tone mapping keeps the palette honest while rolling highlights off softly.
    renderer.toneMapping = NeutralToneMapping
    renderer.toneMappingExposure = 1
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

    // Physically based materials (colour comes per instance). Masonry is matte stone and plaster;
    // glass is smoother and a little metallic so the towers pick up the sky; both get the facade
    // detail. Props (trees, cars, rubble) are plain.
    const masonryMaterial = track(
        withFacadeDetail(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 }), 'masonry')
    )
    const glassMaterial = track(
        withFacadeDetail(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.3 }), 'glass')
    )
    const propMaterial = track(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0 }))
    const basic = color => track(new MeshBasicMaterial({ color: new Color(color) }))
    // The flag's geometry has its origin at the pole edge, so it waves around the pole.
    const unitFlag = track(new BoxGeometry(1, 1, 1))
    unitFlag.translate(0.5, 0.5, 0)
    const fanMaterial = basic(METAL)
    const beaconMaterial = basic(BEACON)

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
        track(new MeshStandardMaterial({ map: groundTexture, transparent: true, roughness: 0.95, metalness: 0 }))
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    // ---------------------------------------------------------------- light: the time of day
    // Three sources. An environment (three's neutral studio room, prefiltered) gives soft ambient
    // light from every direction and something for glass to reflect. A sky/ground fill tints it with
    // the hour. One sun — or moon — casts real soft shadows. `getDaylight` moves, tints and dims all
    // of them with the real sun where the user is.
    // Prefiltering needs float render targets; a device that cannot do it just goes without the
    // environment (the fill light still lights the city, the glass just reflects less).
    try {
        const pmrem = new PMREMGenerator(renderer)
        const environment = pmrem.fromScene(new RoomEnvironment(), 0.04)
        pmrem.dispose()
        track(environment)
        scene.environment = environment.texture
    } catch (error) {
        console.warn('[skyline] No environment lighting on this device', error)
    }
    const ENVIRONMENT = 0.38
    const FILL = 0.72
    const SUN = 3.6
    const fill = new HemisphereLight(0xffffff, new Color('#C9CDD1'), FILL)
    const sun = new DirectionalLight(0xffffff, SUN)
    sun.castShadow = true
    sun.shadow.mapSize.set(3072, 3072)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.02
    sun.shadow.radius = 3
    const shadowCamera = sun.shadow.camera
    // Wide enough for the long shadows of a low sun, which otherwise fall outside the shadow map and
    // simply vanish at exactly the hour they should be most dramatic.
    shadowCamera.left = -CITY_HALF_WIDTH - 7
    shadowCamera.right = CITY_HALF_WIDTH + 7
    shadowCamera.top = CITY_HALF_DEPTH + 9
    shadowCamera.bottom = -CITY_HALF_DEPTH - 9
    shadowCamera.near = 1
    shadowCamera.far = 90
    scene.add(fill, sun, sun.target)
    let lampGlow = 0
    const applyDaylight = daylight => {
        fill.color.set(daylight.ambientColor)
        // How much of the day is left, 0 (night) to 1 (full day). Night is properly dark: the fill and
        // the environment fall much further than the moon does, so the lit windows and lamps carry it.
        const dayness = (daylight.lightStrength - 0.35) / 0.65
        fill.intensity = FILL * daylight.ambientStrength * (0.45 + 0.55 * dayness)
        scene.environmentIntensity = ENVIRONMENT * (0.12 + 0.88 * dayness)
        sun.color.set(daylight.lightColor)
        sun.intensity = SUN * daylight.lightStrength
        sun.position.set(
            Math.cos(daylight.elevation) * Math.sin(daylight.azimuth) * 30,
            Math.sin(daylight.elevation) * 30,
            Math.cos(daylight.elevation) * Math.cos(daylight.azimuth) * 30
        )
        lampGlow = daylight.lamps
        windowGlow.value = daylight.lamps
    }
    applyDaylight(getDaylight())

    let days = []
    let labels = { columns: [], rows: [] }
    let scale = 5

    const drawGround = () => {
        const context = groundCanvas.getContext('2d')
        const px = GROUND_PX_PER_UNIT
        const cx = x => (x + groundWidth / 2) * px
        const cz = z => (z + groundDepth / 2) * px
        context.clearRect(0, 0, groundCanvas.width, groundCanvas.height)
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
        // A fine aggregate in the asphalt, so the roads read as a surface rather than a fill.
        const grain = seeded(1301)
        context.fillStyle = ASPHALT_SPECKLE
        for (let i = 0; i < 2600; i++) {
            const size = 1 + grain() * 2
            context.fillRect(
                cx(-extentX) + grain() * extentX * 2 * px,
                cz(-extentZ) + grain() * extentZ * 2 * px,
                size,
                size
            )
        }
        // Dashed centre lines, one dash per block edge so they break at every junction.
        context.fillStyle = LANE
        const dash = 0.22 * px
        const dashWidth = 0.035 * px
        for (let row = 0; row <= ROWS; row++) {
            const z = -CITY_HALF_DEPTH + row * PITCH
            for (let column = 0; column < COLUMNS; column++) {
                const from = colX(column) - BLOCK / 2
                for (let x = from + 0.08; x + 0.22 <= from + BLOCK; x += 0.42) {
                    context.fillRect(cx(x), cz(z) - dashWidth / 2, dash, dashWidth)
                }
            }
        }
        for (let column = 0; column <= COLUMNS; column++) {
            const x = -CITY_HALF_WIDTH + column * PITCH
            for (let row = 0; row < ROWS; row++) {
                const from = rowZ(row) - BLOCK / 2
                for (let z = from + 0.08; z + 0.22 <= from + BLOCK; z += 0.42) {
                    context.fillRect(cx(x) - dashWidth / 2, cz(z), dashWidth, dash)
                }
            }
        }
        // One block per day, with a kerb: pavement for buildings, grass for the days nothing got done.
        const block = BLOCK * px
        const kerb = 0.035 * px
        const byCell = new Map(days.map(day => [`${day.week}:${day.weekday}`, day]))
        const grassGrain = seeded(907)
        for (let row = 0; row < ROWS; row++) {
            for (let column = 0; column < COLUMNS; column++) {
                const day = byCell.get(`${row}:${column}`)
                const left = cx(colX(column)) - block / 2
                const top = cz(rowZ(row)) - block / 2
                context.fillStyle = CURB
                roundRect(left, top, block, block)
                const park = day && day.tasks <= 0
                context.fillStyle = park ? PARK : PLOT
                roundRect(left + kerb, top + kerb, block - kerb * 2, block - kerb * 2)
                if (park) {
                    context.fillStyle = PARK_SPECKLE
                    for (let i = 0; i < 90; i++) {
                        context.fillRect(
                            left + kerb + grassGrain() * (block - kerb * 2),
                            top + kerb + grassGrain() * (block - kerb * 2),
                            2,
                            2
                        )
                    }
                }
            }
        }
        // Zebra crossings on every approach to a junction, just before the lanes meet.
        context.fillStyle = LANE
        const stripe = 0.05 * px
        const crossingDepth = 0.14 * px
        for (let row = 0; row <= ROWS; row++) {
            for (let column = 0; column <= COLUMNS; column++) {
                const jx = cx(-CITY_HALF_WIDTH + column * PITCH)
                const jz = cz(-CITY_HALF_DEPTH + row * PITCH)
                const reach = (ROAD_WIDTH / 2 + 0.06) * px
                for (let k = -2; k <= 2; k++) {
                    const offset = k * stripe * 2 - stripe / 2
                    if (column < COLUMNS) context.fillRect(jx + reach, jz + offset, crossingDepth, stripe)
                    if (column > 0) context.fillRect(jx - reach - crossingDepth, jz + offset, crossingDepth, stripe)
                    if (row < ROWS) context.fillRect(jx + offset, jz + reach, stripe, crossingDepth)
                    if (row > 0) context.fillRect(jx + offset, jz - reach - crossingDepth, stripe, crossingDepth)
                }
            }
        }
        // The calendar's legends: weekday names along the front edge (at the back the towers would
        // hide them), each week's first date on the left.
        context.fillStyle = LABEL
        context.textBaseline = 'middle'
        const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        context.textAlign = 'center'
        context.font = `500 ${0.44 * px}px ${font}`
        labels.columns.forEach(({ column, text }) => {
            context.fillText(text, cx(colX(column)), cz(CITY_HALF_DEPTH + roadHalf + 0.45))
        })
        context.textAlign = 'right'
        context.font = `500 ${0.4 * px}px ${font}`
        labels.rows.forEach(({ row, text }) => {
            context.fillText(text, cx(-CITY_HALF_WIDTH - roadHalf - 0.25), cz(rowZ(row)))
        })
        groundTexture.needsUpdate = true
    }

    // ---------------------------------------------------------------- buildings
    // Every building is a handful of PARTS, each an instance in one of a few instanced meshes, so a
    // quarter of varied architecture is still only seven draw calls.
    const KINDS = {
        box: { geometry: unitBox, material: masonryMaterial, colored: true, pickable: true },
        glass: { geometry: unitBox, material: glassMaterial, colored: true, pickable: true },
        pyramid: { geometry: unitPyramid, material: masonryMaterial, colored: true, pickable: true },
        cylinder: { geometry: unitCylinder, material: masonryMaterial, colored: true, pickable: true },
        glassCylinder: { geometry: unitCylinder, material: glassMaterial, colored: true, pickable: true },
        dome: { geometry: unitSphere, material: masonryMaterial, colored: true, pickable: true },
        tree: { geometry: unitSphere, material: propMaterial, colored: true },
        trunk: { geometry: unitCylinder, material: propMaterial, colored: true },
        spire: { geometry: unitCylinder, material: propMaterial, colored: true },
        tank: { geometry: unitCylinder, material: propMaterial, colored: true },
        flagPole: { geometry: unitCylinder, material: basic(FLAG_POLE) },
        flag: {
            geometry: unitFlag,
            material: track(new MeshBasicMaterial({ color: new Color(FLAG), side: DoubleSide })),
        },
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

    // Architecture. Height always means "tasks done that day"; everything else is free. Each day
    // picks one of several designs for its height band and its materials — stone, plaster and brick
    // for the low and mid-rise city, tinted glass for the towers — seeded by date, so a day always
    // looks the same. The day's projects appear as small touches in their own colours: a lobby band,
    // an awning, a small roof, the bands of a round tower, a sky bridge. Every design tops out at
    // exactly the day's height so the skyline still reads as data.
    let buildingColors = []
    const buildParts = () => {
        const list = []
        const byBuilding = days.map(() => [])
        buildingColors = days.map(() => PLOT)
        days.forEach((day, b) => {
            const x = cellX(day)
            const z = cellZ(day)
            const type = getBuildingType(day.tasks, scale)
            const H = getSkylineHeight(day.tasks, scale)
            const random = seeded(day.week * 31 + day.weekday * 7 + 11)
            const pick = list => list[Math.floor(random() * list.length) % list.length]
            // Always drawn in the same order, so the design never changes when the data does.
            const stone = pick(MASONRY_PALETTE)
            const tint = pick(GLASS_PALETTE)
            const neutral = pick(NEUTRAL_ACCENT)
            const touch = getProjectColorAt(day, 0) || neutral
            const secondTouch = day.byProject && day.byProject[1] ? day.byProject[1].project.color : touch
            buildingColors[b] = stone
            const F = FOOTPRINT
            const add = (kind, part) => {
                const entry = { kind, b, x, z, y: 0, rot: 0, ...part }
                list.push(entry)
                byBuilding[b].push(entry)
                return entry
            }
            const box = (part, color = stone) => add('box', { color, ...part })
            const glass = (part, color = tint) => add('glass', { color, ...part })
            // Where an empty-inbox flag would be planted: the design's highest flat point.
            let summit = { x, z, top: H, w: F * 0.5, spire: false }
            const flatRoof = (w, d, top, offset = {}) => {
                // A slim parapet cap on every flat roof.
                add('box', {
                    ...offset,
                    y: top,
                    w: w + 0.02,
                    h: 0.035,
                    d: d + 0.02,
                    color: ROOF_CAP,
                })
                const capped = top + 0.035
                if (capped >= summit.top - 0.001 || summit.top === H) {
                    summit = { ...summit, x: offset.x ?? x, z: offset.z ?? z, top: capped, w: Math.min(w, d) }
                }
            }
            const discRoof = (w, top) => {
                add('cylinder', { y: top, w: w + 0.02, h: 0.035, d: w + 0.02, color: ROOF_CAP })
                if (top + 0.035 >= summit.top - 0.001 || summit.top === H) {
                    summit = { ...summit, x, z, top: top + 0.035, w }
                }
            }
            // Rooftop plant: a water tank or a couple of air-handling units, off-centre.
            const rooftop = (w, d, top, offset = {}) => {
                const ox = (offset.x ?? x) + (random() - 0.5) * w * 0.4
                const oz = (offset.z ?? z) + (random() - 0.5) * d * 0.4
                if (random() < 0.45) {
                    add('tank', { x: ox, z: oz, y: top + 0.035, w: 0.13, h: 0.15, d: 0.13, color: WATER_TANK })
                } else {
                    add('box', { x: ox, z: oz, y: top + 0.035, w: w * 0.3, h: 0.09, d: d * 0.22, color: METAL })
                    add('box', {
                        x: ox + w * 0.2,
                        z: oz - d * 0.18,
                        y: top + 0.035,
                        w: w * 0.18,
                        h: 0.07,
                        d: d * 0.18,
                        color: METAL,
                    })
                }
            }
            // The project's colour at street level: a lobby band around the ground floor.
            const lobby = (w, d, color = touch, offset = {}) =>
                box({ ...offset, w: w + 0.03, h: 0.12, d: d + 0.03 }, color)
            const spireOnTop = top => {
                summit.spire = true
                add('spire', { y: top, w: 0.05, h: SPIRE, d: 0.05, color: METAL })
                add('beacon', { y: top + SPIRE - 0.03, w: 0.12, h: 0.12, d: 0.12, blink: random() * Math.PI * 2 })
            }
            const tree = (tx, tz, size) => {
                add('trunk', { x: tx, z: tz, w: 0.035, h: size * 0.55, d: 0.035, color: TRUNK })
                add('tree', { x: tx, z: tz, y: size * 0.35, w: size, h: size * 1.1, d: size, color: pick(CANOPY) })
            }
            const stack = (count, width, depth, twist) => {
                const slab = H / count
                for (let i = 0; i < count; i++) {
                    glass({ y: i * slab, w: width, h: slab * 0.94, d: depth, rot: i * twist })
                }
                flatRoof(width, depth, H - slab * 0.06, { rot: (count - 1) * twist })
            }

            const designs = {
                park: () => {
                    // A lawn (so the day can still be hovered and tapped) with a few trees.
                    box({ w: F, h: 0.02, d: F }, PARK)
                    const trees = 2 + Math.floor(random() * 3)
                    for (let i = 0; i < trees; i++) {
                        const size = 0.18 + random() * 0.12
                        tree(x + (random() - 0.5) * (F - size), z + (random() - 0.5) * (F - size), size)
                    }
                    summit = { x, z, top: 0.02, w: F * 0.5, spire: false }
                },
                gable: () => {
                    const wall = Math.max(0.2, H - 0.28)
                    box({ w: F * 0.84, h: wall, d: F * 0.8 })
                    add('pyramid', {
                        y: wall,
                        w: F * 0.92,
                        h: H - wall,
                        d: F * 0.88,
                        color: touch,
                        rot: random() < 0.5 ? 0 : Math.PI / 2,
                    })
                },
                silo: () => {
                    const domeHeight = Math.min(0.36, H * 0.45)
                    add('cylinder', { w: F * 0.72, h: H - domeHeight / 2, d: F * 0.72, color: stone })
                    add('dome', { y: H - domeHeight, w: F * 0.72, h: domeHeight, d: F * 0.72, color: COPPER })
                },
                rowHouses: () => {
                    ;[-1, 1].forEach((side, i) => {
                        const top = i ? H : H * 0.82
                        const wall = Math.max(0.16, top - 0.22)
                        const offset = { x: x + side * F * 0.24 }
                        box({ ...offset, w: F * 0.44, h: wall, d: F * 0.8 }, i ? stone : pick(MASONRY_PALETTE))
                        add('pyramid', {
                            ...offset,
                            y: wall,
                            w: F * 0.46,
                            h: top - wall,
                            d: F * 0.84,
                            color: i ? touch : neutral,
                        })
                    })
                    // The flag goes on the ridge of the taller house, not in the gap between them.
                    summit = { x: x + F * 0.24, z, top: H, w: 0.1, spire: false }
                },
                shop: () => {
                    box({ w: F * 0.9, h: H, d: F * 0.8 })
                    box({ z: z + F * 0.44, y: H * 0.36, w: F * 0.86, h: 0.03, d: 0.16 }, touch)
                    flatRoof(F * 0.9, F * 0.8, H)
                    rooftop(F * 0.9, F * 0.8, H)
                },
                fanBlock: () => {
                    lobby(F, F)
                    box({ w: F, h: H, d: F })
                    flatRoof(F, F, H)
                    const unit = F * 0.34
                    const ux = x + (random() - 0.5) * F * 0.3
                    const uz = z + (random() - 0.5) * F * 0.3
                    box({ x: ux, z: uz, y: H + 0.035, w: unit, h: 0.12, d: unit }, METAL)
                    add('fan', {
                        x: ux,
                        z: uz,
                        y: H + 0.16,
                        w: unit * 0.95,
                        h: 0.015,
                        d: 0.05,
                        spin: 2 + random() * 2,
                        rot: random() * Math.PI,
                    })
                },
                roundTower: () => {
                    const domeHeight = Math.min(0.4, H * 0.18)
                    add('cylinder', { w: F * 0.86, h: H - domeHeight / 2, d: F * 0.86, color: stone })
                    add('cylinder', { y: H * 0.45, w: F * 0.93, h: 0.05, d: F * 0.93, color: touch })
                    add('dome', { y: H - domeHeight, w: F * 0.86, h: domeHeight, d: F * 0.86, color: COPPER })
                },
                lShape: () => {
                    box({ z: z - F * 0.26, w: F, h: H, d: F * 0.48 })
                    box({ x: x - F * 0.26, z: z + F * 0.24, w: F * 0.48, h: H * 0.62, d: F * 0.52 })
                    flatRoof(F * 0.48, F * 0.52, H * 0.62, { x: x - F * 0.26, z: z + F * 0.24 })
                    flatRoof(F, F * 0.48, H, { z: z - F * 0.26 })
                    rooftop(F, F * 0.48, H, { z: z - F * 0.26 })
                    lobby(F, F * 0.48, touch, { z: z - F * 0.26 })
                },
                twistedStack: () => {
                    lobby(F * 0.82, F * 0.82)
                    stack(4, F * 0.82, F * 0.82, 0.28)
                },
                stepped: () => {
                    const split = H * 0.66
                    lobby(F * 0.92, F * 0.92)
                    box({ w: F * 0.92, h: split, d: F * 0.92 })
                    flatRoof(F * 0.92, F * 0.92, split)
                    glass({ y: split + 0.035, w: F * 0.64, h: H - split - 0.035, d: F * 0.64 })
                    flatRoof(F * 0.64, F * 0.64, H)
                    rooftop(F * 0.64, F * 0.64, H)
                },
                banded: withSpire => () => {
                    add('glassCylinder', { w: F * 0.8, h: H, d: F * 0.8, color: tint })
                    for (let y = 0.5; y < H - 0.2; y += 0.55) {
                        add('cylinder', { y, w: F * 0.84, h: 0.035, d: F * 0.84, color: touch })
                    }
                    discRoof(F * 0.8, H)
                    if (withSpire) spireOnTop(H + 0.035)
                },
                spiral: () => {
                    lobby(F * 0.8, F * 0.5)
                    stack(Math.max(5, Math.round(H / 0.32)), F * 0.8, F * 0.5, 0.2)
                },
                twins: () => {
                    ;[-1, 1].forEach((side, i) => {
                        const top = i ? H : H * 0.86
                        const offset = { x: x + side * F * 0.26 }
                        lobby(F * 0.38, F * 0.6, touch, offset)
                        glass({ ...offset, w: F * 0.38, h: top, d: F * 0.6 })
                        flatRoof(F * 0.38, F * 0.6, top, offset)
                    })
                    box({ y: H * 0.58, w: F * 0.3, h: 0.1, d: F * 0.22 }, secondTouch)
                },
                obelisk: () => {
                    const shaft = H * 0.74
                    lobby(F * 0.66, F * 0.66)
                    box({ w: F * 0.66, h: shaft, d: F * 0.66 })
                    add('pyramid', { y: shaft, w: F * 0.66, h: H - shaft, d: F * 0.66, color: '#B8BEC4' })
                },
                spireScraper: () => {
                    const first = H * 0.42
                    const second = H * 0.82
                    lobby(F, F)
                    glass({ w: F, h: first, d: F })
                    flatRoof(F, F, first)
                    glass({ y: first + 0.035, w: F * 0.76, h: second - first - 0.035, d: F * 0.76 })
                    flatRoof(F * 0.76, F * 0.76, second)
                    glass({ y: second + 0.035, w: F * 0.54, h: H - second - 0.035, d: F * 0.54 })
                    flatRoof(F * 0.54, F * 0.54, H)
                    spireOnTop(H + 0.035)
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
            if (day.achieved) {
                // Off-centre when the centre already carries an antenna.
                const inset = summit.spire ? Math.max(0.08, summit.w * 0.32) : 0
                const poleX = summit.x - inset
                const poleZ = summit.z + inset
                add('flagPole', { x: poleX, z: poleZ, y: summit.top, w: 0.035, h: FLAG_POLE_HEIGHT, d: 0.035 })
                add('flag', {
                    x: poleX,
                    z: poleZ,
                    y: summit.top + FLAG_POLE_HEIGHT - 0.2,
                    w: 0.3,
                    h: 0.18,
                    d: 0.012,
                    isFlag: true,
                    phase: random() * Math.PI * 2,
                })
            }
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
            mesh.castShadow = true
            mesh.receiveShadow = true
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
            if (!KINDS[part.kind].pickable || part.color === METAL) return
            let color = part.base
            if (b === hoverIndex) color = part.base.clone().lerp(white, 0.3)
            meshes[part.kind].setColorAt(part.index, color)
            meshes[part.kind].instanceColor.needsUpdate = true
        })
    }

    // Today's flag popping up, on the same celebration run as the 2D dot.
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
                // Rooftop equipment — and the flag — is the first thing a hit knocks off.
                if (state.stripped && STRIPPED_KINDS.has(part.kind)) h = 0
                if (state.collapsed && integrity < 0.02) h = 0
                const shake = Math.max(0, 1 - (now - state.shakeStart) / 0.35)
                if (shake > 0 && !reduceMotion) {
                    jitterX = Math.sin(now * 90 + part.b) * 0.06 * shake
                    jitterZ = Math.cos(now * 77 + part.b) * 0.06 * shake
                }
            }
            if (part.kind === 'fan' && !reduceMotion) rotation += t * part.spin
            if (part.kind === 'beacon') {
                const blink =
                    (reduceMotion ? 1 : 0.55 + 0.75 * Math.max(0, Math.sin(t * 2.6 + part.blink)) ** 6) *
                    (1 + lampGlow * 0.9)
                w *= blink
                d *= blink
                h = part.h * blink * (r > 0.98 ? 1 : 0)
            }
            if (part.kind === 'flag' && !reduceMotion) {
                rotation += Math.sin(t * 3.1 + part.phase) * 0.45
                w *= 0.88 + 0.12 * Math.sin(t * 6.3 + part.phase)
            }
            if (part.isFlag && part.b === todayIndex && pop !== 1) {
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
                if (!KINDS[part.kind].pickable || part.color === METAL) return
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
        mesh.castShadow = material !== undefined && !material.transparent
        mesh.receiveShadow = true
        if (colored) for (let i = 0; i < size; i++) mesh.setColorAt(i, new Color(PLOT))
        dummy.scale.set(0, 0, 0)
        dummy.updateMatrix()
        for (let i = 0; i < size; i++) mesh.setMatrixAt(i, dummy.matrix)
        scene.add(mesh)
        return { mesh, items: Array.from({ length: size }, () => ({ age: 1, life: 0 })), next: 0 }
    }
    const debris = makePool(unitBox, propMaterial, 360, true)
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
    const rubble = makePool(unitBox, propMaterial, 91 * 6, true)
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
        const x = cellX(day)
        const z = cellZ(day)
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
        const x = cellX(day)
        const z = cellZ(day)
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
        const x = cellX(day)
        const z = cellZ(day)
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

    // ---------------------------------------------------------------- street furniture
    // Static and seeded: a few trees on the pavement corners of the blocks, and a street lamp on
    // every other junction whose light comes on as the evening falls.
    const furnitureRandom = seeded(4243)
    const streetTrees = []
    for (let row = 0; row < ROWS; row++) {
        for (let column = 0; column < COLUMNS; column++) {
            ;[-1, 1].forEach(sx =>
                [-1, 1].forEach(sz => {
                    if (furnitureRandom() > 0.28) return
                    const size = 0.13 + furnitureRandom() * 0.07
                    const corner = BLOCK / 2 - size / 2 - 0.02
                    streetTrees.push({ x: colX(column) + sx * corner, z: rowZ(row) + sz * corner, size })
                })
            )
        }
    }
    const treeMesh = new InstancedMesh(unitSphere, propMaterial, Math.max(streetTrees.length, 1))
    const trunkMesh = new InstancedMesh(unitCylinder, propMaterial, Math.max(streetTrees.length, 1))
    ;[treeMesh, trunkMesh].forEach(mesh => {
        mesh.count = streetTrees.length
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.frustumCulled = false
        scene.add(mesh)
    })
    streetTrees.forEach((tree, i) => {
        dummy.rotation.set(0, 0, 0)
        dummy.position.set(tree.x, 0, tree.z)
        dummy.scale.set(0.03, tree.size * 0.6, 0.03)
        dummy.updateMatrix()
        trunkMesh.setMatrixAt(i, dummy.matrix)
        trunkMesh.setColorAt(i, new Color(TRUNK))
        dummy.position.set(tree.x, tree.size * 0.4, tree.z)
        dummy.scale.set(tree.size, tree.size * 1.15, tree.size)
        dummy.updateMatrix()
        treeMesh.setMatrixAt(i, dummy.matrix)
        treeMesh.setColorAt(i, new Color(CANOPY[Math.floor(furnitureRandom() * CANOPY.length) % CANOPY.length]))
    })

    const lamps = []
    // Interior junctions only: a lamp on the city's outer edge would throw its light pool past the
    // pavement onto the card.
    for (let row = 1; row < ROWS; row++) {
        for (let column = 1; column < COLUMNS; column++) {
            if ((row + column) % 2) continue
            lamps.push({
                x: -CITY_HALF_WIDTH + column * PITCH + ROAD_WIDTH / 2 + 0.06,
                z: -CITY_HALF_DEPTH + row * PITCH + ROAD_WIDTH / 2 + 0.06,
            })
        }
    }
    const lampPosts = new InstancedMesh(unitCylinder, basic(LAMP_POST), lamps.length)
    const lampLights = new InstancedMesh(unitSphere, basic(LAMP_LIGHT), lamps.length)
    ;[lampPosts, lampLights].forEach(mesh => {
        mesh.frustumCulled = false
        scene.add(mesh)
    })
    lampPosts.castShadow = true
    lamps.forEach((lamp, i) => {
        dummy.position.set(lamp.x, 0, lamp.z)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.set(0.025, 0.3, 0.025)
        dummy.updateMatrix()
        lampPosts.setMatrixAt(i, dummy.matrix)
    })
    // Light that is not real light: soft additive glows laid on the street or hung in the air. They
    // only mean anything once the city is dark, so everything built from them scales with the
    // evening (`lampGlow`) and is simply not there by day.
    const glowTexture = (() => {
        const glowCanvas = document.createElement('canvas')
        glowCanvas.width = glowCanvas.height = 64
        const context = glowCanvas.getContext('2d')
        const gradient = context && context.createRadialGradient && context.createRadialGradient(32, 32, 0, 32, 32, 32)
        if (gradient) {
            gradient.addColorStop(0, 'rgba(255,255,255,1)')
            gradient.addColorStop(0.4, 'rgba(255,255,255,0.45)')
            gradient.addColorStop(1, 'rgba(255,255,255,0)')
            context.fillStyle = gradient
            context.fillRect(0, 0, 64, 64)
        }
        const texture = track(new CanvasTexture(glowCanvas))
        texture.colorSpace = SRGBColorSpace
        return texture
    })()
    const glowMaterial = (color, opacity, withTexture = true) =>
        track(
            new MeshBasicMaterial({
                color: new Color(color),
                map: withTexture ? glowTexture : null,
                transparent: true,
                opacity,
                blending: AdditiveBlending,
                depthWrite: false,
                side: DoubleSide,
            })
        )
    const unitDisc = track(new PlaneGeometry(1, 1))
    unitDisc.rotateX(-Math.PI / 2)
    const hideAll = mesh => {
        dummy.position.set(0, -50, 0)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.set(0, 0, 0)
        dummy.updateMatrix()
        for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, dummy.matrix)
        mesh.instanceMatrix.needsUpdate = true
    }
    const lampPools = new InstancedMesh(unitDisc, glowMaterial(LAMP_LIGHT, 0.55), lamps.length)
    lampPools.frustumCulled = false
    lampPools.renderOrder = 2
    scene.add(lampPools)

    let shownGlow = -1
    const updateLamps = () => {
        if (Math.abs(shownGlow - lampGlow) < 0.01) return
        shownGlow = lampGlow
        lamps.forEach((lamp, i) => {
            const size = 0.02 + 0.07 * lampGlow
            dummy.position.set(lamp.x, 0.3 - size / 2, lamp.z)
            dummy.rotation.set(0, 0, 0)
            dummy.scale.set(size, size, size)
            dummy.updateMatrix()
            lampLights.setMatrixAt(i, dummy.matrix)
            const pool = 0.8 * lampGlow
            dummy.position.set(lamp.x, 0.012, lamp.z)
            dummy.scale.set(pool, 1, pool)
            dummy.updateMatrix()
            lampPools.setMatrixAt(i, dummy.matrix)
        })
        lampLights.instanceMatrix.needsUpdate = true
        lampPools.instanceMatrix.needsUpdate = true
    }
    updateLamps()

    // ---------------------------------------------------------------- life: cars
    // Cars on every road, both directions, driving on the right. Cars along the weeks use the
    // long east-west roads; cars along the days use the short north-south ones.
    // Few and slow: the streets should feel like a quiet morning, not rush hour.
    const CAR_COUNT = 8
    const carRandom = seeded(97)
    const cars = Array.from({ length: CAR_COUNT }, (_, i) => {
        const alongX = carRandom() < 0.6
        const direction = carRandom() < 0.5 ? 1 : -1
        const road = alongX
            ? -CITY_HALF_DEPTH + Math.floor(carRandom() * (ROWS + 1)) * PITCH
            : -CITY_HALF_WIDTH + Math.floor(carRandom() * (COLUMNS + 1)) * PITCH
        return {
            alongX,
            direction,
            lane: road + direction * 0.11 * (alongX ? 1 : -1),
            half: alongX ? CITY_HALF_WIDTH : CITY_HALF_DEPTH,
            speed: 0.3 + carRandom() * 0.25,
            offset: carRandom() * 100,
            color: CAR_COLORS[i % CAR_COLORS.length],
        }
    })
    const carMesh = new InstancedMesh(unitBox, propMaterial, CAR_COUNT)
    // A darker glass cabin on each car body.
    const cabinMesh = new InstancedMesh(unitBox, propMaterial, CAR_COUNT)
    cabinMesh.frustumCulled = false
    cabinMesh.castShadow = true
    for (let i = 0; i < CAR_COUNT; i++) cabinMesh.setColorAt(i, new Color(CAR_GLASS))
    cabinMesh.visible = !reduceMotion
    scene.add(cabinMesh)
    carMesh.frustumCulled = false
    carMesh.castShadow = true
    cars.forEach((car, i) => carMesh.setColorAt(i, new Color(car.color)))
    carMesh.visible = !reduceMotion
    scene.add(carMesh)
    // Headlights, their beam on the road ahead, and tail lights — at night only.
    const headlights = new InstancedMesh(unitSphere, basic(WARM_LIGHT), CAR_COUNT * 2)
    const tailLights = new InstancedMesh(unitSphere, basic(TAIL_LIGHT), CAR_COUNT * 2)
    const headBeams = new InstancedMesh(unitDisc, glowMaterial(WARM_LIGHT, 0.5), CAR_COUNT)
    ;[headlights, tailLights, headBeams].forEach(mesh => {
        mesh.frustumCulled = false
        hideAll(mesh)
        scene.add(mesh)
    })
    headBeams.renderOrder = 2
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
            dummy.scale.set(0.3 * edge, 0.07 * edge, 0.15 * edge)
            dummy.updateMatrix()
            carMesh.setMatrixAt(i, dummy.matrix)
            dummy.position.y = 0.07 * edge
            dummy.scale.set(0.16 * edge, 0.05 * edge, 0.13 * edge)
            dummy.updateMatrix()
            cabinMesh.setMatrixAt(i, dummy.matrix)

            const cx = car.alongX ? along : car.lane
            const cz = car.alongX ? car.lane : along
            const fx = car.alongX ? car.direction : 0
            const fz = car.alongX ? 0 : car.direction
            const light = lampGlow * edge
            dummy.rotation.set(0, 0, 0)
            ;[-1, 1].forEach((side, k) => {
                const sx = -fz * side * 0.05
                const sz = fx * side * 0.05
                const bulb = 0.035 * light
                dummy.position.set(cx + fx * 0.15 + sx, 0.045, cz + fz * 0.15 + sz)
                dummy.scale.set(bulb, bulb, bulb)
                dummy.updateMatrix()
                headlights.setMatrixAt(i * 2 + k, dummy.matrix)
                dummy.position.set(cx - fx * 0.15 + sx, 0.05, cz - fz * 0.15 + sz)
                dummy.scale.set(bulb * 0.8, bulb * 0.8, bulb * 0.8)
                dummy.updateMatrix()
                tailLights.setMatrixAt(i * 2 + k, dummy.matrix)
            })
            dummy.position.set(cx + fx * 0.52, 0.014, cz + fz * 0.52)
            dummy.scale.set((car.alongX ? 0.7 : 0.3) * light, 1, (car.alongX ? 0.3 : 0.7) * light)
            dummy.updateMatrix()
            headBeams.setMatrixAt(i, dummy.matrix)
        })
        carMesh.instanceMatrix.needsUpdate = true
        cabinMesh.instanceMatrix.needsUpdate = true
        headlights.instanceMatrix.needsUpdate = true
        tailLights.instanceMatrix.needsUpdate = true
        headBeams.instanceMatrix.needsUpdate = true
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
            bird.traverse(object => {
                object.castShadow = true
            })
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
            // Birds roost at night; the helicopter has the sky then.
            const awake = lampGlow < 0.5
            flock.members.forEach(bird => {
                bird.visible = awake
            })
            if (!awake) return
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
    const burner = new Mesh(unitSphere, basic(colors.UtilityOrange200))
    burner.position.y = 0.16
    balloon.add(envelope, stripe, basket, burner)
    balloon.traverse(object => {
        object.castShadow = true
    })
    scene.add(balloon)
    // One slow crossing, then a long gap with an empty sky.
    const BALLOON_CROSSING = 55
    const BALLOON_LOOP = 150
    const updateBalloon = t => {
        const progress = ((t + 20) % BALLOON_LOOP) / BALLOON_CROSSING
        const crossing = progress <= 1
        balloon.visible = crossing
        if (!crossing) return
        // Everything that flies stays over the city and fades in and out by scale, never by crossing
        // the canvas edge: something sliding in from nowhere would reveal the frame around the city.
        const x = (progress * 2 - 1) * (CITY_HALF_WIDTH - 1)
        const appear = Math.min(1, progress / 0.08, (1 - progress) / 0.08)
        balloon.scale.setScalar(appear)
        const z = -1.6 + Math.sin(t * 0.21) * 1.2
        balloon.position.set(x, 3.2 + Math.sin(t * 0.7) * 0.15, z)
        // At night the burner flickers under the envelope.
        const flame = lampGlow * (0.09 + 0.04 * Math.abs(Math.sin(t * 17) * Math.sin(t * 7.3)))
        burner.scale.setScalar(Math.max(flame, 0.0001))
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
    const portLight = new Mesh(unitSphere, basic(PORT_LIGHT))
    portLight.position.set(-0.53, -0.02, -0.05)
    const starboardLight = new Mesh(unitSphere, basic(STARBOARD_LIGHT))
    starboardLight.position.set(0.53, -0.02, -0.05)
    const strobe = new Mesh(unitSphere, basic(WARM_LIGHT))
    strobe.position.set(0, 0.1, 0.46)
    airplane.add(fuselage, wings, tailplane, fin, portLight, starboardLight, strobe)
    airplane.traverse(object => {
        object.castShadow = true
    })
    scene.add(airplane)
    const FLIGHT_SECONDS = 16
    const FLIGHT_PAUSE = 45
    const updateAirplane = t => {
        const cycle = FLIGHT_SECONDS + FLIGHT_PAUSE
        const flightIndex = Math.floor(t / cycle)
        const progress = (t % cycle) / FLIGHT_SECONDS
        const flying = progress <= 1
        airplane.visible = flying
        if (!flying) return
        const reverse = flightIndex % 2 === 1
        const span = CITY_HALF_WIDTH - 0.5
        const x = (reverse ? 1 - progress : progress) * span * 2 - span
        const appear = Math.min(1, progress / 0.1, (1 - progress) / 0.1)
        airplane.scale.setScalar(appear)
        const drift = reverse ? -2 : 2.4
        const z = (reverse ? 1.8 : -2.6) + (progress - 0.5) * drift
        // Nose is local -z, the same convention as the birds.
        const vx = reverse ? -span * 2 : span * 2
        const heading = Math.atan2(-vx, -drift)
        airplane.position.set(x, 4.3, z)
        airplane.rotation.set(0, heading, 0)
        // Navigation lights: steady red and green wingtips, a white strobe on the tail.
        const nav = Math.max(0.0001, 0.07 * lampGlow)
        portLight.scale.setScalar(nav)
        starboardLight.scale.setScalar(nav)
        strobe.scale.setScalar(Math.sin(t * 7) > 0.85 ? nav * 1.3 : 0.0001)
    }

    // ---------------------------------------------------------------- life: the night helicopter
    // Only out after dark: circles the city slowly and sweeps a searchlight over the streets.
    const helicopter = new Group()
    const cabin = new Mesh(unitSphere, basic(HELICOPTER))
    cabin.scale.set(0.24, 0.18, 0.36)
    cabin.position.y = -0.09
    const boom = new Mesh(unitBox, basic(HELICOPTER))
    boom.scale.set(0.04, 0.04, 0.42)
    boom.position.set(0, 0, 0.3)
    const rotor = new Mesh(unitBox, basic(METAL))
    rotor.scale.set(0.95, 0.012, 0.04)
    rotor.position.y = 0.11
    const tailRotor = new Mesh(unitBox, basic(METAL))
    tailRotor.scale.set(0.01, 0.16, 0.03)
    tailRotor.position.set(0.03, -0.06, 0.5)
    const helicopterLight = new Mesh(unitSphere, basic(PORT_LIGHT))
    helicopterLight.position.set(0, 0.08, 0.5)
    helicopter.add(cabin, boom, rotor, tailRotor, helicopterLight)
    scene.add(helicopter)
    const beam = new Mesh(track(new ConeGeometry(0.55, 1, 28, 1, true)), glowMaterial(WARM_LIGHT, 0.14, false))
    const spot = new Mesh(unitDisc, glowMaterial(WARM_LIGHT, 0.8))
    beam.renderOrder = 3
    spot.renderOrder = 3
    scene.add(beam, spot)
    const up = new Vector3(0, 1, 0)
    const beamDirection = new Vector3()
    const beamQuaternion = new Quaternion()
    const updateHelicopter = t => {
        const present = Math.min(1, Math.max(0, (lampGlow - 0.25) / 0.35))
        const shown = present > 0.01
        helicopter.visible = shown
        beam.visible = shown
        spot.visible = shown
        if (!shown) return
        const angle = t * 0.07
        const hx = Math.cos(angle) * CITY_HALF_WIDTH * 0.55
        const hz = Math.sin(angle) * CITY_HALF_DEPTH * 0.55
        const hy = 3.4 + Math.sin(t * 0.5) * 0.1
        helicopter.position.set(hx, hy, hz)
        helicopter.rotation.set(
            0.12,
            Math.atan2(Math.sin(angle), -Math.cos(angle) * (CITY_HALF_DEPTH / CITY_HALF_WIDTH)),
            0
        )
        helicopter.scale.setScalar(present)
        rotor.rotation.y = t * 24
        tailRotor.rotation.x = t * 30
        helicopterLight.scale.setScalar(Math.sin(t * 5) > 0.6 ? 0.06 : 0.0001)
        // The searchlight wanders over the streets below and ahead of it.
        const sx = hx * 0.6 + Math.sin(t * 0.43) * 1.4
        const sz = hz * 0.6 + Math.cos(t * 0.31) * 1.1
        beamDirection.set(hx - sx, hy - 0.1, hz - sz)
        const length = beamDirection.length()
        beamQuaternion.setFromUnitVectors(up, beamDirection.normalize())
        beam.quaternion.copy(beamQuaternion)
        beam.position.set((hx + sx) / 2, (hy - 0.1) / 2 + 0.05, (hz + sz) / 2)
        beam.scale.set(present, length, present)
        spot.position.set(sx, 0.016, sz)
        spot.scale.set(1.3 * present, 1, 1.3 * present)
    }

    ;[helicopter, beam, spot].forEach(object => {
        object.visible = false
    })
    ;[balloon, airplane].forEach(object => {
        object.visible = !reduceMotion
    })
    flocks.forEach(flock =>
        flock.members.forEach(bird => {
            bird.visible = !reduceMotion
        })
    )

    // ---------------------------------------------------------------- camera: the flight
    // The corners of everything that must stay in view: the city block incl. its outer roads, the
    // What has to stay in view: the ground with its legends (weekday names in front of the city,
    // week dates to its left), and the top of every building that rises above the ground floor, where
    // it actually stands (`setBuildingTops`). Fitting the real skyline rather than the tallest
    // possible building at every corner is what lets the city fill the card: a tower in the middle
    // needs no room at the edge.
    const roadHalf = ROAD_WIDTH / 2
    const groundMinX = -(CITY_HALF_WIDTH + roadHalf + 0.25 + 1.7)
    const groundMaxX = CITY_HALF_WIDTH + roadHalf + 0.05
    const groundMinZ = -(CITY_HALF_DEPTH + roadHalf + 0.05)
    const groundMaxZ = CITY_HALF_DEPTH + roadHalf + 0.8
    const outerBuilding = PITCH / 2 - FOOTPRINT / 2
    const groundBounds = []
    ;[groundMinX, groundMaxX].forEach(x =>
        [groundMinZ, groundMaxZ].forEach(z => groundBounds.push(new Vector3(x, 0, z)))
    )
    // Until the data arrives, assume the tallest building on every outer corner.
    let bounds = groundBounds.concat(
        [-1, 1].flatMap(sx =>
            [-1, 1].map(
                sz =>
                    new Vector3(sx * (CITY_HALF_WIDTH - outerBuilding), TALLEST, sz * (CITY_HALF_DEPTH - outerBuilding))
            )
        )
    )
    const target = new Vector3((groundMinX + groundMaxX) / 2, TALLEST * 0.15, (groundMinZ + groundMaxZ) / 2)
    const setBuildingTops = () => {
        const tops = []
        let highest = 0.5
        partsByBuilding.forEach(buildingParts => {
            let top = 0
            buildingParts.forEach(part => {
                top = Math.max(top, part.y + part.h)
            })
            if (top < 0.6 || !buildingParts.length) return
            highest = Math.max(highest, top)
            const { x, z } = buildingParts[0]
            const half = FOOTPRINT / 2 + 0.05
            ;[-1, 1].forEach(sx =>
                [-1, 1].forEach(sz => tops.push(new Vector3(x + sx * half, top + 0.05, z + sz * half)))
            )
        })
        bounds = groundBounds.concat(tops)
        target.y = highest * 0.15
    }
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
    const placeCamera = (t, dt = 1 / 60) => {
        const { azimuth, elevation } = getOrbitView(reduceMotion ? null : t)
        direction.set(
            Math.cos(elevation) * Math.sin(azimuth),
            Math.sin(elevation),
            Math.cos(elevation) * Math.cos(azimuth)
        )
        const wanted = fitDistance()
        // Follow the fitted distance smoothly, but never sit closer than it: a lag in that direction
        // would clip the city for a moment.
        // Time-based easing, so a slow device converges as quickly as a fast one.
        const ease = 1 - Math.exp(-dt * 3)
        distance = distance == null ? wanted : Math.max(wanted, distance + (wanted - distance) * ease)
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
    let lastT = reduceMotion ? FROZEN_TIME : 0
    let lastDaylightCheck = startTime
    let lastFrame = startTime
    const frame = () => {
        frameId = 0
        if (disposed || !visible) return
        const now = performance.now() / 1000
        const dt = Math.min(0.05, now - lastFrame)
        lastFrame = now
        const t = reduceMotion ? FROZEN_TIME : now - startTime
        lastT = t
        // The light follows the clock; checking once a minute is plenty.
        if (now - lastDaylightCheck > 60) {
            lastDaylightCheck = now
            applyDaylight(getDaylight())
        }
        updateLamps()
        stepRise(now)
        stepDamage(dt)
        updatePools(dt)
        updateBuildings(now, t)
        if (!reduceMotion) {
            updateCars(t)
            updateBirds(t)
            updateBalloon(t)
            updateAirplane(t)
            updateHelicopter(t)
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
            marker.position.set(cellX(day), top + 0.55 + (reduceMotion ? 0 : Math.sin(t * 2.2) * 0.1), cellZ(day))
            marker.rotation.y = reduceMotion ? 0 : t * 0.8
        }
        placeCamera(t, dt)
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
            setBuildingTops()

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
            updateBuildings(animationStart, lastT)
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
            cabinMesh.dispose()
            ;[treeMesh, trunkMesh, lampPosts, lampLights, lampPools, headlights, tailLights, headBeams].forEach(mesh =>
                mesh.dispose()
            )
            ;[debris, sparks, dust, rubble].forEach(pool => pool.mesh.dispose())
            disposables.forEach(item => item.dispose())
            renderer.dispose()
            if (renderer.forceContextLoss) renderer.forceContextLoss()
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
        },
    }
}
