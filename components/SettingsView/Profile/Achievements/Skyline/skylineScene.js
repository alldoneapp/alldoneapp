import {
    AdditiveBlending,
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    Color,
    ConeGeometry,
    InstancedMesh,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    PerspectiveCamera,
    PlaneGeometry,
    Points,
    PointsMaterial,
    Raycaster,
    Scene,
    ShaderMaterial,
    SRGBColorSpace,
    Vector2,
    Vector3,
    WebGLRenderer,
} from 'three'

import { colors } from '../../../../styles/global'
import { getSkylineHeight, SKYLINE_WEEKS } from './skylineData'

/**
 * The imperative half of the Empty inbox skyline: a three.js city where every building is one day.
 *
 * Loaded through a dynamic `import()` from `EmptyInboxSkyline`, so three.js lands in its own chunk
 * and is only downloaded by a browser that can actually draw it. React never touches anything in
 * here; the component hands over plain day records and gets hover/select callbacks back.
 *
 * Palette is Alldone's own: the night is the sidebar navy (`Secondary400`), a cleared inbox is the
 * same `UtilityGreen200` the 2D grid uses for an achieved cell, today is `Primary100` like the 2D
 * today outline, and each building takes its busiest project's marker colour.
 */

const FOOTPRINT = 0.78
const GRID_DAYS = 7
const MARGIN_X = 3.5
const MARGIN_Z = 3.2
const GROUND_PX_PER_UNIT = 40
const RISE_DURATION = 0.9
const MIN_RADIUS = 10
const MAX_RADIUS = 150

const NIGHT = colors.Secondary400
const HORIZON = colors.Secondary300
const EMPTY_DAY = '#1d2c66'
const INBOX_GREEN = colors.UtilityGreen200
const INBOX_GLOW = colors.UtilityGreen150
const TODAY = colors.Primary100
const LABEL = 'rgba(169,180,214,0.7)'

const posX = week => week - (SKYLINE_WEEKS - 1) / 2
const posZ = weekday => weekday - (GRID_DAYS - 1) / 2

const buildingVertexShader = `
    varying vec3 vWorld; varying vec3 vN; varying vec3 vColor; varying vec3 vLocal; varying float vH;
    void main() {
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vLocal = position;
        vH = instanceMatrix[1][1];
        #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
        #else
            vColor = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * world;
    }`

// Lit sides, brighter roofs and a grid of windows, a random share of them lit. Plain GLSL rather
// than a lit built-in material so a year of buildings is one draw call with no lights to manage.
const buildingFragmentShader = `
    uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; uniform vec3 uLight;
    varying vec3 vWorld; varying vec3 vN; varying vec3 vColor; varying vec3 vLocal; varying float vH;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
        vec3 n = normalize(vN);
        float diff = max(dot(n, normalize(uLight)), 0.0);
        vec3 col = vColor * (0.45 + 0.65 * diff);
        float isSide = 1.0 - step(0.5, abs(n.y));
        if (n.y > 0.5) col = vColor * 1.2;
        float across = abs(n.x) > 0.5 ? vLocal.z : vLocal.x;
        vec2 g = vec2((across + ${(FOOTPRINT / 2).toFixed(3)}) / ${FOOTPRINT.toFixed(3)} * 4.0, vWorld.y * 4.2);
        vec2 f = fract(g); vec2 id = floor(g);
        float win = step(0.26, f.x) * step(f.x, 0.74) * step(0.3, f.y) * step(f.y, 0.72);
        vec2 building = floor(vWorld.xz + 0.5);
        float lit = step(0.52, hash(id + building * 13.0 + (n.x + n.z * 3.0)));
        float inside = step(0.25, vWorld.y) * step(vWorld.y, vH - 0.2);
        vec3 warm = mix(vec3(1.0, 0.86, 0.6), vColor + 0.4, 0.3);
        col = mix(col, warm, win * lit * inside * isSide * 0.9);
        col = mix(col, col * 0.6, win * (1.0 - lit) * inside * isSide);
        float d = length(vWorld - cameraPosition);
        col = mix(col, uFog, smoothstep(uFogNear, uFogFar, d) * 0.85);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
    }`

function makeSkyTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 256
    const context = canvas.getContext('2d')
    const gradient = context.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0, '#050c2a')
    gradient.addColorStop(0.6, NIGHT)
    gradient.addColorStop(1, HORIZON)
    context.fillStyle = gradient
    context.fillRect(0, 0, 4, 256)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return texture
}

function makeGlowTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const context = canvas.getContext('2d')
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, INBOX_GLOW)
    gradient.addColorStop(0.35, 'rgba(0,194,130,0.45)')
    gradient.addColorStop(1, 'rgba(0,194,130,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return texture
}

/**
 * @param {HTMLElement} container an empty element the canvas is appended to; it must have a size
 * @param {Object} options
 * @param {(index: number) => void} options.onHover  -1 when the pointer leaves every building
 * @param {(index: number) => void} options.onSelect -1 for a tap on empty ground
 * @param {boolean} options.reduceMotion
 */
export function createSkylineScene(container, { onHover, onSelect, reduceMotion = false }) {
    const renderer = new WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = SRGBColorSpace
    const canvas = renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.cursor = 'grab'
    // Vertical swipes keep scrolling the page this card sits in; horizontal drags orbit the city.
    canvas.style.touchAction = 'pan-y'
    container.appendChild(canvas)

    const scene = new Scene()
    const skyTexture = makeSkyTexture()
    scene.background = skyTexture
    const camera = new PerspectiveCamera(36, 1, 0.5, 500)

    const disposables = [skyTexture]
    const track = item => {
        disposables.push(item)
        return item
    }

    // Ground: a canvas texture carrying the plot grid and the month/weekday labels.
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
        track(new MeshBasicMaterial({ map: groundTexture }))
    )
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)

    let labels = { months: [], weekdays: [] }
    const drawGround = () => {
        const context = groundCanvas.getContext('2d')
        const px = GROUND_PX_PER_UNIT
        const cx = x => (x + groundWidth / 2) * px
        const cz = z => (z + groundDepth / 2) * px
        const gradient = context.createRadialGradient(cx(0), cz(0), 20, cx(0), cz(0), groundWidth * px * 0.55)
        gradient.addColorStop(0, '#0f1f5c')
        gradient.addColorStop(1, '#060e33')
        context.fillStyle = gradient
        context.fillRect(0, 0, groundCanvas.width, groundCanvas.height)
        context.fillStyle = 'rgba(169,180,214,0.07)'
        const plot = 0.9 * px
        for (let week = 0; week < SKYLINE_WEEKS; week++) {
            for (let weekday = 0; weekday < GRID_DAYS; weekday++) {
                context.fillRect(cx(posX(week)) - plot / 2, cz(posZ(weekday)) - plot / 2, plot, plot)
            }
        }
        context.fillStyle = LABEL
        context.textBaseline = 'middle'
        context.textAlign = 'left'
        context.font = `600 ${0.62 * px}px sans-serif`
        labels.months.forEach(({ week, text }) => {
            context.fillText(text, cx(posX(week) - 0.4), cz(posZ(GRID_DAYS - 1) + 1.3))
        })
        context.textAlign = 'right'
        context.font = `500 ${0.44 * px}px sans-serif`
        labels.weekdays.forEach(({ weekday, text }) => {
            context.fillText(text, cx(posX(0) - 0.8), cz(posZ(weekday)))
        })
        groundTexture.needsUpdate = true
    }

    // Stars — fixed seed so the sky does not rearrange itself between visits.
    {
        let seed = 7
        const random = () => {
            seed = (seed * 16807) % 2147483647
            return seed / 2147483647
        }
        const count = 600
        const positions = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
            const theta = random() * Math.PI * 2
            const phi = random() * 1.2
            positions[i * 3] = Math.sin(phi) * Math.cos(theta) * 220
            positions[i * 3 + 1] = Math.cos(phi) * 154 + 10
            positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * 220
        }
        const geometry = track(new BufferGeometry())
        geometry.setAttribute('position', new BufferAttribute(positions, 3))
        scene.add(
            new Points(
                geometry,
                track(
                    new PointsMaterial({
                        color: 0xc8d4ff,
                        size: 1.4,
                        sizeAttenuation: false,
                        transparent: true,
                        opacity: 0.7,
                    })
                )
            )
        )
    }

    const boxGeometry = track(new BoxGeometry(FOOTPRINT, 1, FOOTPRINT))
    boxGeometry.translate(0, 0.5, 0)
    const buildingMaterial = track(
        new ShaderMaterial({
            uniforms: {
                uFog: { value: new Color(HORIZON) },
                uFogNear: { value: 55 },
                uFogFar: { value: 170 },
                uLight: { value: new Vector3(-0.5, 0.9, 0.6) },
            },
            vertexShader: buildingVertexShader,
            fragmentShader: buildingFragmentShader,
        })
    )
    const roofGeometry = track(new BoxGeometry(FOOTPRINT + 0.04, 0.07, FOOTPRINT + 0.04))
    const roofMaterial = track(new MeshBasicMaterial({ color: new Color(INBOX_GREEN) }))
    const glowTexture = track(makeGlowTexture())
    const glowMaterial = track(
        new PointsMaterial({
            map: glowTexture,
            size: 2.2,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
        })
    )
    const marker = new Mesh(
        track(new ConeGeometry(0.28, 0.6, 4)),
        track(new MeshBasicMaterial({ color: new Color(TODAY) }))
    )
    marker.rotation.x = Math.PI
    marker.visible = false
    scene.add(marker)

    // Per-day state, rebuilt by setDays.
    let days = []
    let buildings = null
    let roofs = null
    let glows = null
    let glowGeometry = null
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
    const white = new Color('#ffffff')

    const disposeDayMeshes = () => {
        ;[buildings, roofs, glows].forEach(mesh => {
            if (!mesh) return
            scene.remove(mesh)
            if (mesh.dispose) mesh.dispose()
        })
        if (glowGeometry) glowGeometry.dispose()
        buildings = roofs = glows = glowGeometry = null
    }

    const paint = index => {
        if (!buildings || index < 0 || index >= days.length) return
        const color = baseColors[index].clone()
        if (index === selectedIndex) color.lerp(white, 0.5)
        else if (index === hoverIndex) color.lerp(white, 0.3)
        buildings.setColorAt(index, color)
        buildings.instanceColor.needsUpdate = true
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
        const positions = glowGeometry.attributes.position.array
        roofIndices.forEach((i, k) => {
            const pop = i === todayIndex ? celebrationScale() : 1
            dummy.position.set(posX(days[i].week), current[i] + 0.035, posZ(days[i].weekday))
            dummy.scale.set(pop, current[i] > 0.02 ? 1 : 0.001, pop)
            dummy.updateMatrix()
            roofs.setMatrixAt(k, dummy.matrix)
            positions[k * 3] = posX(days[i].week)
            positions[k * 3 + 1] = current[i] + 0.2 + (pop - 1) * 0.6
            positions[k * 3 + 2] = posZ(days[i].weekday)
        })
        roofs.instanceMatrix.needsUpdate = true
        glowGeometry.attributes.position.needsUpdate = true
    }

    // Today's roof lighting up: scales in from nothing, overshoots and settles. Driven by the same
    // celebration run the 2D dot uses, so the two can never both play.
    const CELEBRATION_SECONDS = 1.6
    const celebrationScale = () => {
        if (celebrationStart < 0) return 1
        const t = (performance.now() / 1000 - celebrationStart) / CELEBRATION_SECONDS
        if (t >= 1) return 1
        if (t < 0.35) return (t / 0.35) * 1.8
        return 1.8 - 0.8 * ((t - 0.35) / 0.65)
    }

    const setTargets = stagger => {
        for (let i = 0; i < days.length; i++) {
            from[i] = current[i]
            to[i] = getSkylineHeight(days[i].tasks)
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

    // Camera: a simple orbit around the middle of the year.
    const target = new Vector3(0, 1.5, 0)
    const orbit = { theta: -0.32, phi: 1.05, radius: 60 }
    let interacted = false
    let defaultView = { ...orbit }
    const computeDefaultView = () => {
        const aspect = camera.aspect
        const vfov = MathUtils.degToRad(camera.fov)
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect)
        const radius = (SKYLINE_WEEKS / 2 + 3) / Math.tan(hfov / 2)
        return {
            theta: aspect < 1.2 ? -0.9 : -0.32,
            phi: 1.02,
            radius: MathUtils.clamp(aspect < 1.2 ? radius * 0.55 : radius, 24, MAX_RADIUS),
        }
    }
    const placeCamera = () => {
        const s = Math.sin(orbit.phi)
        camera.position.set(
            target.x + orbit.radius * s * Math.sin(orbit.theta),
            target.y + orbit.radius * Math.cos(orbit.phi),
            target.z + orbit.radius * s * Math.cos(orbit.theta)
        )
        camera.lookAt(target)
    }

    const resize = () => {
        const width = container.clientWidth
        const height = container.clientHeight
        if (!width || !height) return
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        defaultView = computeDefaultView()
        if (!interacted) Object.assign(orbit, defaultView)
    }

    // Interaction. Every pointer event the canvas handles is stopped here, so a drag across the
    // city can never reach the achievements card's own press handler underneath it.
    const raycaster = new Raycaster()
    const pointerNdc = new Vector2()
    const pointers = new Map()
    let moved = 0
    let pinchDistance = 0
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
        canvas.style.cursor = index >= 0 ? 'pointer' : 'grab'
        onHover(index)
    }

    const stop = event => event.stopPropagation()
    const onPointerDown = event => {
        event.stopPropagation()
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType })
        if (pointers.size === 1) {
            moved = 0
            downAt = { x: event.clientX, y: event.clientY }
            try {
                canvas.setPointerCapture(event.pointerId)
            } catch (error) {}
        }
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()]
            pinchDistance = Math.hypot(a.x - b.x, a.y - b.y)
        }
    }
    const onPointerMove = event => {
        const pointer = pointers.get(event.pointerId)
        if (!pointer) {
            if (event.pointerType === 'mouse') setHover(pick(event.clientX, event.clientY))
            return
        }
        event.stopPropagation()
        const dx = event.clientX - pointer.x
        const dy = event.clientY - pointer.y
        pointer.x = event.clientX
        pointer.y = event.clientY
        if (pointers.size === 1) {
            moved += Math.abs(dx) + Math.abs(dy)
            if (moved > 6) {
                interacted = true
                canvas.style.cursor = 'grabbing'
            }
            orbit.theta -= dx * 0.005
            // Only a mouse tilts: on touch the vertical axis belongs to page scrolling.
            if (pointer.type === 'mouse') orbit.phi = MathUtils.clamp(orbit.phi - dy * 0.004, 0.3, 1.42)
        } else if (pointers.size === 2) {
            moved = 99
            interacted = true
            const [a, b] = [...pointers.values()]
            const distance = Math.hypot(a.x - b.x, a.y - b.y)
            if (pinchDistance) {
                orbit.radius = MathUtils.clamp(orbit.radius * (pinchDistance / distance), MIN_RADIUS, MAX_RADIUS)
            }
            pinchDistance = distance
        }
    }
    const onPointerUp = event => {
        if (!pointers.has(event.pointerId)) return
        event.stopPropagation()
        pointers.delete(event.pointerId)
        if (pointers.size === 0) {
            canvas.style.cursor = hoverIndex >= 0 ? 'pointer' : 'grab'
            if (moved <= 6 && downAt) {
                const index = pick(event.clientX, event.clientY)
                selectIndex(index)
                onSelect(index)
            }
            downAt = null
        }
        if (pointers.size < 2) pinchDistance = 0
    }
    const onPointerLeave = event => {
        if (event.pointerType === 'mouse' && pointers.size === 0) setHover(-1)
    }
    // Plain wheel scrolls the page the card lives in; ctrl/cmd + wheel (and trackpad pinch,
    // which browsers report as ctrl + wheel) zooms the city.
    const onWheel = event => {
        if (!event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        event.stopPropagation()
        interacted = true
        orbit.radius = MathUtils.clamp(orbit.radius * (1 + event.deltaY * 0.01), MIN_RADIUS, MAX_RADIUS)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    ;['click', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach(type => canvas.addEventListener(type, stop))

    const selectIndex = index => {
        const previous = selectedIndex
        selectedIndex = index
        paint(previous)
        paint(index)
    }

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    if (resizeObserver) resizeObserver.observe(container)
    resize()

    let frameId = 0
    let disposed = false
    const startTime = performance.now() / 1000
    const frame = () => {
        if (disposed) return
        const now = performance.now() / 1000
        stepHeights(now)
        if (buildings) applyHeights()
        if (!interacted && !reduceMotion) orbit.theta = defaultView.theta + Math.sin((now - startTime) * 0.09) * 0.3
        if (todayIndex >= 0) {
            const day = days[todayIndex]
            marker.visible = true
            marker.position.set(
                posX(day.week),
                current[todayIndex] + 1.1 + (reduceMotion ? 0 : Math.sin(now * 2.2) * 0.15),
                posZ(day.weekday)
            )
            marker.rotation.y = reduceMotion ? 0 : now * 0.8
        }
        placeCamera()
        renderer.render(scene, camera)
        frameId = requestAnimationFrame(frame)
    }
    frameId = requestAnimationFrame(frame)

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

            baseColors = days.map(day =>
                day.dominantColor ? new Color(day.dominantColor).multiplyScalar(0.62) : new Color(EMPTY_DAY)
            )
            buildings = new InstancedMesh(boxGeometry, buildingMaterial, Math.max(count, 1))
            buildings.count = count
            buildings.frustumCulled = false
            baseColors.forEach((color, i) => buildings.setColorAt(i, color))
            if (count === 0) buildings.setColorAt(0, new Color(EMPTY_DAY))
            scene.add(buildings)

            roofIndices = days.map((day, i) => (day.achieved ? i : -1)).filter(i => i >= 0)
            roofs = new InstancedMesh(roofGeometry, roofMaterial, Math.max(roofIndices.length, 1))
            roofs.count = roofIndices.length
            roofs.frustumCulled = false
            scene.add(roofs)
            glowGeometry = new BufferGeometry()
            glowGeometry.setAttribute('position', new BufferAttribute(new Float32Array(roofIndices.length * 3), 3))
            glows = new Points(glowGeometry, glowMaterial)
            glows.frustumCulled = false
            scene.add(glows)

            days.forEach((_, i) => paint(i))
            setTargets(firstBuild ? 0.035 : 0.004)
            applyHeights()
        },
        select(index) {
            selectIndex(index)
        },
        celebrateToday() {
            if (!reduceMotion) celebrationStart = performance.now() / 1000
        },
        resetView() {
            interacted = false
            Object.assign(orbit, defaultView)
        },
        destroy() {
            disposed = true
            cancelAnimationFrame(frameId)
            if (resizeObserver) resizeObserver.disconnect()
            canvas.removeEventListener('pointerdown', onPointerDown)
            canvas.removeEventListener('pointermove', onPointerMove)
            canvas.removeEventListener('pointerup', onPointerUp)
            canvas.removeEventListener('pointercancel', onPointerUp)
            canvas.removeEventListener('pointerleave', onPointerLeave)
            canvas.removeEventListener('wheel', onWheel)
            ;['click', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach(type =>
                canvas.removeEventListener(type, stop)
            )
            disposeDayMeshes()
            disposables.forEach(item => item.dispose())
            renderer.dispose()
            if (renderer.forceContextLoss) renderer.forceContextLoss()
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
        },
    }
}
