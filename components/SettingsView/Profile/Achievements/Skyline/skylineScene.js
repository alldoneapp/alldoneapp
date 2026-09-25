import {
    BoxGeometry,
    CanvasTexture,
    Color,
    ConeGeometry,
    InstancedMesh,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    PerspectiveCamera,
    PlaneGeometry,
    Raycaster,
    Scene,
    ShaderMaterial,
    SRGBColorSpace,
    Vector2,
    WebGLRenderer,
} from 'three'

import { colors } from '../../../../styles/global'
import {
    getFlyoverView,
    getSkylineColor,
    getSkylineHeight,
    getSkylineScale,
    SKYLINE_MAX_HEIGHT,
    SKYLINE_WEEKS,
} from './skylineData'

/**
 * The imperative half of the Empty inbox skyline: a three.js city where every building is one day,
 * drawn straight onto the white achievements card and seen from above.
 *
 * The camera is a plane flying over the year, and the page scroll is its throttle: while the card
 * scrolls up through the viewport the view swings from an angled approach to straight overhead
 * (`getFlyoverView`). There is deliberately no drag-to-orbit — the page scroll is the only camera
 * control, so the city never fights the page for a gesture.
 *
 * The look is kept quiet on purpose: solid blocks with flat, paper-like shading and no surface
 * detail (no windows, no glow, no sky). Every colour is an app colour: white card, Grey200/300
 * ground, the UtilityDarkBlue125 → Primary100 → Primary400 ramp for buildings, UtilityGreen200 roofs
 * for empty-inbox days (the 2D grid's green), UtilityYellow200 for the selected day and today's
 * marker, Text03 labels.
 *
 * Loaded through a dynamic `import()` from `EmptyInboxSkyline`, so three.js is its own chunk.
 */

const FOOTPRINT = 0.8
const GRID_DAYS = 7
const MARGIN_X = 3.5
const MARGIN_Z = 3
const GROUND_PX_PER_UNIT = 48
const RISE_DURATION = 0.9
// Straight overhead, the calm resting view.
const REDUCED_MOTION_PROGRESS = 0.5

const WHITE = '#FFFFFF'
const PLOT = colors.Grey200
const SHADOW = colors.Grey300
const LABEL = colors.Text03
const INBOX_GREEN = colors.UtilityGreen200
const HIGHLIGHT = colors.UtilityYellow200

const posX = week => week - (SKYLINE_WEEKS - 1) / 2
const posZ = weekday => weekday - (GRID_DAYS - 1) / 2

const buildingVertexShader = `
    varying vec3 vWorld; varying vec3 vN; varying vec3 vColor;
    void main() {
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
        #else
            vColor = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * world;
    }`

// Flat, paper-like shading: the roof carries the full colour (it is what you see from above), each
// side steps down by which way it faces, and distance fades gently toward the white card.
const buildingFragmentShader = `
    uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;
    varying vec3 vWorld; varying vec3 vN; varying vec3 vColor;
    void main() {
        vec3 n = normalize(vN);
        float shade = n.y > 0.5 ? 1.0 : (abs(n.x) > 0.5 ? (n.x < 0.0 ? 0.86 : 0.74) : (n.z > 0.0 ? 0.8 : 0.9));
        vec3 col = vColor * shade;
        float d = length(vWorld - cameraPosition);
        col = mix(col, uFog, smoothstep(uFogNear, uFogFar, d) * 0.55);
        gl_FragColor = vec4(col, 1.0);
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
    renderer.setClearColor(new Color(WHITE), 0)
    const canvas = renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    container.appendChild(canvas)

    const scene = new Scene()
    const camera = new PerspectiveCamera(30, 1, 1, 80)
    // Screen-up is "back" in the city, so looking straight down still reads weeks left to right and
    // Monday..Sunday top to bottom, like the 2D grid it replaces.
    camera.up.set(0, 0, -1)

    const disposables = []
    const track = item => {
        disposables.push(item)
        return item
    }

    // Ground: plots, a soft contact shadow per building, month and weekday labels.
    const groundWidth = SKYLINE_WEEKS + MARGIN_X * 2
    const groundDepth = GRID_DAYS + MARGIN_Z * 2
    const groundCanvas = document.createElement('canvas')
    groundCanvas.width = groundWidth * GROUND_PX_PER_UNIT
    groundCanvas.height = groundDepth * GROUND_PX_PER_UNIT
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
        const radius = 0.08 * px
        const roundRect = (x, y, w, h) => {
            context.beginPath()
            if (context.roundRect) context.roundRect(x, y, w, h, radius)
            else context.rect(x, y, w, h)
            context.fill()
        }
        // Contact shadows first, so plots sit on top of them; longer for taller buildings.
        context.fillStyle = SHADOW
        days.forEach(day => {
            if (day.tasks <= 0) return
            const length = Math.min(1, getSkylineHeight(day.tasks, scale) / SKYLINE_MAX_HEIGHT) * 0.35 * px
            roundRect(
                cx(posX(day.week)) - plot / 2 + length * 0.4,
                cz(posZ(day.weekday)) - plot / 2 - length,
                plot,
                plot
            )
        })
        context.fillStyle = PLOT
        for (let week = 0; week < SKYLINE_WEEKS; week++) {
            for (let weekday = 0; weekday < GRID_DAYS; weekday++) {
                roundRect(cx(posX(week)) - plot / 2, cz(posZ(weekday)) - plot / 2, plot, plot)
            }
        }
        context.fillStyle = LABEL
        context.textBaseline = 'middle'
        context.textAlign = 'left'
        const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        context.font = `500 ${0.5 * px}px ${font}`
        labels.months.forEach(({ week, text }) => {
            context.fillText(text, cx(posX(week) - 0.4), cz(posZ(GRID_DAYS - 1) + 1.2))
        })
        context.textAlign = 'right'
        context.font = `500 ${0.42 * px}px ${font}`
        labels.weekdays.forEach(({ weekday, text }) => {
            context.fillText(text, cx(posX(0) - 0.8), cz(posZ(weekday)))
        })
        groundTexture.needsUpdate = true
    }

    const boxGeometry = track(new BoxGeometry(FOOTPRINT, 1, FOOTPRINT))
    boxGeometry.translate(0, 0.5, 0)
    const buildingMaterial = track(
        new ShaderMaterial({
            uniforms: {
                uFog: { value: new Color(WHITE) },
                uFogNear: { value: 60 },
                uFogFar: { value: 120 },
            },
            vertexShader: buildingVertexShader,
            fragmentShader: buildingFragmentShader,
        })
    )
    const roofGeometry = track(new BoxGeometry(FOOTPRINT + 0.02, 0.06, FOOTPRINT + 0.02))
    const roofMaterial = track(new MeshBasicMaterial({ color: new Color(INBOX_GREEN) }))
    const marker = new Mesh(
        track(new ConeGeometry(0.26, 0.55, 4)),
        track(new MeshBasicMaterial({ color: new Color(HIGHLIGHT) }))
    )
    marker.rotation.x = Math.PI
    marker.visible = false
    scene.add(marker)

    // Per-day state, rebuilt by setDays.
    let buildings = null
    let roofs = null
    let roofIndices = []
    let baseColors = []
    let from = new Float32Array(0)
    let to = new Float32Array(0)
    let current = new Float32Array(0)
    let delay = new Float32Array(0)
    let animationStart = 0
    let animating = false
    let todayIndex = -1
    let hoverIndex = -1
    let selectedIndex = -1
    let celebrationStart = -1

    const dummy = new Object3D()
    const white = new Color(WHITE)
    const highlight = new Color(HIGHLIGHT)

    const disposeDayMeshes = () => {
        ;[buildings, roofs].forEach(mesh => {
            if (!mesh) return
            scene.remove(mesh)
            mesh.dispose()
        })
        buildings = roofs = null
    }

    const paint = index => {
        if (!buildings || index < 0 || index >= days.length) return
        let color = baseColors[index]
        if (index === selectedIndex) color = highlight
        else if (index === hoverIndex) color = baseColors[index].clone().lerp(white, 0.35)
        buildings.setColorAt(index, color)
        buildings.instanceColor.needsUpdate = true
    }

    // Today's green roof popping in, on the same celebration run as the 2D dot.
    const CELEBRATION_SECONDS = 1.6
    const celebrationScale = () => {
        if (celebrationStart < 0) return 1
        const t = (performance.now() / 1000 - celebrationStart) / CELEBRATION_SECONDS
        if (t >= 1) return 1
        if (t < 0.35) return (t / 0.35) * 1.6
        return 1.6 - 0.6 * ((t - 0.35) / 0.65)
    }

    const applyHeights = () => {
        if (!buildings) return
        for (let i = 0; i < days.length; i++) {
            dummy.position.set(posX(days[i].week), 0, posZ(days[i].weekday))
            dummy.scale.set(1, Math.max(current[i], 0.001), 1)
            dummy.updateMatrix()
            buildings.setMatrixAt(i, dummy.matrix)
        }
        buildings.instanceMatrix.needsUpdate = true
        roofIndices.forEach((i, k) => {
            const pop = i === todayIndex ? celebrationScale() : 1
            dummy.position.set(posX(days[i].week), current[i] + 0.03, posZ(days[i].weekday))
            dummy.scale.set(pop, 1, pop)
            dummy.updateMatrix()
            roofs.setMatrixAt(k, dummy.matrix)
        })
        roofs.instanceMatrix.needsUpdate = true
    }

    const setTargets = stagger => {
        for (let i = 0; i < days.length; i++) {
            from[i] = current[i]
            to[i] = getSkylineHeight(days[i].tasks, scale)
            delay[i] = reduceMotion ? 0 : days[i].week * stagger + days[i].weekday * 0.008
        }
        animationStart = performance.now() / 1000
        animating = true
    }

    const stepHeights = now => {
        if (!animating) return
        const t = now - animationStart
        let done = true
        for (let i = 0; i < days.length; i++) {
            const progress = reduceMotion ? 1 : Math.min(1, Math.max(0, (t - delay[i]) / RISE_DURATION))
            if (progress < 1) done = false
            const eased = 1 - Math.pow(1 - progress, 3)
            current[i] = from[i] + (to[i] - from[i]) * eased
        }
        if (done) animating = false
    }

    // Camera: the flyover, as an OFF-AXIS projection. The camera always looks straight down and
    // slides parallel to the ground as the page scrolls; the frustum is re-aimed every frame so the
    // ground plane (y = 0) always lands on exactly the same pixels. The plots and the month/weekday
    // legend are therefore fixed on the card like print, and only what stands up from it — the
    // buildings — leans with the scroll. That fixed ground is what sells the illusion that the city
    // is part of the page rather than a 3D view inside a box.
    const CAMERA_HEIGHT = 26
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

        // Positive tilt = the plane is still in front of the city (towards the month legend).
        const offsetZ = CAMERA_HEIGHT * Math.tan(flight.tilt)
        camera.position.set(0, CAMERA_HEIGHT, offsetZ)
        camera.lookAt(0, 0, offsetZ)

        // The window onto the ground, in camera space at the near plane. Screen-up is world -z.
        const near = camera.near
        const toNear = near / CAMERA_HEIGHT
        const left = (-viewWidth / 2) * toNear
        const right = (viewWidth / 2) * toNear
        const top = (viewDepth / 2 + offsetZ) * toNear
        const bottom = (-viewDepth / 2 + offsetZ) * toNear
        camera.projectionMatrix.makePerspective(left, right, top, bottom, near, camera.far)
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    }

    const resize = () => {
        const width = container.clientWidth
        const height = container.clientHeight
        if (!width || !height) return
        renderer.setSize(width, height, false)
        const aspect = width / height
        // Fit the whole year plus its legend, keeping the card's aspect ratio. Seen from straight
        // above, a roof sits further out than its base (by H / (H - h)), so the outermost weeks
        // need that much room or the tallest building on the edge would be cut off by the card.
        const tallest = SKYLINE_MAX_HEIGHT * 1.15
        const edgeRoof = ((SKYLINE_WEEKS - 1) / 2 + FOOTPRINT / 2) * (CAMERA_HEIGHT / (CAMERA_HEIGHT - tallest))
        const neededWidth = 2 * Math.max(edgeRoof + 0.4, SKYLINE_WEEKS / 2 + 2.6)
        const neededDepth = GRID_DAYS + MARGIN_Z * 2
        viewWidth = Math.max(neededWidth, neededDepth * aspect)
        viewDepth = viewWidth / aspect
    }

    // Interaction: hover (mouse) and tap only. Page scrolling is never intercepted; the one event
    // stopped here is the click, so a tap on the city is not also a press on the card around it.
    const raycaster = new Raycaster()
    const pointerNdc = new Vector2()
    let downAt = null

    const pick = (clientX, clientY) => {
        if (!buildings) return -1
        const rect = canvas.getBoundingClientRect()
        pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
        raycaster.setFromCamera(pointerNdc, camera)
        const hit = raycaster.intersectObject(buildings, false)[0]
        return hit ? hit.instanceId : -1
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

    // Only draw while the card is on screen: the loop reads the scroll position every frame, which
    // is exactly the work to skip when nobody can see the city.
    let frameId = 0
    let disposed = false
    let visible = true
    const frame = () => {
        frameId = 0
        if (disposed || !visible) return
        const now = performance.now() / 1000
        stepHeights(now)
        applyHeights()
        if (todayIndex >= 0) {
            const day = days[todayIndex]
            marker.visible = true
            marker.position.set(
                posX(day.week),
                current[todayIndex] + 0.9 + (reduceMotion ? 0 : Math.sin(now * 2.2) * 0.12),
                posZ(day.weekday)
            )
            marker.rotation.y = reduceMotion ? 0 : now * 0.8
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
         * Replaces the city. Buildings keep their current heights where the same day is still
         * present, so a statistics update grows the affected buildings instead of re-raising the
         * whole year.
         */
        setDays(nextDays, nextLabels) {
            const previousHeights = new Map(days.map((day, i) => [day.dateKey, current[i]]))
            const firstBuild = days.length === 0
            disposeDayMeshes()
            days = nextDays
            labels = nextLabels || labels
            scale = getSkylineScale(days)
            drawGround()

            const count = days.length
            from = new Float32Array(count)
            to = new Float32Array(count)
            delay = new Float32Array(count)
            current = new Float32Array(count)
            days.forEach((day, i) => {
                current[i] = previousHeights.has(day.dateKey) ? previousHeights.get(day.dateKey) : 0
            })
            todayIndex = days.findIndex(day => day.isToday)
            if (selectedIndex >= count) selectedIndex = -1
            hoverIndex = -1

            baseColors = days.map(day => new Color(day.tasks > 0 ? getSkylineColor(day.tasks, scale) : PLOT))
            buildings = new InstancedMesh(boxGeometry, buildingMaterial, Math.max(count, 1))
            buildings.count = count
            buildings.frustumCulled = false
            baseColors.forEach((color, i) => buildings.setColorAt(i, color))
            if (count === 0) buildings.setColorAt(0, new Color(PLOT))
            scene.add(buildings)

            roofIndices = days.map((day, i) => (day.achieved ? i : -1)).filter(i => i >= 0)
            roofs = new InstancedMesh(roofGeometry, roofMaterial, Math.max(roofIndices.length, 1))
            roofs.count = roofIndices.length
            roofs.frustumCulled = false
            scene.add(roofs)

            days.forEach((_, i) => paint(i))
            setTargets(firstBuild ? 0.03 : 0.004)
            applyHeights()
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
            disposeDayMeshes()
            disposables.forEach(item => item.dispose())
            renderer.dispose()
            if (renderer.forceContextLoss) renderer.forceContextLoss()
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
        },
    }
}
