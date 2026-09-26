import {
    AdditiveBlending,
    Color,
    CylinderGeometry,
    DirectionalLight,
    Group,
    HemisphereLight,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    NeutralToneMapping,
    OrthographicCamera,
    PMREMGenerator,
    RingGeometry,
    Scene,
    SRGBColorSpace,
    TorusGeometry,
    WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import { coinPositionAt, planCoinFlights } from './coinFlight'

/**
 * The full-app layer the earned gold coins fly across: one transparent, fixed canvas over the whole
 * window that never takes a pointer event. It is created on the first flight, shared by every
 * flight after that, and only renders while coins are in the air — between flights the loop is
 * stopped and the canvas holds a cleared, transparent frame, so it costs nothing.
 *
 * Coordinates are CSS pixels: an orthographic camera maps one world unit to one pixel with y
 * pointing down the viewport, so a coin placed at the checkbox's `getBoundingClientRect()` centre is
 * drawn exactly over it.
 */

const COIN_RADIUS = 12
const GOLD = '#F2B233'
const GOLD_RIM = '#FFD479'
const Z_INDEX = 900

let overlay = null

function createOverlay() {
    const renderer = new WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = NeutralToneMapping
    renderer.setClearColor(0x000000, 0)
    const canvas = renderer.domElement
    Object.assign(canvas.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: String(Z_INDEX),
    })
    canvas.setAttribute('aria-hidden', 'true')
    document.body.appendChild(canvas)

    const scene = new Scene()
    // Metal only looks like metal when it has something to reflect.
    try {
        const pmrem = new PMREMGenerator(renderer)
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
        pmrem.dispose()
    } catch (error) {
        // Without it the lights alone still give a warm gold.
    }
    scene.add(new HemisphereLight(0xffffff, new Color('#8a7a60'), 1.2))
    const key = new DirectionalLight(0xffffff, 2.4)
    key.position.set(-0.6, 1, 1.4)
    scene.add(key)

    const camera = new OrthographicCamera(0, 1, 0, -1, -1000, 1000)
    camera.position.z = 100
    const resize = () => {
        const width = window.innerWidth
        const height = window.innerHeight
        renderer.setSize(width, height, false)
        camera.left = 0
        camera.right = width
        camera.top = 0
        camera.bottom = -height
        camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)

    // A coin: a thick gold disc, and a slightly brighter raised rim on each face.
    const faceGeometry = new CylinderGeometry(1, 1, 0.18, 40)
    faceGeometry.rotateX(Math.PI / 2)
    const rimGeometry = new TorusGeometry(0.82, 0.08, 10, 40)
    // Pure metal facing the camera mirrors the darker half of the room and reads brown; a touch of
    // diffuse, a stronger reflection and a faint warm glow keep it reading as bright gold.
    const coinMaterial = new MeshStandardMaterial({
        color: new Color(GOLD),
        metalness: 0.85,
        roughness: 0.32,
        envMapIntensity: 1.6,
        emissive: new Color('#7A4E00'),
        emissiveIntensity: 0.35,
    })
    const rimMaterial = new MeshStandardMaterial({
        color: new Color(GOLD_RIM),
        metalness: 0.9,
        roughness: 0.2,
        envMapIntensity: 1.8,
        emissive: new Color('#8A6000'),
        emissiveIntensity: 0.3,
    })
    const ringGeometry = new RingGeometry(0.72, 1, 32)
    const makeCoin = () => {
        const coin = new Group()
        coin.add(new Mesh(faceGeometry, coinMaterial))
        ;[-0.095, 0.095].forEach(z => {
            const rim = new Mesh(rimGeometry, rimMaterial)
            rim.position.z = z
            coin.add(rim)
        })
        return coin
    }
    const makeRing = () =>
        new Mesh(
            ringGeometry,
            new MeshBasicMaterial({
                color: new Color(GOLD_RIM),
                transparent: true,
                opacity: 0.9,
                blending: AdditiveBlending,
                depthWrite: false,
            })
        )

    const coins = []
    const rings = []
    let frameId = 0
    const frame = () => {
        frameId = 0
        const now = performance.now() / 1000
        for (let i = coins.length - 1; i >= 0; i--) {
            const entry = coins[i]
            const position = coinPositionAt(entry.flight, now - entry.start)
            if (position.landed) {
                scene.remove(entry.coin)
                coins.splice(i, 1)
                const ring = makeRing()
                ring.position.set(position.x, -position.y, 5)
                scene.add(ring)
                rings.push({ ring, start: now })
                entry.onLanded()
                continue
            }
            entry.coin.visible = position.started
            entry.coin.position.set(position.x, -position.y, 0)
            entry.coin.scale.setScalar(COIN_RADIUS * position.scale)
            entry.coin.rotation.set(entry.flight.tilt, position.spin, entry.flight.tilt * 0.5)
        }
        // A small ring flashes out of the counter where each coin lands.
        for (let i = rings.length - 1; i >= 0; i--) {
            const { ring, start } = rings[i]
            const t = (now - start) / 0.35
            if (t >= 1) {
                scene.remove(ring)
                ring.material.dispose()
                rings.splice(i, 1)
                continue
            }
            ring.scale.setScalar(8 + t * 16)
            ring.material.opacity = 0.9 * (1 - t)
        }
        renderer.render(scene, camera)
        if (coins.length || rings.length) frameId = requestAnimationFrame(frame)
    }
    const start = () => {
        if (!frameId) frameId = requestAnimationFrame(frame)
    }

    return {
        launch({ from, to, count, onLanded = () => {}, random = Math.random }) {
            const now = performance.now() / 1000
            planCoinFlights(from, to, count, random).forEach(flight => {
                const coin = makeCoin()
                coin.visible = false
                scene.add(coin)
                coins.push({ flight, coin, start: now, onLanded })
            })
            start()
        },
        destroy() {
            if (frameId) cancelAnimationFrame(frameId)
            window.removeEventListener('resize', resize)
            ;[faceGeometry, rimGeometry, ringGeometry, coinMaterial, rimMaterial].forEach(item => item.dispose())
            if (scene.environment) scene.environment.dispose()
            renderer.dispose()
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
            overlay = null
        },
    }
}

/**
 * Sends `count` coins flying from `from` to `to` (viewport px). `onLanded` runs once per coin as it
 * reaches the counter.
 */
export function launchGoldCoins(options) {
    if (!overlay) overlay = createOverlay()
    overlay.launch(options)
}

export const __destroyGoldCoinsOverlay = () => {
    if (overlay) overlay.destroy()
}
