import {
    Color,
    DirectionalLight,
    Group,
    HemisphereLight,
    NeutralToneMapping,
    PerspectiveCamera,
    PMREMGenerator,
    Scene,
    SRGBColorSpace,
    WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import { buildThinkingAnimation } from './thinkingAnimations'
import {
    createInteraction,
    pressCancel,
    pressEnd,
    pressMove,
    pressStart,
    setHovering,
    stepInteraction,
} from './thinkingInteraction'

/**
 * One WebGL renderer for every loading assistant card on the page. A chat can show several loading
 * cards at once (the placeholder, a run in the popup, the My Day line) and browsers cap the number
 * of live WebGL contexts at ~16, dropping the OLDEST when a page asks for more — so a context per
 * card would eventually blank the skyline or the gold coins elsewhere in the app.
 *
 * Instead the renderer draws off-screen: each frame, every visible card's scene is rendered into the
 * bottom-left corner of the shared canvas (scissored to the card's size) and copied into that card's
 * own 2D canvas with `drawImage`. The copy happens in the same task as the render, so the drawing
 * buffer is still valid without `preserveDrawingBuffer`.
 *
 * The loop runs only while at least one mounted card is on screen: cards scrolled out of view are
 * skipped (IntersectionObserver), and the browser already stops rAF in a background tab.
 *
 * The scenes are also something to play with while waiting (`thinkingInteraction.js`): they turn
 * towards an approaching cursor, can be dragged and flung, and react to a click or tap. One
 * document-level `pointermove` listener tracks the cursor for every card, installed with the first
 * card and removed with the last.
 */

const CAMERA_DISTANCE = 5.2
const CAMERA_FOV = 32
const MAX_PIXEL_RATIO = 2

let stage = null
// The cursor's last viewport position, or null when it is not over the page.
let pointer = null
let pointerListeners = null

function installPointerTracking() {
    if (pointerListeners || typeof document === 'undefined') return
    const move = event => {
        if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
        pointer = { x: event.clientX, y: event.clientY }
    }
    const leave = event => {
        if (!event.relatedTarget) pointer = null
    }
    const blur = () => {
        pointer = null
    }
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerout', leave, { passive: true })
    window.addEventListener('blur', blur)
    pointerListeners = { move, leave, blur }
}

function removePointerTracking() {
    if (!pointerListeners) return
    document.removeEventListener('pointermove', pointerListeners.move)
    document.removeEventListener('pointerout', pointerListeners.leave)
    window.removeEventListener('blur', pointerListeners.blur)
    pointerListeners = null
    pointer = null
}

// The cursor's offset from a card's stage centre, read once per frame per visible card.
function pointerOffset(host) {
    if (!pointer || typeof host.getBoundingClientRect !== 'function') return null
    const rect = host.getBoundingClientRect()
    return { dx: pointer.x - (rect.left + rect.width / 2), dy: pointer.y - (rect.top + rect.height / 2) }
}

function createStage() {
    const renderer = new WebGLRenderer({ antialias: true, alpha: true })
    // Views are sized in device pixels by hand, so the renderer itself works in raw pixels.
    renderer.setPixelRatio(1)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = NeutralToneMapping
    renderer.setClearColor(0x000000, 0)
    renderer.setScissorTest(true)
    let environment = null
    try {
        const pmrem = new PMREMGenerator(renderer)
        environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
        pmrem.dispose()
    } catch (error) {
        // Without reflections the lights alone still shade every scene.
    }
    const created = {
        renderer,
        environment,
        views: new Set(),
        width: 0,
        height: 0,
        frame: null,
        lost: false,
    }
    renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault()
        created.lost = true
        created.views.forEach(view => view.fail(new Error('WebGL context lost')))
    })
    return created
}

function getStage() {
    if (!stage || stage.lost) stage = createStage()
    return stage
}

function ensureCapacity(current, width, height) {
    if (width <= current.width && height <= current.height) return
    current.width = Math.max(current.width, width)
    current.height = Math.max(current.height, height)
    current.renderer.setSize(current.width, current.height, false)
}

function renderFrame(now) {
    const current = stage
    if (!current) return
    current.frame = null
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    let drew = false
    current.views.forEach(view => {
        if (!view.visible || view.failed) return
        const width = Math.round(view.cssWidth * pixelRatio)
        const height = Math.round(view.cssHeight * pixelRatio)
        if (width < 1 || height < 1) return
        try {
            ensureCapacity(current, width, height)
            if (view.canvas.width !== width || view.canvas.height !== height) {
                view.canvas.width = width
                view.canvas.height = height
            }
            // A rAF timestamp is the frame's start, which can precede the mount by a few ms.
            const elapsed = Math.max(0, now - view.startedAt) / 1000
            const dt = view.lastFrameAt === null ? 0 : Math.max(0, now - view.lastFrameAt) / 1000
            view.lastFrameAt = now
            const played = stepInteraction(
                view.interaction,
                dt,
                pointerOffset(view.host),
                Math.min(view.cssWidth, view.cssHeight)
            )
            view.wrapper.rotation.set(played.pitch, played.yaw, 0)
            view.wrapper.scale.set(played.scaleX, played.scaleY, played.scaleX)
            view.animation.update(elapsed + played.timeBoost, played.fx)
            const { renderer } = current
            renderer.setViewport(0, 0, width, height)
            renderer.setScissor(0, 0, width, height)
            renderer.render(view.scene, view.camera)
            const glCanvas = renderer.domElement
            view.context.clearRect(0, 0, width, height)
            view.context.drawImage(glCanvas, 0, glCanvas.height - height, width, height, 0, 0, width, height)
            drew = true
            if (!view.ready) {
                view.ready = true
                view.onReady()
            }
        } catch (error) {
            view.fail(error)
        }
    })
    if (drew || hasVisibleViews(current)) scheduleFrame()
}

function hasVisibleViews(current) {
    for (const view of current.views) if (view.visible && !view.failed) return true
    return false
}

function scheduleFrame() {
    if (!stage || stage.frame !== null || !hasVisibleViews(stage)) return
    stage.frame = window.requestAnimationFrame(renderFrame)
}

function disposeScene(scene) {
    const materials = new Set()
    scene.traverse(object => {
        if (object.geometry) object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) material.forEach(entry => materials.add(entry))
        else if (material) materials.add(material)
    })
    materials.forEach(material => material.dispose())
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * Lets the user grab, fling and poke the scene. The stage sits inside a chat message that has its
 * own gestures (swipe-to-quote, press handlers, popup dismissal), so every press that starts on the
 * stage stops there — dragging the scene must never also swipe the message.
 */
function attachInteraction(host, view) {
    const state = view.interaction
    const stop = event => event.stopPropagation()
    const setCursor = value => {
        host.style.cursor = value
    }
    const down = event => {
        event.stopPropagation()
        if (event.button !== undefined && event.button !== 0) return
        event.preventDefault()
        if (host.setPointerCapture && event.pointerId !== undefined) {
            try {
                host.setPointerCapture(event.pointerId)
            } catch (error) {
                // A synthetic or already-released pointer; dragging still works without capture.
            }
        }
        pressStart(state, event.clientX, event.clientY, clock())
        setCursor('grabbing')
        scheduleFrame()
    }
    const move = event => {
        if (!state.dragging) return
        event.stopPropagation()
        pressMove(state, event.clientX, event.clientY, clock())
    }
    const up = event => {
        if (!state.dragging) return
        event.stopPropagation()
        pressEnd(state, clock())
        setCursor('grab')
    }
    const cancel = () => {
        pressCancel(state)
        setCursor('grab')
    }
    const enter = () => setHovering(state, true)
    const leave = () => setHovering(state, false)
    host.style.touchAction = 'none'
    host.style.userSelect = 'none'
    setCursor('grab')
    const listeners = [
        ['pointerdown', down],
        ['pointermove', move],
        ['pointerup', up],
        ['pointercancel', cancel],
        ['lostpointercapture', cancel],
        ['pointerenter', enter],
        ['pointerleave', leave],
        // The rest only need to not reach the message: its own handlers listen for these too.
        ['mousedown', stop],
        ['touchstart', stop],
        ['click', stop],
    ]
    listeners.forEach(([type, listener]) => host.addEventListener(type, listener))
    return () => {
        listeners.forEach(([type, listener]) => host.removeEventListener(type, listener))
        host.style.cursor = ''
    }
}

/**
 * Starts drawing `animation` inside `host` (a DOM element) and returns a function that stops it.
 * `onReady` fires after the first frame is on screen; `onFailure` if the scene cannot be drawn —
 * the caller keeps its own fallback visible until `onReady`, and brings it back on `onFailure`.
 */
export function mountThinkingView(host, { animation, appearance = 'light', onReady = () => {}, onFailure = () => {} }) {
    const current = getStage()
    const canvas = document.createElement('canvas')
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', pointerEvents: 'none' })
    canvas.setAttribute('aria-hidden', 'true')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D canvas unavailable')
    host.appendChild(canvas)

    const scene = new Scene()
    scene.environment = current.environment
    scene.add(new HemisphereLight(0xffffff, new Color(appearance === 'dark' ? '#1A3289' : '#C7E3FF'), 1.1))
    const key = new DirectionalLight(0xffffff, 2.2)
    key.position.set(-1.5, 2.5, 3)
    scene.add(key)
    const built = buildThinkingAnimation(animation, appearance)
    // What the user does (look-at, drag, poke) is applied to this wrapper, so a scene's own
    // animation of its root is never fought over.
    const wrapper = new Group()
    wrapper.add(built.root)
    scene.add(wrapper)

    const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 50)
    camera.position.set(0, 0, CAMERA_DISTANCE)
    camera.lookAt(0, 0, 0)

    const view = {
        canvas,
        context,
        scene,
        camera,
        animation: built,
        host,
        wrapper,
        interaction: createInteraction(),
        lastFrameAt: null,
        startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        cssWidth: host.clientWidth || 0,
        cssHeight: host.clientHeight || 0,
        visible: true,
        ready: false,
        failed: false,
        onReady,
        fail(error) {
            if (view.failed) return
            view.failed = true
            onFailure(error)
        },
    }
    const updateAspect = () => {
        camera.aspect = view.cssHeight > 0 ? view.cssWidth / view.cssHeight : 1
        camera.updateProjectionMatrix()
    }
    updateAspect()

    let resizeObserver = null
    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(entries => {
            const rect = entries[entries.length - 1].contentRect
            view.cssWidth = rect.width
            view.cssHeight = rect.height
            updateAspect()
            scheduleFrame()
        })
        resizeObserver.observe(host)
    }
    let intersectionObserver = null
    if (typeof IntersectionObserver !== 'undefined') {
        intersectionObserver = new IntersectionObserver(entries => {
            view.visible = entries[entries.length - 1].isIntersecting
            scheduleFrame()
        })
        intersectionObserver.observe(host)
    }

    const detachInteraction = attachInteraction(host, view)
    installPointerTracking()
    current.views.add(view)
    scheduleFrame()

    return () => {
        current.views.delete(view)
        detachInteraction()
        if (current.views.size === 0) removePointerTracking()
        if (resizeObserver) resizeObserver.disconnect()
        if (intersectionObserver) intersectionObserver.disconnect()
        disposeScene(scene)
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
        if (current.views.size === 0 && current.frame !== null) {
            window.cancelAnimationFrame(current.frame)
            current.frame = null
        }
    }
}

export const __resetThinkingStageForTests = () => {
    stage = null
    removePointerTracking()
}
