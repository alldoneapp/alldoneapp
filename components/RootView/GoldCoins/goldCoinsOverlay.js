import {
    AdditiveBlending,
    CanvasTexture,
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
    PlaneGeometry,
    PMREMGenerator,
    RingGeometry,
    Scene,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    TorusGeometry,
    WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import { coinPositionAt, planCoinFlights } from './coinFlight'
import { notePositionAt, planCashBurst } from './cashFlight'

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
const NOTE_HEIGHT = 25
const LABEL_LIFE = 1.6
const LABEL_RISE = 70

const currencySymbol = currency => {
    try {
        const part = new Intl.NumberFormat(undefined, { style: 'currency', currency })
            .formatToParts(0)
            .find(entry => entry.type === 'currency')
        return part ? part.value : currency
    } catch (error) {
        return currency
    }
}

// A banknote, drawn once per currency: mint paper, a fine guilloche, a border, and the currency's
// symbol in a medallion — generic enough to be no real note, clear enough to read as money.
const noteTextures = {}
const noteTexture = currency => {
    if (noteTextures[currency]) return noteTextures[currency]
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 122
    const c = canvas.getContext('2d')
    const paper = c.createLinearGradient(0, 0, 256, 122)
    paper.addColorStop(0, '#BFE3C9')
    paper.addColorStop(1, '#7DBE93')
    c.fillStyle = paper
    c.fillRect(0, 0, 256, 122)
    c.strokeStyle = 'rgba(40,96,62,0.28)'
    c.lineWidth = 1
    for (let k = 0; k < 9; k++) {
        c.beginPath()
        for (let x = 0; x <= 256; x += 4) {
            const y = 14 + k * 12 + Math.sin(x / 11 + k) * 4
            if (x === 0) c.moveTo(x, y)
            else c.lineTo(x, y)
        }
        c.stroke()
    }
    c.strokeStyle = '#2F6B48'
    c.lineWidth = 5
    c.strokeRect(7, 7, 242, 108)
    c.fillStyle = 'rgba(255,255,255,0.55)'
    c.beginPath()
    c.ellipse(128, 61, 40, 40, 0, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = '#4F8F66'
    c.lineWidth = 2
    c.stroke()
    const symbol = currencySymbol(currency)
    c.fillStyle = '#2F6B48'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.font = `700 ${symbol.length > 1 ? 30 : 50}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    c.fillText(symbol, 128, 64)
    c.font = '700 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    c.fillText(symbol, 30, 28)
    c.fillText(symbol, 226, 96)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    noteTextures[currency] = texture
    return texture
}

// "+€37.50" in the app's green with a white edge, so it reads on any background.
const labelTexture = text => {
    const canvas = document.createElement('canvas')
    const c = canvas.getContext('2d')
    const font = '800 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    c.font = font
    canvas.width = Math.ceil(c.measureText(text).width) + 24
    canvas.height = 64
    c.font = font
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.lineWidth = 8
    c.strokeStyle = '#FFFFFF'
    c.strokeText(text, canvas.width / 2, 33)
    c.fillStyle = '#07A873'
    c.fillText(text, canvas.width / 2, 33)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return { texture, aspect: canvas.width / canvas.height }
}

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

    const noteGeometry = new PlaneGeometry(2.1, 1)
    const coins = []
    const rings = []
    const notes = []
    const labels = []
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
        // Banknotes: thrown up, then fluttering down and fading.
        for (let i = notes.length - 1; i >= 0; i--) {
            const entry = notes[i]
            const position = notePositionAt(entry.note, now - entry.start)
            if (position.done) {
                scene.remove(entry.mesh)
                entry.mesh.material.dispose()
                notes.splice(i, 1)
                continue
            }
            entry.mesh.visible = position.started
            if (!position.started) continue
            entry.mesh.position.set(position.x, -position.y, 10)
            entry.mesh.rotation.set(position.rotX, position.rotY, position.rotZ)
            entry.mesh.scale.setScalar(NOTE_HEIGHT * position.scale)
            entry.mesh.material.opacity = position.opacity
        }
        // The amount rises above the checkbox and fades.
        for (let i = labels.length - 1; i >= 0; i--) {
            const entry = labels[i]
            const t = (now - entry.start) / LABEL_LIFE
            if (t >= 1) {
                scene.remove(entry.sprite)
                entry.sprite.material.map.dispose()
                entry.sprite.material.dispose()
                labels.splice(i, 1)
                continue
            }
            const rise = 1 - (1 - t) ** 3
            entry.sprite.position.set(entry.from.x, -(entry.from.y - 26 - rise * LABEL_RISE), 20)
            const pop = Math.min(1, t / 0.12)
            entry.sprite.scale.set(entry.height * entry.aspect * pop, entry.height * pop, 1)
            entry.sprite.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3
        }
        renderer.render(scene, camera)
        if (coins.length || rings.length || notes.length || labels.length) frameId = requestAnimationFrame(frame)
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
        launchCash({ from, amount, currency, label, random = Math.random }) {
            const now = performance.now() / 1000
            // Unlit on purpose: lit paper washes out to near-white on the app's white background.
            // Each note is two single-sided planes back to back, so its back reads the right way
            // round instead of mirrored.
            const texture = noteTexture(currency)
            planCashBurst(from, amount, random, window.innerWidth).forEach(note => {
                const material = new MeshBasicMaterial({ map: texture, transparent: true })
                const mesh = new Group()
                const front = new Mesh(noteGeometry, material)
                const back = new Mesh(noteGeometry, material)
                back.rotation.y = Math.PI
                mesh.add(front, back)
                mesh.material = material
                mesh.visible = false
                scene.add(mesh)
                notes.push({ note, mesh, start: now })
            })
            if (label) {
                const { texture, aspect } = labelTexture(label)
                const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
                sprite.renderOrder = 10
                scene.add(sprite)
                // Kept inside the window even for a task at the very edge of the screen.
                const height = 26
                const halfWidth = (height * aspect) / 2 + 8
                const x = Math.max(halfWidth, Math.min(window.innerWidth - halfWidth, from.x))
                labels.push({ sprite, from: { x, y: from.y }, start: now, aspect, height })
            }
            start()
        },
        destroy() {
            if (frameId) cancelAnimationFrame(frameId)
            window.removeEventListener('resize', resize)
            ;[faceGeometry, rimGeometry, ringGeometry, noteGeometry, coinMaterial, rimMaterial].forEach(item =>
                item.dispose()
            )
            Object.keys(noteTextures).forEach(currency => {
                noteTextures[currency].dispose()
                delete noteTextures[currency]
            })
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

/** Banknotes for real money earned: `amount` in `currency`, bursting from `from` (viewport px). */
export function launchCash(options) {
    if (!overlay) overlay = createOverlay()
    overlay.launchCash(options)
}

export const __destroyGoldCoinsOverlay = () => {
    if (overlay) overlay.destroy()
}
