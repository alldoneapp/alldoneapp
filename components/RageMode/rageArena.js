import {
    AdditiveBlending,
    BoxGeometry,
    BufferGeometry,
    CanvasTexture,
    Color,
    ConeGeometry,
    DirectionalLight,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    HemisphereLight,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PerspectiveCamera,
    Plane,
    PlaneGeometry,
    Scene,
    SRGBColorSpace,
    Vector3,
    WebGLRenderer,
} from 'three'

import { createRandom, launchVelocity, MAX_Z, rewindPose, shatterRect, stepDebris } from './rageDebris'
import {
    aimAngle,
    BOLT_SPEED,
    directionForKey,
    isBrowserShortcut,
    moveVector,
    stepCharacter,
    touchHoverTarget,
} from './rageControls'
import {
    findScrollContainer,
    findTaskRows,
    RAGE_LAYER_ATTRIBUTE,
    TASK_ROW_SELECTOR,
    resolveBackgroundColor,
    resolveHit,
    rowGlyphs,
    scrollContainerAt,
    withLayerTransparent,
} from './rageTargets'
import {
    createSnake,
    segmentPositions,
    shrinkSnake,
    SNAKE_MAX_LETTERS,
    SNAKE_MORPH_SECONDS,
    SNAKE_TILE,
    stepSnake,
} from './rageSnake'
import { greetingPose, pickGreetingStyle } from './rageGreeting'
import { blastPoints, RAGE_DEFAULT_WEAPON, RAGE_WEAPONS, volleyAngles, weaponById } from './rageWeapons'
import {
    applyDamage,
    bossKillPoints,
    createHealth,
    DAMAGE,
    heal,
    isBlinking,
    MAX_HEALTH,
    POINTS,
    pointsForHit,
    SNAKE_KILL_HEAL,
} from './rageCombat'
import {
    BOSS_HALF_HEIGHT,
    BOSS_HALF_WIDTH,
    createBoss,
    damageBoss,
    displayedCount,
    insideBoss,
    ORB_RADIUS,
    shouldSummonBoss,
    stepBoss,
    stepOrb,
} from './rageBoss'
import { buildShop } from './rageShop'

/**
 * Rage mode's arena: the page you are on becomes the level. A voxel jetpack character flies in front
 * of it and shoots it apart — letters pop out and tumble towards you, images shatter into shards,
 * buttons crack, every hit leaves a scorch mark — and pressing Escape rewinds every piece back into
 * place. Nothing about it is real: no data is written and the app's DOM is never touched (see
 * `rageTargets.js` for why that rule is load-bearing). All of it lives on one fixed WebGL canvas.
 *
 * THE CAMERA. A perspective camera placed so that the plane z = 0 maps to CSS pixels exactly: a
 * piece built at a character's `getClientRects()` box sits precisely over that character until it
 * moves, and a piece flying out of the page (z > 0) grows as it comes at you. That single choice is
 * what makes a flat app screen read as a 3D space. Screen space (y down) is used for all logic;
 * `toWorld` flips y at the last moment.
 *
 * THE INPUT. A transparent layer covers the viewport under the canvas, so no pointer event can
 * reach the app — a click meant as a shot must never tick the checkbox under the cursor — and every
 * key is swallowed in the window's capture phase, which runs before the app's own document-level
 * listeners (including the escape stack). Browser shortcuts (Cmd/Ctrl/Alt combinations) are left
 * to the browser.
 */

const Z_INDEX = 2147482000
const FOV = 30
const CHARACTER_Z = 34
const CHARACTER_SCALE = 1.35
const BUBBLE_SCREEN_SCALE = 1.35
// How far the hero turns from pure profile towards the camera (radians). Small on purpose: she
// faces where she shoots, and turns to the camera only to greet you (Space).
const HERO_YAW = 0.25
const BOLT_Z = 22
const PIECE_START_Z = 2
const MAX_PIECES = 1500
const MAX_SCORCH = 220
const MAX_EFFECTS = 160
const BOLT_HIT_RADIUS = 17
const BOLT_SAMPLES = 3
const REWIND_SECONDS = 0.95
const HOLE_FADE_SECONDS = 0.28
const MUTE_KEY = 'alldone.rageMode.muted'
const WEAPON_KEY = 'alldone.rageMode.weapon'
const BOSS_Z = 44
const BOSS_COLOR = '#D32F2F'
// Task snakes: up to five crawl at once, but they peel out one by one, a random 1.2–2.8s apart.
const MAX_SNAKES = 5
const SNAKE_FIRST_DELAY = 1.4
const SNAKE_SPAWN_GAP_MIN = 1.2
const SNAKE_SPAWN_GAP_MAX = 2.8
const SNAKE_Z = 12
const SNAKE_COLORS = ['#0C66FF', '#09A87A', '#E64A19', '#7E57C2']
// Flying towards the top or bottom edge scrolls the page under her. It starts well before the edge
// and ramps up the closer she gets, so it feels like steering rather than hitting a wall.
const EDGE_SCROLL_ZONE = 160
const EDGE_SCROLL_SPEED = 1100

// Anna Alldone, as she appears in the app's celebration pictures: a wavy blonde bob, a big smile,
// a light-blue button-up shirt and navy trousers. The jetpack and blaster are rage mode's own.
const PALETTE = {
    skin: '#F7D6BD',
    hair: '#F7DC96',
    hairShade: '#DDB872',
    eyes: '#2E2A33',
    lips: '#C9605E',
    teeth: '#FFFFFF',
    blush: '#F2A7A0',
    shirt: '#AFD0F4',
    shirtShade: '#8DB5E4',
    collar: '#C4DBF4',
    trousers: '#1D2B4F',
    shoes: '#141A2B',
    accent: '#0C66FF',
    glow: '#6FD3FF',
    metal: '#3A4152',
    metalLight: '#8C95A8',
    gun: '#2B2F3A',
    muzzle: '#FFAE47',
    bolt: '#FFE36B',
    flame: '#FF7043',
    flameCore: '#FFE6C7',
}

let activeArena = null

/** True while an arena is on screen. */
export const isRageArenaActive = () => !!activeArena

const toWorld = (mesh, x, y, z) => mesh.position.set(x, -y, z)

// Things that must APPEAR at a screen point while floating in front of the page (the hero, bolts,
// muzzle flashes) are pulled towards the camera axis so perspective puts them back on that point.
const projector = { cx: 0, cy: 0, distance: 1 }
const toWorldOnScreen = (mesh, x, y, z) => {
    const k = (projector.distance - z) / projector.distance
    mesh.position.set(projector.cx + (x - projector.cx) * k, -(projector.cy + (y - projector.cy) * k), z)
}

// three warns (and ignores) an alpha channel in `rgba()`; a hole's colour is always opaque.
const opaqueColor = css => {
    const match = /rgba?\(([^)]+)\)/.exec(css || '')
    if (!match) return new Color(css || '#ffffff')
    const [r, g, b] = match[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number)
    return new Color(`rgb(${r}, ${g}, ${b})`)
}

const readMuted = () => {
    try {
        return window.localStorage.getItem(MUTE_KEY) === '1'
    } catch (error) {
        return false
    }
}

const readStoredWeapon = () => {
    try {
        return window.localStorage.getItem(WEAPON_KEY) || null
    } catch (error) {
        return null
    }
}

const writeStoredWeapon = id => {
    try {
        window.localStorage.setItem(WEAPON_KEY, id)
    } catch (error) {
        // The weapon choice is a convenience; the arena works without it.
    }
}

const writeMuted = muted => {
    try {
        if (muted) window.localStorage.setItem(MUTE_KEY, '1')
        else window.localStorage.removeItem(MUTE_KEY)
    } catch (error) {
        // Remembering the mute button is a convenience; the arena works without it.
    }
}

/* ------------------------------------------------------------------------------------------------ */
/* Sound: synthesised, so the chunk ships no audio files.                                           */
/* ------------------------------------------------------------------------------------------------ */

const createSound = () => {
    let context = null
    let noise = null
    let lastBoom = 0
    const ensure = () => {
        if (context) return context
        const AudioContextClass = window.AudioContext || window.webkitAudioContext
        if (!AudioContextClass) return null
        context = new AudioContextClass()
        const length = Math.floor(context.sampleRate * 0.4)
        noise = context.createBuffer(1, length, context.sampleRate)
        const data = noise.getChannelData(0)
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
        return context
    }
    return {
        muted: readMuted(),
        unlock() {
            const ctx = ensure()
            if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
        },
        pew() {
            if (this.muted) return
            const ctx = ensure()
            if (!ctx) return
            const now = ctx.currentTime
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'square'
            osc.frequency.setValueAtTime(1100 + Math.random() * 200, now)
            osc.frequency.exponentialRampToValueAtTime(170, now + 0.1)
            gain.gain.setValueAtTime(0.045, now)
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11)
            osc.connect(gain).connect(ctx.destination)
            osc.start(now)
            osc.stop(now + 0.12)
        },
        boom(size = 1) {
            if (this.muted) return
            const ctx = ensure()
            if (!ctx) return
            const now = ctx.currentTime
            // Many hits land in the same frame; a wall of simultaneous noise bursts just clips.
            if (now - lastBoom < 0.035) return
            lastBoom = now
            const source = ctx.createBufferSource()
            source.buffer = noise
            const filter = ctx.createBiquadFilter()
            filter.type = 'lowpass'
            filter.frequency.setValueAtTime(1800 * size, now)
            filter.frequency.exponentialRampToValueAtTime(120, now + 0.25)
            const gain = ctx.createGain()
            gain.gain.setValueAtTime(0.16 * Math.min(1.5, size), now)
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
            source.connect(filter).connect(gain).connect(ctx.destination)
            source.start(now)
            source.stop(now + 0.32)
        },
        hurt() {
            if (this.muted) return
            const ctx = ensure()
            if (!ctx) return
            const now = ctx.currentTime
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sawtooth'
            osc.frequency.setValueAtTime(220, now)
            osc.frequency.exponentialRampToValueAtTime(60, now + 0.25)
            gain.gain.setValueAtTime(0.12, now)
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28)
            osc.connect(gain).connect(ctx.destination)
            osc.start(now)
            osc.stop(now + 0.3)
        },
        close() {
            if (context && context.close) context.close().catch(() => {})
            context = null
        },
    }
}

/* ------------------------------------------------------------------------------------------------ */
/* Textures                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

const glyphTextureCache = new Map()

/**
 * A character drawn exactly as the page draws it — same font, weight, size and colour — onto its
 * own small canvas, supersampled so it stays sharp while flying at the camera. Cached, because a
 * page is mostly the same few dozen letters.
 */
const glyphTexture = (char, style, width, height) => {
    const key = `${char}|${style.font}|${style.color}|${Math.round(width)}x${Math.round(height)}`
    const cached = glyphTextureCache.get(key)
    if (cached) return cached
    const scale = Math.min(4, (window.devicePixelRatio || 1) * 2)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(2, Math.ceil(width * scale))
    canvas.height = Math.max(2, Math.ceil(height * scale))
    const context = canvas.getContext('2d')
    context.scale(scale, scale)
    context.font = style.font
    context.fillStyle = style.color
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'
    const metrics = context.measureText(char)
    const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || height * 0.8
    const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent || height * 0.2
    // The range rect of a character is its font's content area, so the baseline sits `ascent` below
    // the top of that area; centre it if the rect is taller than the font's own box.
    const baseline = (height - (ascent + descent)) / 2 + ascent
    context.fillText(char, width / 2, baseline)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    glyphTextureCache.set(key, texture)
    return texture
}

// Reading one pixel back is the only reliable test for "may this image be uploaded to WebGL?": a
// cross-origin image without CORS taints a canvas, and a tainted canvas throws on upload — inside
// `renderer.render`, which would stop the whole arena. The probe is thrown away either way.
const canUseImage = image => {
    try {
        const probe = document.createElement('canvas')
        probe.width = 1
        probe.height = 1
        const context = probe.getContext('2d')
        context.drawImage(image, 0, 0, 1, 1)
        context.getImageData(0, 0, 1, 1)
        return true
    } catch (error) {
        return false
    }
}

/**
 * The picture a shattering image breaks into. Starts as a neutral grey and is replaced by the real
 * image as soon as one can be used: the element's own `<img>` if it is readable, otherwise a
 * CORS-mode reload of the same URL. When neither works the shards stay grey, which still reads as
 * "that thing broke".
 */
const imageTexture = (target, width, height) => {
    const canvas = document.createElement('canvas')
    const scale = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.max(2, Math.round(width * scale))
    canvas.height = Math.max(2, Math.round(height * scale))
    const context = canvas.getContext('2d')
    context.fillStyle = '#C9CED8'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    const paint = image => {
        if (!canUseImage(image)) return false
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        texture.needsUpdate = true
        return true
    }
    const element = target.element
    const ownImageReady = element.tagName === 'IMG' && element.complete && element.naturalWidth > 0
    if (!(ownImageReady && paint(element))) {
        const image = new Image()
        image.crossOrigin = 'anonymous'
        image.onload = () => paint(image)
        image.src = target.src
    }
    return texture
}

/** A white speech bubble with a tail, for Anna's greeting. Returns the texture and its CSS size. */
const bubbleTexture = text => {
    const scale = 3
    const font = '600 17px Roboto, system-ui, sans-serif'
    const measure = document.createElement('canvas').getContext('2d')
    measure.font = font
    const width = Math.ceil(measure.measureText(text).width) + 32
    const height = 46
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = (height + 12) * scale
    const context = canvas.getContext('2d')
    context.scale(scale, scale)
    context.fillStyle = '#FFFFFF'
    context.strokeStyle = 'rgba(9,21,64,0.18)'
    context.lineWidth = 1.5
    context.beginPath()
    const r = 20
    context.moveTo(r, 1)
    context.lineTo(width - r, 1)
    context.arcTo(width - 1, 1, width - 1, r, r)
    context.lineTo(width - 1, height - r)
    context.arcTo(width - 1, height - 1, width - r, height - 1, r)
    context.lineTo(34, height - 1)
    context.lineTo(18, height + 11)
    context.lineTo(22, height - 1)
    context.lineTo(r, height - 1)
    context.arcTo(1, height - 1, 1, height - r, r)
    context.lineTo(1, r)
    context.arcTo(1, 1, r, 1, r)
    context.closePath()
    context.fill()
    context.stroke()
    context.fillStyle = '#04142F'
    context.font = font
    context.textBaseline = 'middle'
    context.fillText(text, 16, height / 2 + 1)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return { texture, width, height: height + 12 }
}

const tileTextureCache = new Map()

/**
 * The face of one snake tile: a rounded square in the snake's colour with the letter it came from
 * in white — or, for the head, two eyes looking the way it crawls (+x; the mesh is rotated).
 */
const tileTexture = (char, color, head) => {
    const key = `${head ? '@head' : char}|${color}`
    if (tileTextureCache.has(key)) return tileTextureCache.get(key)
    const size = 96
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    const r = 22
    context.fillStyle = color
    context.beginPath()
    context.moveTo(r, 2)
    context.arcTo(size - 2, 2, size - 2, size - 2, r)
    context.arcTo(size - 2, size - 2, 2, size - 2, r)
    context.arcTo(2, size - 2, 2, 2, r)
    context.arcTo(2, 2, size - 2, 2, r)
    context.closePath()
    context.fill()
    context.fillStyle = 'rgba(255,255,255,0.18)'
    context.fillRect(10, 8, size - 20, 14)
    if (head) {
        ;[30, 66].forEach(y => {
            context.fillStyle = '#FFFFFF'
            context.beginPath()
            context.arc(62, y, 15, 0, Math.PI * 2)
            context.fill()
            context.fillStyle = '#091540'
            context.beginPath()
            context.arc(69, y, 7, 0, Math.PI * 2)
            context.fill()
        })
    } else {
        context.fillStyle = '#FFFFFF'
        context.font = '700 58px Roboto, system-ui, sans-serif'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(char, size / 2, size / 2 + 4)
    }
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    tileTextureCache.set(key, texture)
    return texture
}

const radialTexture = (stops, size = 128) => {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    stops.forEach(([offset, color]) => gradient.addColorStop(offset, color))
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return texture
}

// A burn mark: charred centre, ragged soot, transparent edge.
const scorchTexture = () => {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    const random = createRandom(7)
    for (let i = 0; i < 26; i++) {
        const angle = random() * Math.PI * 2
        const distance = random() * size * 0.22
        const x = size / 2 + Math.cos(angle) * distance
        const y = size / 2 + Math.sin(angle) * distance
        const radius = size * (0.12 + random() * 0.2)
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
        gradient.addColorStop(0, 'rgba(24,14,8,0.34)')
        gradient.addColorStop(0.6, 'rgba(40,24,12,0.14)')
        gradient.addColorStop(1, 'rgba(40,24,12,0)')
        context.fillStyle = gradient
        context.fillRect(0, 0, size, size)
    }
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return texture
}

/* ------------------------------------------------------------------------------------------------ */
/* Geometry                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

/**
 * A shard with thickness: the triangle as a front and a back face (textured) plus three side walls
 * (a darker edge), built around its own centroid. `uvSize` maps the rectangle-local vertices onto
 * the picture the shard was cut from.
 */
const shardGeometry = (vertices, centroid, thickness, uvSize) => {
    const positions = []
    const uvs = []
    const half = thickness / 2
    const local = vertices.map(v => ({ x: v.x - centroid.x, y: -(v.y - centroid.y) }))
    const uvOf = v => [v.x / uvSize.width, 1 - v.y / uvSize.height]
    const push = (point, z, uv) => {
        positions.push(point.x, point.y, z)
        uvs.push(uv[0], uv[1])
    }
    // Wind the front face towards +z whichever way `shatterRect` ordered the corners.
    const [a, b, c] = local
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    const order = cross >= 0 ? [0, 1, 2] : [0, 2, 1]
    order.forEach(i => push(local[i], half, uvOf(vertices[i])))
    ;[...order].reverse().forEach(i => push(local[i], -half, uvOf(vertices[i])))
    const faceCount = positions.length / 3
    for (let k = 0; k < 3; k++) {
        const p = local[order[k]]
        const q = local[order[(k + 1) % 3]]
        const uvP = uvOf(vertices[order[k]])
        const uvQ = uvOf(vertices[order[(k + 1) % 3]])
        push(p, half, uvP)
        push(p, -half, uvP)
        push(q, half, uvQ)
        push(q, half, uvQ)
        push(p, -half, uvP)
        push(q, -half, uvQ)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
    geometry.addGroup(0, faceCount, 0)
    geometry.addGroup(faceCount, positions.length / 3 - faceCount, 1)
    geometry.computeVertexNormals()
    return geometry
}

/**
 * The hero: Anna Alldone as a chunky voxel figure with a jetpack and a blaster. Built from boxes at
 * runtime so there is no model to load, and so it stays crisp at any size. Local +x is "forward"
 * (her face), local +z is the side that faces the camera; the arm pivot aims the blaster and the
 * yaw group turns the whole figure towards its target.
 */
const buildCharacter = () => {
    const materials = {}
    // Her hair and shirt are the two things that make her recognisable, and they sit mostly on side
    // faces the sun barely reaches; a little self-illumination keeps them blonde and light blue
    // from every angle instead of khaki and grey.
    const selfLit = new Set([PALETTE.hair, PALETTE.hairShade, PALETTE.shirt, PALETTE.shirtShade])
    const material = (color, extra = {}) => {
        const key = `${color}|${JSON.stringify(extra)}`
        if (!materials[key]) {
            materials[key] = new MeshStandardMaterial({
                color,
                roughness: 0.6,
                metalness: 0.05,
                flatShading: true,
                ...(selfLit.has(color) ? { emissive: color, emissiveIntensity: 0.22 } : {}),
                ...extra,
            })
        }
        return materials[key]
    }
    const box = (w, h, d, color, x, y, z, extra) => {
        const mesh = new Mesh(new BoxGeometry(w, h, d), material(color, extra))
        mesh.position.set(x, y, z)
        return mesh
    }

    const lean = new Group()
    const yaw = new Group()
    lean.add(yaw)

    // Navy trousers and shoes.
    yaw.add(box(8, 15, 8.5, PALETTE.trousers, -1, -19, 4.5))
    yaw.add(box(8, 15, 8.5, PALETTE.trousers, 1, -19, -4.5))
    yaw.add(box(10, 4, 9, PALETTE.shoes, 1, -27.5, 4.5))
    yaw.add(box(10, 4, 9, PALETTE.shoes, 3, -27.5, -4.5))
    yaw.add(box(19.5, 3, 17.5, PALETTE.trousers, 0, -10, 0))

    // The light-blue shirt: collar, V-neck, button placket.
    yaw.add(box(19, 20, 17, PALETTE.shirt, 0, 0, 0))
    yaw.add(box(3, 4, 5, PALETTE.collar, 9.2, 8.5, 3.4))
    yaw.add(box(3, 4, 5, PALETTE.collar, 9.2, 8.5, -3.4))
    yaw.add(box(1, 4, 2.4, PALETTE.skin, 9.8, 8, 0))
    yaw.add(box(1, 13, 1.6, PALETTE.shirtShade, 9.8, -1.5, 0))
    ;[3.5, -0.5, -4.5].forEach(y => yaw.add(box(1.4, 1.2, 1.2, PALETTE.teeth, 10.2, y, 0)))
    yaw.add(box(6, 3, 6, PALETTE.skin, 1, 11.5, 0))

    // Head and face (eyes, brows, a wide smile, a little blush) on a pivot at the neck, so the head
    // can follow the aim and tilt while she greets.
    const head = new Group()
    head.position.set(1, 12, 0)
    yaw.add(head)
    head.add(box(17, 18, 17, PALETTE.skin, 0, 9, 0))
    head.add(box(1.6, 2, 2, PALETTE.skin, 9.2, 7.5, 0))
    ;[3.8, -3.8].forEach(z => {
        head.add(box(1, 3, 2.4, PALETTE.eyes, 8.9, 11, z))
        head.add(box(1, 1, 3.6, PALETTE.hairShade, 8.9, 14, z))
        head.add(box(1, 2, 2.6, PALETTE.blush, 8.8, 6.5, z * 1.6))
    })
    head.add(box(1, 3.4, 7.6, PALETTE.lips, 8.9, 3.4, 0))
    head.add(box(1.2, 1.6, 6, PALETTE.teeth, 9, 3.9, 0))

    // The wavy blonde bob: crown, back, sides down to the chin, flicked-out ends, a side-swept fringe.
    head.add(box(19, 5, 19.5, PALETTE.hair, -1, 19.5, 0))
    head.add(box(7, 19, 19.5, PALETTE.hair, -8, 9.5, 0))
    head.add(box(13, 16, 3, PALETTE.hair, -1.5, 10.5, 9.8))
    head.add(box(13, 16, 3, PALETTE.hair, -1.5, 10.5, -9.8))
    head.add(box(8, 3.5, 4, PALETTE.hairShade, -4, 1.5, 11.5))
    head.add(box(8, 3.5, 4, PALETTE.hairShade, -4, 1.5, -11.5))
    head.add(box(7.5, 3, 20, PALETTE.hairShade, -8.5, 1, 0))
    head.add(box(4, 5, 11, PALETTE.hair, 8.5, 16.5, -3))
    head.add(box(4, 3, 6, PALETTE.hair, 8.5, 17.5, 5.5))
    head.add(box(3, 2, 8, PALETTE.hairShade, 8.8, 14.8, -4.5))

    // Jetpack on the back, with two nozzles and their flames.
    yaw.add(box(10, 22, 20, PALETTE.metal, -15, 2, 0))
    yaw.add(box(4, 22, 21, PALETTE.accent, -20, 2, 0))
    const flames = []
    ;[-6, 6].forEach(z => {
        yaw.add(box(6, 6, 6, PALETTE.gun, -15, -11, z))
        const outer = new Mesh(
            new ConeGeometry(4.5, 20, 7),
            new MeshBasicMaterial({
                color: PALETTE.flame,
                transparent: true,
                opacity: 0.9,
                blending: AdditiveBlending,
                depthWrite: false,
            })
        )
        outer.rotation.x = Math.PI
        outer.position.set(-15, -24, z)
        const inner = new Mesh(
            new ConeGeometry(2.4, 11, 7),
            new MeshBasicMaterial({
                color: PALETTE.flameCore,
                transparent: true,
                blending: AdditiveBlending,
                depthWrite: false,
            })
        )
        inner.rotation.x = Math.PI
        inner.position.set(-15, -19, z)
        yaw.add(outer, inner)
        flames.push(outer, inner)
    })

    // The free arm hangs from a shoulder pivot (it waves and cheers), then the aiming arm (shirt
    // sleeve, cuff, hand) holding the blaster.
    const rearArm = new Group()
    rearArm.position.set(-2, 6, -11)
    rearArm.add(box(6, 14, 6, PALETTE.shirtShade, 0, -7, 0))
    rearArm.add(box(6, 5, 6, PALETTE.skin, 0, -16, 0))
    yaw.add(rearArm)
    const arm = new Group()
    arm.position.set(2, 5, 11.5)
    arm.add(box(13, 6, 6, PALETTE.shirt, 6.5, 0, 0))
    arm.add(box(2, 6.6, 6.6, PALETTE.collar, 13, 0, 0))
    arm.add(box(5, 5.5, 5.5, PALETTE.skin, 16, 0, 0))
    arm.add(box(20, 8, 7, PALETTE.gun, 22, 2, 0))
    arm.add(box(6, 8, 5, PALETTE.gun, 18, -5, 0))
    arm.add(box(12, 4, 4, PALETTE.metalLight, 35, 3, 0, { metalness: 0.6, roughness: 0.3 }))
    arm.add(box(3, 5, 5, PALETTE.muzzle, 41, 3, 0, { emissive: PALETTE.muzzle, emissiveIntensity: 1 }))
    arm.add(box(8, 3, 8, PALETTE.glow, 22, 7, 0, { emissive: PALETTE.glow, emissiveIntensity: 0.7 }))
    yaw.add(arm)

    lean.scale.setScalar(CHARACTER_SCALE)
    return { root: lean, yaw, head, arm, rearArm, flames, materials: Object.values(materials) }
}

/* ------------------------------------------------------------------------------------------------ */
/* The boss                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

/** The boss's chest: today's open-task count, big, with a caption. Redrawn as the number counts down. */
const drawBossFace = (canvas, count, caption) => {
    const context = canvas.getContext('2d')
    const { width, height } = canvas
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#B71C1C'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#FFFFFF'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = '900 150px Roboto, system-ui, sans-serif'
    context.fillText(String(count), width / 2, height * 0.46)
    context.font = '700 30px Roboto, system-ui, sans-serif'
    context.fillStyle = 'rgba(255,255,255,0.85)'
    context.fillText(caption, width / 2, height * 0.85)
}

/**
 * The boss: a big red voxel block with the open-task count on its chest, eyes that follow Anna, angry
 * brows, horns and a toothy mouth. Local units are screen pixels at its depth.
 */
const buildBoss = caption => {
    const materials = []
    const material = (color, extra = {}) => {
        const m = new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, flatShading: true, ...extra })
        materials.push(m)
        return m
    }
    const group = new Group()
    const bodyMaterial = material(BOSS_COLOR, { emissive: '#FFFFFF', emissiveIntensity: 0 })
    const body = new Mesh(new BoxGeometry(BOSS_HALF_WIDTH * 2, BOSS_HALF_HEIGHT * 2, 70), bodyMaterial)
    group.add(body)

    const faceCanvas = document.createElement('canvas')
    faceCanvas.width = 256
    faceCanvas.height = 200
    const faceTexture = new CanvasTexture(faceCanvas)
    faceTexture.colorSpace = SRGBColorSpace
    const face = new Mesh(
        new PlaneGeometry(BOSS_HALF_WIDTH * 1.3, BOSS_HALF_HEIGHT * 1.0),
        new MeshBasicMaterial({ map: faceTexture })
    )
    face.position.set(0, -12, 35.5)
    group.add(face)

    const pupils = []
    ;[-34, 34].forEach(x => {
        const eye = new Mesh(new BoxGeometry(30, 22, 6), material('#FFFFFF'))
        eye.position.set(x, 44, 36)
        const pupil = new Mesh(new BoxGeometry(11, 11, 4), material('#091540'))
        pupil.position.set(x, 44, 40)
        pupil.userData.home = { x, y: 44 }
        const brow = new Mesh(new BoxGeometry(36, 7, 8), material('#4A0E0E'))
        brow.position.set(x, 62, 37)
        brow.rotation.z = x < 0 ? -0.35 : 0.35
        group.add(eye, pupil, brow)
        pupils.push(pupil)
    })
    ;[-50, 50].forEach(x => {
        const horn = new Mesh(new ConeGeometry(10, 36, 6), material('#F5E6C8'))
        horn.position.set(x, BOSS_HALF_HEIGHT + 14, 0)
        horn.rotation.z = x < 0 ? 0.35 : -0.35
        group.add(horn)
        const arm = new Mesh(new BoxGeometry(22, 60, 26), material('#B71C1C'))
        arm.position.set(x < 0 ? -BOSS_HALF_WIDTH - 12 : BOSS_HALF_WIDTH + 12, -8, 0)
        group.add(arm)
    })
    const mouth = new Mesh(new BoxGeometry(80, 12, 4), material('#2B0A0A'))
    mouth.position.set(0, -BOSS_HALF_HEIGHT + 12, 36)
    group.add(mouth)
    for (let i = 0; i < 5; i++) {
        const tooth = new Mesh(new BoxGeometry(9, 8, 3), material('#FFFFFF'))
        tooth.position.set(-32 + i * 16, -BOSS_HALF_HEIGHT + 16, 38)
        group.add(tooth)
    }
    let shown = null
    return {
        group,
        bodyMaterial,
        faceTexture,
        setCount(count) {
            if (count === shown) return
            shown = count
            drawBossFace(faceCanvas, count, caption)
            faceTexture.needsUpdate = true
        },
        lookAt(dx, dy) {
            const length = Math.hypot(dx, dy) || 1
            pupils.forEach(pupil => {
                pupil.position.x = pupil.userData.home.x + (dx / length) * 7
                pupil.position.y = pupil.userData.home.y - (dy / length) * 5
            })
        },
        dispose() {
            group.traverse(node => node.geometry && node.geometry.dispose())
            materials.forEach(m => m.dispose())
            face.material.dispose()
            faceTexture.dispose()
        },
    }
}

/* ------------------------------------------------------------------------------------------------ */
/* HUD                                                                                              */
/* ------------------------------------------------------------------------------------------------ */

const hudButton = (label, text) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', label)
    button.title = label
    button.textContent = text
    Object.assign(button.style, {
        pointerEvents: 'auto',
        border: 'none',
        background: 'rgba(255,255,255,0.14)',
        color: '#fff',
        width: '30px',
        height: '30px',
        borderRadius: '15px',
        font: '600 14px Roboto, system-ui, sans-serif',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0',
    })
    return button
}

const NARROW_HUD_WIDTH = 420

/**
 * The width the user can actually SEE. On a phone a page that overflows sideways widens the layout
 * viewport (`innerWidth`) past the screen, and `position: fixed` + `left: 50%` would then centre the
 * HUD on a point off to the right, pushing ✕ off screen.
 */
const visibleWidth = () =>
    Math.min(
        window.innerWidth,
        document.documentElement.clientWidth || Infinity,
        (window.visualViewport && window.visualViewport.width) || Infinity
    )
// Likewise the visible height: bottom-anchored bars measured from a taller layout viewport end up
// below the screen.
const visibleHeight = () =>
    Math.min(window.innerHeight, (window.visualViewport && window.visualViewport.height) || Infinity)

const pillElement = (tag, style = {}) => {
    const element = document.createElement(tag)
    Object.assign(element.style, style)
    return element
}

const buildHud = (strings, touch, muted, narrow) => {
    const hud = pillElement('div', {
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: String(Z_INDEX + 2),
        display: 'flex',
        alignItems: 'center',
        gap: narrow ? '6px' : '10px',
        padding: narrow ? '4px 4px 4px 10px' : '5px 5px 5px 14px',
        borderRadius: '20px',
        background: '#091540',
        boxShadow: '0 6px 24px rgba(9,21,64,0.35)',
        color: '#fff',
        font: '600 13px Roboto, system-ui, sans-serif',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        pointerEvents: 'none',
    })
    hud.setAttribute(RAGE_LAYER_ATTRIBUTE, 'hud')
    const title = pillElement('span', { letterSpacing: '0.04em', textTransform: 'uppercase' })
    // On a phone the pill has to fit between the screen edges with the counters and four buttons.
    title.textContent = narrow ? '🔥' : `🔥 ${strings.title}`
    const scoreValue = pillElement('span', { fontVariantNumeric: 'tabular-nums', color: '#FFCE8F' })
    scoreValue.title = strings.score
    const bestValue = pillElement('span', { fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.7)' })
    bestValue.title = strings.best
    const healthTrack = pillElement('span', {
        display: 'inline-block',
        width: narrow ? '44px' : '72px',
        height: '8px',
        borderRadius: '4px',
        background: 'rgba(255,255,255,0.18)',
        overflow: 'hidden',
    })
    healthTrack.title = strings.health
    const healthFill = pillElement('span', {
        display: 'block',
        height: '100%',
        width: '100%',
        background: '#09D693',
        transition: 'width 200ms ease, background 200ms ease',
    })
    healthTrack.appendChild(healthFill)
    const hint = pillElement('span', { color: 'rgba(255,255,255,0.6)', fontWeight: '400' })
    hint.textContent = strings.exitHint
    if (touch || narrow) hint.style.display = 'none'
    const shop = hudButton(strings.shop, '🛒')
    const greet = hudButton(strings.greet, '👋')
    const mute = hudButton(muted ? strings.unmute : strings.mute, muted ? '🔇' : '🔊')
    const exit = hudButton(strings.exit, '✕')
    hud.append(title, scoreValue, bestValue, healthTrack, hint, shop, greet, mute, exit)

    const help = pillElement('div', {
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 70px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: String(Z_INDEX + 2),
        padding: '8px 16px',
        borderRadius: '16px',
        background: 'rgba(9,21,64,0.8)',
        color: '#fff',
        font: '400 13px Roboto, system-ui, sans-serif',
        // On a phone the help wraps instead of running off both edges.
        whiteSpace: narrow ? 'normal' : 'nowrap',
        maxWidth: 'calc(100vw - 32px)',
        boxSizing: 'border-box',
        textAlign: 'center',
        pointerEvents: 'none',
        transition: 'opacity 600ms ease',
    })
    help.setAttribute(RAGE_LAYER_ATTRIBUTE, 'help')
    help.textContent = touch ? strings.touchHelp : strings.desktopHelp

    // The owned weapons, bottom centre: tap one, or press its number.
    const weaponBar = pillElement('div', {
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: String(Z_INDEX + 2),
        display: 'flex',
        gap: '6px',
        padding: '5px',
        borderRadius: '18px',
        background: '#091540',
        boxShadow: '0 6px 24px rgba(9,21,64,0.35)',
        userSelect: 'none',
    })
    weaponBar.setAttribute(RAGE_LAYER_ATTRIBUTE, 'weapons')

    // The boss's health, under the pill, only while there is a boss.
    const bossBar = pillElement('div', {
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 56px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: String(Z_INDEX + 2),
        width: 'min(420px, calc(100vw - 32px))',
        display: 'none',
        flexDirection: 'column',
        gap: '4px',
        color: '#fff',
        font: '700 12px Roboto, system-ui, sans-serif',
        textAlign: 'center',
        textShadow: '0 1px 2px rgba(9,21,64,0.8)',
        pointerEvents: 'none',
    })
    bossBar.setAttribute(RAGE_LAYER_ATTRIBUTE, 'boss')
    const bossLabel = pillElement('div')
    const bossTrack = pillElement('div', {
        height: '10px',
        borderRadius: '5px',
        background: 'rgba(9,21,64,0.55)',
        overflow: 'hidden',
    })
    const bossFill = pillElement('div', {
        height: '100%',
        width: '100%',
        background: 'linear-gradient(90deg, #E00000, #FF7043)',
        transition: 'width 150ms ease',
    })
    bossTrack.appendChild(bossFill)
    bossBar.append(bossLabel, bossTrack)

    // Short announcements ("Boss!", "New highscore!") in the middle of the screen.
    const toast = pillElement('div', {
        position: 'fixed',
        top: '38%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: String(Z_INDEX + 3),
        padding: '12px 22px',
        borderRadius: '18px',
        background: '#091540',
        color: '#FFFFFF',
        font: '800 20px Roboto, system-ui, sans-serif',
        boxShadow: '0 10px 40px rgba(9,21,64,0.45)',
        opacity: '0',
        transition: 'opacity 250ms ease',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
    })
    toast.setAttribute(RAGE_LAYER_ATTRIBUTE, 'toast')

    return {
        hud,
        scoreValue,
        bestValue,
        healthFill,
        shop,
        greet,
        mute,
        exit,
        help,
        weaponBar,
        bossBar,
        bossLabel,
        bossFill,
        toast,
    }
}

/** The game-over card: score, best, and "play again" / "exit". */
const buildGameOver = (strings, onAgain, onExit) => {
    const backdrop = pillElement('div', {
        position: 'fixed',
        inset: '0',
        zIndex: String(Z_INDEX + 4),
        display: 'none',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(9,21,64,0.3)',
    })
    backdrop.setAttribute(RAGE_LAYER_ATTRIBUTE, 'gameover')
    backdrop.addEventListener('pointerdown', event => event.stopPropagation())
    const card = pillElement('div', {
        background: '#091540',
        color: '#FFFFFF',
        borderRadius: '22px',
        padding: '22px 26px',
        minWidth: '260px',
        maxWidth: 'calc(100vw - 32px)',
        boxSizing: 'border-box',
        textAlign: 'center',
        font: '400 14px Roboto, system-ui, sans-serif',
        boxShadow: '0 12px 48px rgba(9,21,64,0.5)',
    })
    const title = pillElement('div', { font: '800 22px Roboto, system-ui, sans-serif', marginBottom: '10px' })
    title.textContent = `💥 ${strings.gameOver}`
    const scoreLine = pillElement('div', { font: '700 30px Roboto, system-ui, sans-serif', color: '#FFCE8F' })
    const bestLine = pillElement('div', { color: 'rgba(255,255,255,0.7)', marginTop: '4px' })
    const newBest = pillElement('div', { color: '#9CF0C8', fontWeight: '700', marginTop: '6px', display: 'none' })
    newBest.textContent = `🏆 ${strings.newHighscore}`
    const actions = pillElement('div', { display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' })
    const again = hudButton(strings.playAgain, strings.playAgain)
    const leave = hudButton(strings.exit, strings.exit)
    ;[again, leave].forEach(button =>
        Object.assign(button.style, { width: 'auto', height: 'auto', padding: '9px 16px', borderRadius: '16px' })
    )
    again.style.background = '#FFAE47'
    again.style.color = '#091540'
    again.addEventListener('click', event => {
        event.stopPropagation()
        onAgain()
    })
    leave.addEventListener('click', event => {
        event.stopPropagation()
        onExit()
    })
    actions.append(again, leave)
    card.append(title, scoreLine, bestLine, newBest, actions)
    backdrop.appendChild(card)
    return {
        element: backdrop,
        show({ score, best, isNew }) {
            scoreLine.textContent = score.toLocaleString()
            bestLine.textContent = `${strings.best}: ${best.toLocaleString()}`
            newBest.style.display = isNew ? 'block' : 'none'
            backdrop.style.display = 'flex'
        },
        update({ best, isNew }) {
            bestLine.textContent = `${strings.best}: ${best.toLocaleString()}`
            newBest.style.display = isNew ? 'block' : 'none'
        },
        hide() {
            backdrop.style.display = 'none'
        },
    }
}

/* ------------------------------------------------------------------------------------------------ */
/* The arena                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Open the arena over the current page. Returns a handle whose `stop()` rewinds and closes it.
 * Only one arena exists at a time; a second call returns the running one.
 *
 * @param {object} options
 * @param {object} options.strings  translated HUD strings (title, exitHint, destroyed, desktopHelp,
 *                                  touchHelp, mute, unmute, exit)
 * @param {{x:number,y:number}} [options.from] where the character flies in from (the button)
 * @param {() => void} [options.onExit] called once the arena is fully gone
 * @param {object} [options.services] the outside world, all optional (a harness passes fakes):
 *   loadProfile() → Promise<{owned, highscore}>, purchase(id) → Promise<{ok, owned, newBalance, reason}>,
 *   submitScore(score) → Promise<{ok, highscore, isNew}>, getGold() → number, getOpenTasksToday() → number
 * @param {object} [options.tuning] for browser-tests only: `bossHeadStart` (seconds added to the boss
 *   timer), `startHealth` and `invincible`, so a test can reach the boss or a game over in seconds —
 *   or run its other checks without dying half-way.
 */
export function startRageArena({ strings, from, onExit, services = {}, tuning = {} }) {
    if (activeArena) return activeArena

    const random = createRandom(Date.now() & 0xffff)
    const touchDevice = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    const viewport = { width: window.innerWidth, height: window.innerHeight }

    // A focused editor or input would keep its caret blinking under the arena; nothing may type now.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur()

    /* Renderer, camera, lights. */
    const renderer = new WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touchDevice ? 1.5 : 2))
    renderer.outputColorSpace = SRGBColorSpace
    renderer.setClearColor(0x000000, 0)
    // Damage done inside a scrolling list is clipped to that list's box (see the scroll anchors).
    renderer.localClippingEnabled = true
    const canvas = renderer.domElement
    canvas.setAttribute(RAGE_LAYER_ATTRIBUTE, 'canvas')
    canvas.setAttribute('aria-hidden', 'true')
    Object.assign(canvas.style, {
        position: 'fixed',
        inset: '0',
        width: '100vw',
        height: '100vh',
        zIndex: String(Z_INDEX + 1),
        pointerEvents: 'none',
    })

    const inputLayer = document.createElement('div')
    inputLayer.setAttribute(RAGE_LAYER_ATTRIBUTE, 'input')
    Object.assign(inputLayer.style, {
        position: 'fixed',
        inset: '0',
        zIndex: String(Z_INDEX),
        cursor: 'crosshair',
        touchAction: 'none',
        userSelect: 'none',
        webkitUserSelect: 'none',
        background: 'transparent',
        boxShadow: 'inset 0 0 140px rgba(224,0,0,0.32)',
        transition: 'box-shadow 900ms ease',
    })

    const scene = new Scene()
    const camera = new PerspectiveCamera(FOV, 1, 1, 4000)
    scene.add(new HemisphereLight('#ffffff', '#5a6478', 1.6))
    const sun = new DirectionalLight('#ffffff', 2.2)
    sun.position.set(-0.6, 1, 1.2)
    scene.add(sun)

    const resizeCamera = () => {
        viewport.width = window.innerWidth
        viewport.height = window.innerHeight
        renderer.setSize(viewport.width, viewport.height, false)
        const distance = viewport.height / 2 / Math.tan((FOV * Math.PI) / 360)
        camera.aspect = viewport.width / viewport.height
        camera.near = 1
        camera.far = distance + 2000
        camera.position.set(viewport.width / 2, -viewport.height / 2, distance)
        camera.lookAt(viewport.width / 2, -viewport.height / 2, 0)
        camera.updateProjectionMatrix()
        camera.userData.base = camera.position.clone()
        projector.cx = viewport.width / 2
        projector.cy = viewport.height / 2
        projector.distance = distance
    }
    resizeCamera()

    /* Shared resources. */
    const unitPlane = new PlaneGeometry(1, 1)
    const glowTexture = radialTexture([
        [0, 'rgba(255,255,255,1)'],
        [0.25, 'rgba(255,222,120,0.9)'],
        [0.6, 'rgba(255,112,67,0.35)'],
        [1, 'rgba(255,112,67,0)'],
    ])
    const scorchMaterial = new MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false })
    const sparkMaterial = new MeshBasicMaterial({
        color: PALETTE.bolt,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
    })
    const boltMaterial = new MeshBasicMaterial({ color: PALETTE.bolt })
    const boltGeometry = new BoxGeometry(26, 4, 4)
    const sparkGeometry = new BoxGeometry(3, 3, 3)
    // Everything that fades out at the end of the rewind: every hole and burn-mark material.
    const fadingMaterials = new Set([scorchMaterial])
    const holeMaterials = new Map()
    const holeMaterial = (css, anchor) => {
        const key = `${css}|${anchor ? anchor.id : 0}`
        if (!holeMaterials.has(key)) {
            const material = new MeshBasicMaterial({ color: opaqueColor(css), transparent: true, depthWrite: false })
            if (anchor && anchor.planes) material.clippingPlanes = anchor.planes
            holeMaterials.set(key, material)
            fadingMaterials.add(material)
        }
        return holeMaterials.get(key)
    }
    const edgeMaterials = new Map()
    const edgeMaterial = css => {
        if (!edgeMaterials.has(css)) {
            const color = opaqueColor(css).multiplyScalar(0.62)
            edgeMaterials.set(css, new MeshBasicMaterial({ color }))
        }
        return edgeMaterials.get(css)
    }
    const disposables = new Set([
        unitPlane,
        glowTexture,
        scorchMaterial,
        sparkMaterial,
        boltMaterial,
        boltGeometry,
        sparkGeometry,
    ])

    // A Group's renderOrder is the draw order of everything inside it, and it outranks each child's
    // own: burn marks must land ON the holes they surround, never be painted over by them.
    const holes = new Group()
    holes.renderOrder = 1
    const scorches = new Group()
    scorches.renderOrder = 2
    scene.add(holes, scorches)

    const character = buildCharacter()
    scene.add(character.root)

    /*
     * Scroll anchors. Damage belongs to the content it was done to: a hole punched into a task list
     * must move with that list when it scrolls, and must never be painted over the fixed top bar
     * the list scrolls under. So every hole and burn mark is filed under the scroll container of the
     * element it hit; the container's groups are shifted by how far it has scrolled since, and its
     * materials are clipped to its box. Damage outside any scroller (the top bar) is anchored to the
     * screen, as before.
     */
    const anchors = new Map()
    const anchorFor = container => {
        if (!container) return null
        if (anchors.has(container)) return anchors.get(container)
        const isPage = container === document.scrollingElement
        const rect = isPage
            ? { left: 0, top: 0, right: viewport.width, bottom: viewport.height }
            : container.getBoundingClientRect()
        const holeGroup = new Group()
        const scorchGroup = new Group()
        holes.add(holeGroup)
        scorches.add(scorchGroup)
        const anchor = {
            id: anchors.size + 1,
            container,
            top: container.scrollTop,
            left: container.scrollLeft,
            holeGroup,
            scorchGroup,
            // World space: x right, y up (screen y negated). Three keeps what is on the positive side.
            planes: isPage
                ? null
                : [
                      new Plane(new Vector3(1, 0, 0), -rect.left),
                      new Plane(new Vector3(-1, 0, 0), rect.right),
                      new Plane(new Vector3(0, -1, 0), -rect.top),
                      new Plane(new Vector3(0, 1, 0), rect.bottom),
                  ],
            scorchMaterial: null,
        }
        if (anchor.planes) {
            anchor.scorchMaterial = scorchMaterial.clone()
            anchor.scorchMaterial.clippingPlanes = anchor.planes
            fadingMaterials.add(anchor.scorchMaterial)
        }
        anchors.set(container, anchor)
        return anchor
    }
    // How far an anchor's content has moved on screen since the damage was done (screen px).
    const anchorShift = anchor =>
        anchor
            ? { x: anchor.left - anchor.container.scrollLeft, y: anchor.top - anchor.container.scrollTop }
            : { x: 0, y: 0 }
    const updateAnchors = () => {
        anchors.forEach(anchor => {
            const shift = anchorShift(anchor)
            anchor.holeGroup.position.set(shift.x, -shift.y, 0)
            anchor.scorchGroup.position.set(shift.x, -shift.y, 0)
        })
    }
    const anchorOfElement = element => anchorFor(findScrollContainer(element))

    /* Task snakes. */
    const tileGeometry = new BoxGeometry(SNAKE_TILE, SNAKE_TILE, 7)
    disposables.add(tileGeometry)
    const snakes = []
    const takenRows = new WeakSet()
    // Rows that crawled off: their spot is covered, so a bolt there must not hit the hidden row.
    const coveredRows = []
    let snakeTimer = SNAKE_FIRST_DELAY
    let snakesSpawned = 0

    /* World state. Everything positional is screen space. */
    const hero = {
        x: from ? from.x : viewport.width / 2,
        y: from ? from.y : 60,
        vx: 0,
        vy: 0,
        facing: 1,
        yaw: -HERO_YAW,
    }
    const entryTarget = { x: viewport.width * 0.5, y: viewport.height * 0.42 }
    let entering = 0.7
    const aim = { x: hero.x + 200, y: viewport.height * 0.42 }
    const held = new Set()
    let pointerFiring = false
    // A tap or quick click can press and release inside one frame; it still owes one shot.
    let pendingShot = false
    // The greeting in progress (Space / 👋), or null. While it runs she neither flies nor shoots.
    let greeting = null
    let lastGreetingStyle = null
    let bubble = null
    let touchSeek = false
    let fireCooldown = 0
    let destroyedCount = 0
    let shake = 0
    let time = 0
    let phase = 'playing'
    let finished = false
    let rewindStart = 0

    // The game on top of the toy: score, health, weapons and the boss.
    let score = 0
    let best = 0
    const freshHealth = () => {
        const fresh = createHealth()
        if (typeof tuning.startHealth === 'number') fresh.hp = Math.max(1, Math.min(MAX_HEALTH, tuning.startHealth))
        return fresh
    }
    let health = freshHealth()
    let playTime = tuning.bossHeadStart || 0
    let snakesKilled = 0
    let paused = false
    let scoreSubmitted = false
    let gameOverAt = 0
    let gameOverShown = false
    let owned = new Set([RAGE_DEFAULT_WEAPON])
    const preferredWeapon = readStoredWeapon()
    let equipped = RAGE_DEFAULT_WEAPON
    let knownGold = null
    let boss = null
    let bossModel = null
    let bossSummoned = false
    let bossDebris = null
    const orbs = []
    const flames = []
    const blackholes = []
    let laserTick = 0
    let laserPhase = 0
    // Space toggles auto-fire: she keeps shooting at the cursor without a button held down.
    let autoFire = false

    const bolts = []
    const pieces = []
    const effects = []
    const destroyedGlyphs = new Map()
    let destroyedBlocks = new WeakSet()

    const sound = createSound()
    sound.unlock()
    const ui = buildHud(strings, touchDevice, sound.muted, visibleWidth() < NARROW_HUD_WIDTH)
    // Centre every overlay on what is visible, not on the (possibly wider) layout viewport.
    const centreOverlays = () => {
        const centre = `${visibleWidth() / 2}px`
        ;[ui.hud, ui.help, ui.weaponBar, ui.bossBar, ui.toast].forEach(node => {
            node.style.left = centre
        })
        const height = visibleHeight()
        ui.weaponBar.style.bottom = 'auto'
        ui.weaponBar.style.top = `calc(${height}px - env(safe-area-inset-bottom, 0px) - 60px)`
        // Anchored by its bottom edge just above the weapon bar, however many lines it wraps to.
        ui.help.style.bottom = 'auto'
        ui.help.style.top = `calc(${height}px - env(safe-area-inset-bottom, 0px) - 70px)`
        ui.help.style.transform = 'translate(-50%, -100%)'
    }
    centreOverlays()
    const { hud, greet, mute, exit, help } = ui
    const updateCounter = () => {
        hud.dataset.destroyed = String(destroyedCount)
        hud.dataset.score = String(score)
        ui.scoreValue.textContent = `★ ${score.toLocaleString()}`
        ui.bestValue.textContent = `🏆 ${Math.max(best, score).toLocaleString()}`
    }
    const updateHealth = () => {
        const share = health.hp / MAX_HEALTH
        ui.healthFill.style.width = `${share * 100}%`
        ui.healthFill.style.background = share > 0.5 ? '#09D693' : share > 0.25 ? '#FFAE47' : '#E00000'
        hud.dataset.health = String(health.hp)
    }
    const addScore = points => {
        score += points
        updateCounter()
    }
    let toastTimer = 0
    const showToast = (text, seconds = 1.8) => {
        ui.toast.textContent = text
        ui.toast.style.opacity = '1'
        clearTimeout(toastTimer)
        toastTimer = setTimeout(() => {
            ui.toast.style.opacity = '0'
        }, seconds * 1000)
    }
    updateCounter()
    updateHealth()

    document.body.append(inputLayer, canvas, hud, help, ui.weaponBar, ui.bossBar, ui.toast)
    const entranceFrameId = requestAnimationFrame(() => {
        if (phase !== 'playing' || finished) return
        inputLayer.style.boxShadow = 'inset 0 0 90px rgba(224,0,0,0.14)'
    })
    const helpTimer = setTimeout(() => {
        help.style.opacity = '0'
    }, 4500)

    /* Spawning. */
    /**
     * A flying piece. `rect` is where it came from on the page (its rewind target, filed under
     * `rect.anchor` so it follows a scrolled list home); `rect.start` is where it is now, when that
     * differs (a snake tile knocked off mid-crawl). `rect.restScale` is the size it returns to.
     */
    const addPiece = (mesh, rect, impact, power, kind) => {
        const origin = { x: rect.x, y: rect.y, z: PIECE_START_Z }
        const start = rect.start || origin
        const velocity = launchVelocity(start, impact, random, power)
        const piece = {
            mesh,
            kind,
            origin,
            anchor: rect.anchor || null,
            ownGeometry: kind === 'shard',
            restScale: rect.restScale || null,
            x: start.x,
            y: start.y,
            z: start.z !== undefined ? start.z : origin.z,
            rx: 0,
            ry: 0,
            rz: 0,
            age: 0,
            sleeping: false,
            halfHeight: rect.halfHeight,
            ...velocity,
        }
        mesh.renderOrder = 3
        toWorld(mesh, piece.x, piece.y, piece.z)
        scene.add(mesh)
        pieces.push(piece)
        // Over the cap, the oldest piece goes; its hole stays, so the page keeps its damage.
        while (pieces.length > MAX_PIECES) {
            const old = pieces.shift()
            scene.remove(old.mesh)
            if (old.ownGeometry) old.mesh.geometry.dispose()
        }
    }

    // Holes and burn marks are placed in their anchor's group at the anchor's CURRENT scroll, so a
    // later scroll moves them together with the content.
    const addHole = (rect, background, pad = 1, anchor = null) => {
        const mesh = new Mesh(unitPlane, holeMaterial(background, anchor))
        const shift = anchorShift(anchor)
        mesh.scale.set(rect.width + pad * 2, rect.height + pad * 2, 1)
        toWorld(mesh, rect.left + rect.width / 2 - shift.x, rect.top + rect.height / 2 - shift.y, 0)
        mesh.renderOrder = 1
        ;(anchor ? anchor.holeGroup : holes).add(mesh)
    }

    const scorchMeshes = []
    const addScorch = (x, y, size, anchor = null) => {
        const mesh = new Mesh(unitPlane, (anchor && anchor.scorchMaterial) || scorchMaterial)
        const shift = anchorShift(anchor)
        mesh.scale.set(size, size, 1)
        mesh.rotation.z = random() * Math.PI * 2
        toWorld(mesh, x - shift.x, y - shift.y, 0.5)
        mesh.renderOrder = 2
        ;(anchor ? anchor.scorchGroup : scorches).add(mesh)
        scorchMeshes.push(mesh)
        while (scorchMeshes.length > MAX_SCORCH) {
            const old = scorchMeshes.shift()
            if (old.parent) old.parent.remove(old)
        }
    }

    const addFlash = (x, y, size, life = 0.22) => {
        const material = new MeshBasicMaterial({
            map: glowTexture,
            transparent: true,
            blending: AdditiveBlending,
            depthWrite: false,
        })
        const mesh = new Mesh(unitPlane, material)
        mesh.renderOrder = 5
        toWorldOnScreen(mesh, x, y, 30)
        scene.add(mesh)
        effects.push({ type: 'flash', mesh, material, size, age: 0, life })
    }

    const addSparks = (x, y, count, power = 1) => {
        for (let i = 0; i < count; i++) {
            const angle = random() * Math.PI * 2
            const speed = (220 + random() * 420) * power
            const mesh = new Mesh(sparkGeometry, sparkMaterial)
            mesh.renderOrder = 5
            toWorldOnScreen(mesh, x, y, 20)
            scene.add(mesh)
            effects.push({
                type: 'spark',
                mesh,
                x,
                y,
                z: 20,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 120,
                vz: random() * 300,
                age: 0,
                life: 0.28 + random() * 0.2,
            })
        }
        while (effects.length > MAX_EFFECTS) {
            const old = effects.shift()
            scene.remove(old.mesh)
            if (old.material) old.material.dispose()
        }
    }

    /* Hits. */
    const knockOutText = (hit, impact, power) => {
        const gone = destroyedGlyphs.get(hit.node) || new Set()
        destroyedGlyphs.set(hit.node, gone)
        const anchor = anchorOfElement(hit.node.parentElement)
        hit.anchor = anchor
        hit.glyphs.forEach(glyph => {
            gone.add(glyph.index)
            addHole(glyph.rect, hit.background, 1, anchor)
            const texture = glyphTexture(glyph.char, hit.style, glyph.rect.width, glyph.rect.height)
            disposables.add(texture)
            const material = new MeshBasicMaterial({
                map: texture,
                transparent: true,
                side: DoubleSide,
                alphaTest: 0.05,
            })
            disposables.add(material)
            const mesh = new Mesh(unitPlane, material)
            mesh.scale.set(glyph.rect.width, glyph.rect.height, 1)
            addPiece(
                mesh,
                {
                    x: glyph.rect.left + glyph.rect.width / 2,
                    y: glyph.rect.top + glyph.rect.height / 2,
                    halfHeight: glyph.rect.height / 2,
                    anchor,
                },
                impact,
                power,
                'glyph'
            )
        })
        destroyedCount += hit.glyphs.length
    }

    const shatterBlock = (hit, impact, power) => {
        destroyedBlocks.add(hit.element)
        const anchor = anchorOfElement(hit.element)
        hit.anchor = anchor
        // 1px over: an anti-aliased border would otherwise survive as a hairline outline.
        addHole(hit.rect, hit.background, 1, anchor)
        const { width, height } = hit.rect
        const faceMaterial =
            hit.kind === 'image'
                ? new MeshBasicMaterial({ map: imageTexture(hit, width, height), side: DoubleSide })
                : new MeshBasicMaterial({ color: opaqueColor(hit.color), side: DoubleSide })
        disposables.add(faceMaterial)
        if (faceMaterial.map) disposables.add(faceMaterial.map)
        const sideMaterial = edgeMaterial(hit.kind === 'image' ? '#8C95A8' : hit.color)
        const thickness = Math.max(3, Math.min(8, Math.min(width, height) * 0.08))
        shatterRect(width, height, random, hit.kind === 'image' ? 38 : 26).forEach(shard => {
            const geometry = shardGeometry(shard.vertices, shard.centroid, thickness, { width, height })
            const mesh = new Mesh(geometry, [faceMaterial, sideMaterial])
            const spanY = Math.max(...shard.vertices.map(v => Math.abs(v.y - shard.centroid.y)))
            addPiece(
                mesh,
                {
                    x: hit.rect.left + shard.centroid.x,
                    y: hit.rect.top + shard.centroid.y,
                    halfHeight: spanY,
                    anchor,
                },
                impact,
                power * 0.9,
                'shard'
            )
        })
        destroyedCount += 1
        addScorch(
            hit.rect.left + width / 2,
            hit.rect.top + height / 2,
            Math.min(140, Math.max(width, height) * 0.9),
            anchor
        )
    }

    /**
     * Something on the page was hit. `quiet` hits (a flame, a laser tick, one sample of a blast) knock
     * the page out and score, but leave the flash, sparks and sound to whatever caused them.
     */
    const impactAt = (x, y, hit, { quiet = false, power = 1 } = {}) => {
        if (hit.kind === 'text') knockOutText(hit, { x, y }, power)
        else shatterBlock(hit, { x, y }, power)
        addScore(pointsForHit(hit))
        addScorch(x, y, (quiet ? 16 : 34) + random() * (quiet ? 10 : 22), hit.anchor)
        if (!quiet) {
            addFlash(x, y, 70)
            addSparks(x, y, 7)
            shake = Math.min(9, shake + (hit.kind === 'text' ? 2.2 : 4.5))
            sound.boom(hit.kind === 'text' ? 0.8 : 1.2)
        }
        updateCounter()
    }

    /* Task snakes: spawning, crawling, getting shot. */
    const snakeBounds = () => ({ left: 16, top: 72, right: viewport.width - 16, bottom: viewport.height - 16 })

    const tileMesh = (char, color, head) => {
        const face = new MeshBasicMaterial({ map: tileTexture(char, color, head) })
        const side = edgeMaterial(color)
        disposables.add(face)
        disposables.add(face.map)
        return new Mesh(tileGeometry, [side, side, side, side, face, side])
    }

    /** Peel one task row out of the list and turn it into a snake. Returns false if none is left. */
    const spawnSnake = () => {
        const rows = findTaskRows(viewport, takenRows)
        while (rows.length) {
            const row = rows.splice(Math.floor(random() * rows.length), 1)[0]
            takenRows.add(row)
            const glyphs = rowGlyphs(row, SNAKE_MAX_LETTERS)
            if (glyphs.length < 2) continue

            const rect = row.getBoundingClientRect()
            const anchor = anchorOfElement(row)
            const shift = anchorShift(anchor)
            addHole(
                { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                resolveBackgroundColor(row.parentElement),
                1,
                anchor
            )
            coveredRows.push({
                rect: {
                    left: rect.left - shift.x,
                    top: rect.top - shift.y,
                    right: rect.right - shift.x,
                    bottom: rect.bottom - shift.y,
                },
                anchor,
            })
            // Its letters are gone from the page now; a bolt must not knock them out a second time.
            glyphs.forEach(glyph => {
                const gone = destroyedGlyphs.get(glyph.node) || new Set()
                gone.add(glyph.index)
                destroyedGlyphs.set(glyph.node, gone)
            })

            const color = SNAKE_COLORS[snakesSpawned % SNAKE_COLORS.length]
            snakesSpawned += 1
            const centre = glyph => ({
                x: glyph.rect.left + glyph.rect.width / 2,
                y: glyph.rect.top + glyph.rect.height / 2,
            })
            const last = glyphs[glyphs.length - 1]
            const headOrigin = { x: last.rect.left + last.rect.width + SNAKE_TILE / 2 + 4, y: centre(last).y }
            // Head first, then the title back to front, so the tail is its first letter.
            const segments = [
                { mesh: tileMesh('', color, true), origin: headOrigin, restScale: 0.7 },
                ...glyphs
                    .slice()
                    .reverse()
                    .map(glyph => ({
                        mesh: tileMesh(glyph.char, color, false),
                        origin: centre(glyph),
                        restScale: Math.max(0.35, glyph.rect.height / SNAKE_TILE),
                    })),
            ].map(segment => ({
                ...segment,
                origin: { x: segment.origin.x - shift.x, y: segment.origin.y - shift.y },
                anchor,
                pos: null,
            }))
            segments.forEach(segment => {
                segment.mesh.renderOrder = 3
                scene.add(segment.mesh)
            })
            snakes.push({
                snake: createSnake({ head: headOrigin, tail: centre(glyphs[0]), segmentCount: segments.length }),
                segments,
                morph: 0,
                anchor,
            })
            hud.dataset.snakes = String(snakes.length)
            sound.boom(0.3)
            return true
        }
        return false
    }

    const segmentOrigin = segment => {
        const shift = anchorShift(segment.anchor)
        return { x: segment.origin.x + shift.x, y: segment.origin.y + shift.y }
    }

    const ease = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

    const nextSpawnGap = () => SNAKE_SPAWN_GAP_MIN + random() * (SNAKE_SPAWN_GAP_MAX - SNAKE_SPAWN_GAP_MIN)

    const updateSnakes = (dt, active = true) => {
        if (active && entering <= 0) {
            snakeTimer -= dt
            if (snakeTimer <= 0) {
                if (snakes.length < MAX_SNAKES) spawnSnake()
                snakeTimer = nextSpawnGap()
            }
        }
        const bounds = snakeBounds()
        snakes.forEach(entry => {
            entry.morph = Math.min(1, entry.morph + dt / SNAKE_MORPH_SECONDS)
            const settled = ease(entry.morph)
            // It starts crawling half-way through turning back into tiles, so it peels off in motion.
            if (entry.morph > 0.5) stepSnake(entry.snake, dt, bounds, random, entry.segments.length)
            const positions = segmentPositions(entry.snake, entry.segments.length)
            entry.segments.forEach((segment, index) => {
                const from = segmentOrigin(segment)
                const to = positions[index]
                segment.pos = {
                    x: from.x + (to.x - from.x) * settled,
                    y: from.y + (to.y - from.y) * settled,
                }
                const scale = segment.restScale + (entry.snake.scale - segment.restScale) * settled
                segment.mesh.scale.setScalar(scale)
                toWorldOnScreen(segment.mesh, segment.pos.x, segment.pos.y, SNAKE_Z + Math.sin(time * 9 + index) * 2)
            })
            const head = entry.segments[0]
            head.mesh.rotation.z = Math.atan2(-entry.snake.dir.y, entry.snake.dir.x)
            // A snake that crawls into Anna bites.
            if (active && entry.morph >= 1) {
                const bite = entry.segments.find(
                    segment =>
                        segment.pos && Math.abs(segment.pos.x - hero.x) < 24 && Math.abs(segment.pos.y - hero.y) < 44
                )
                if (bite) takeDamage(DAMAGE.snakeBite, bite.pos)
            }
        })
    }

    const snakeAt = (x, y) => {
        for (let s = 0; s < snakes.length; s++) {
            const entry = snakes[s]
            const reach = (SNAKE_TILE / 2) * entry.snake.scale + 7
            for (let i = 0; i < entry.segments.length; i++) {
                const pos = entry.segments[i].pos
                if (pos && Math.abs(pos.x - x) <= reach && Math.abs(pos.y - y) <= reach) return entry
            }
        }
        return null
    }

    const segmentToPiece = (segment, impact, power) => {
        addPiece(
            segment.mesh,
            {
                x: segment.origin.x,
                y: segment.origin.y,
                start: {
                    x: segment.pos ? segment.pos.x : segment.origin.x,
                    y: segment.pos ? segment.pos.y : segment.origin.y,
                    z: SNAKE_Z,
                },
                halfHeight: (SNAKE_TILE / 2) * segment.mesh.scale.x,
                anchor: segment.anchor,
                restScale: segment.restScale,
            },
            impact,
            power,
            'tile'
        )
    }

    const removeSnake = entry => {
        const index = snakes.indexOf(entry)
        if (index >= 0) snakes.splice(index, 1)
        hud.dataset.snakes = String(snakes.length)
    }

    const burstSnake = (entry, impact) => {
        entry.segments.splice(0).forEach(segment => segmentToPiece(segment, impact, 1.5))
        removeSnake(entry)
        addFlash(impact.x, impact.y, 150, 0.35)
        addSparks(impact.x, impact.y, 16, 1.4)
        shake = 10
        sound.boom(1.7)
        destroyedCount += 1
        snakesKilled += 1
        addScore(POINTS.snakeKill)
        heal(health, SNAKE_KILL_HEAL)
        updateHealth()
        hud.dataset.snakesKilled = String(Number(hud.dataset.snakesKilled || 0) + 1)
        snakeTimer = Math.min(snakeTimer, nextSpawnGap())
    }

    /** One tile off a snake: shorter, never smaller — until only the head is left and it bursts. */
    const hitSnake = (entry, x, y, quiet = false) => {
        if (!snakes.includes(entry)) return
        const impact = { x, y }
        if (entry.segments.length > 1) segmentToPiece(entry.segments.pop(), impact, 1)
        const { dead } = shrinkSnake(entry.snake, entry.segments.length)
        destroyedCount += 1
        addScore(POINTS.snakeTile)
        hud.dataset.snakeHits = String(Number(hud.dataset.snakeHits || 0) + 1)
        if (dead) burstSnake(entry, impact)
        else if (quiet) addSparks(x, y, 2)
        else {
            addFlash(x, y, 60)
            addSparks(x, y, 6)
            shake = Math.min(9, shake + 3)
            sound.boom(0.9)
        }
        updateCounter()
    }

    // Weapons deal fractional damage (a flame, a laser tick); a snake loses a tile per whole point.
    const damageSnake = (entry, amount, impact, quiet = false) => {
        entry.pending = (entry.pending || 0) + amount
        while (entry.pending >= 1 && snakes.includes(entry)) {
            entry.pending -= 1
            hitSnake(entry, impact.x, impact.y, quiet)
        }
    }

    // Read-only, on the arena's own node: where the boss is, for browser-tests/rage-mode to aim at.
    inputLayer.rageBossTarget = () => (boss ? { x: boss.x, y: boss.y } : null)
    // Likewise where the snakes are.
    inputLayer.rageSnakeTargets = () => snakes.map(entry => entry.segments.map(segment => segment.pos).filter(Boolean))

    const isCovered = (x, y) =>
        coveredRows.some(({ rect, anchor }) => {
            const shift = anchorShift(anchor)
            return (
                x >= rect.left + shift.x &&
                x <= rect.right + shift.x &&
                y >= rect.top + shift.y &&
                y <= rect.bottom + shift.y
            )
        })

    /* Health. */
    let hurtTimer = 0
    const takeDamage = (amount, source) => {
        if (phase !== 'playing' || paused || tuning.invincible) return
        const result = applyDamage(health, amount, time)
        if (!result.hit) return
        const dx = hero.x - source.x
        const dy = hero.y - source.y
        const length = Math.hypot(dx, dy) || 1
        hero.vx += (dx / length) * 520
        hero.vy += (dy / length) * 520
        shake = 12
        sound.hurt()
        inputLayer.style.boxShadow = 'inset 0 0 160px rgba(224,0,0,0.55)'
        clearTimeout(hurtTimer)
        hurtTimer = setTimeout(() => {
            if (phase === 'playing') inputLayer.style.boxShadow = 'inset 0 0 90px rgba(224,0,0,0.14)'
        }, 260)
        hud.dataset.hurt = String(Number(hud.dataset.hurt || 0) + 1)
        updateHealth()
        if (result.dead) gameOver()
    }

    /* Firing. */
    const muzzle = () => {
        const angle = aimAngle({ x: hero.x, y: hero.y - 6 }, aim)
        const reach = 36 * CHARACTER_SCALE
        return { x: hero.x + Math.cos(angle) * reach, y: hero.y - 6 + Math.sin(angle) * reach, angle }
    }

    const rocketGeometry = new BoxGeometry(28, 9, 9)
    const rocketMaterial = new MeshBasicMaterial({ color: '#ECEFF1' })
    const holeCoreGeometry = new BoxGeometry(20, 20, 20)
    const holeCoreMaterial = new MeshBasicMaterial({ color: '#2A0845' })
    const voidTexture = radialTexture([
        [0, 'rgba(8,0,20,1)'],
        [0.45, 'rgba(36,0,72,0.95)'],
        [0.72, 'rgba(124,77,255,0.45)'],
        [1, 'rgba(124,77,255,0)'],
    ])
    ;[rocketGeometry, rocketMaterial, holeCoreGeometry, holeCoreMaterial, voidTexture].forEach(r => disposables.add(r))

    const glowMaterial = color =>
        new MeshBasicMaterial({
            map: glowTexture,
            color,
            transparent: true,
            blending: AdditiveBlending,
            depthWrite: false,
        })

    const spawnProjectile = (weapon, x, y, angle) => {
        const type = weapon.kind === 'rocket' ? 'rocket' : weapon.kind === 'blackhole' ? 'blackhole' : 'bolt'
        const mesh =
            type === 'rocket'
                ? new Mesh(rocketGeometry, rocketMaterial)
                : type === 'blackhole'
                  ? new Mesh(holeCoreGeometry, holeCoreMaterial)
                  : new Mesh(boltGeometry, boltMaterial)
        mesh.rotation.z = -angle
        mesh.renderOrder = 4
        toWorldOnScreen(mesh, x, y, BOLT_Z)
        const glow = new Mesh(
            unitPlane,
            glowMaterial(type === 'rocket' ? '#FFB74D' : type === 'blackhole' ? '#B388FF' : '#FFFFFF')
        )
        glow.scale.set(type === 'bolt' ? 34 : 48, type === 'bolt' ? 34 : 48, 1)
        glow.position.z = -2
        mesh.add(glow)
        scene.add(mesh)
        bolts.push({
            type,
            weapon,
            x,
            y,
            dx: Math.cos(angle),
            dy: Math.sin(angle),
            speed: weapon.speed || BOLT_SPEED,
            travelled: 0,
            age: 0,
            mesh,
            glow,
        })
    }

    const fire = () => {
        const weapon = weaponById(equipped)
        hud.dataset.shots = String(Number(hud.dataset.shots || 0) + 1)
        if (weapon.kind === 'snap') return fireSnap(weapon)
        if (weapon.kind === 'flame') return spawnFlames(weapon)
        const { x, y, angle } = muzzle()
        volleyAngles(weapon, angle).forEach(a => spawnProjectile(weapon, x, y, a))
        addFlash(x, y, weapon.kind === 'bolt' && !weapon.pellets ? 34 : 56, 0.08)
        if (weapon.pellets) shake = Math.min(9, shake + 3)
        sound.pew()
    }

    const removeBolt = bolt => {
        // Removal is by identity: a snapshot may outlive an earlier removal, and a shrinking
        // list must never be indexed using the snapshot's iteration index (AT-2673).
        const index = bolts.indexOf(bolt)
        if (index < 0) return
        bolts.splice(index, 1)
        scene.remove(bolt.mesh)
        bolt.glow.material.dispose()
    }

    /**
     * Area damage: the page within `blast` (sampled, see `blastPoints`), every snake with a tile in
     * range, and the boss if the blast reaches its box. Used by rockets, black holes and the snap.
     */
    const damageArea = (centre, blast, damage, power = 1.3) => {
        withLayerTransparent(inputLayer, () => {
            blastPoints(centre, blast, blast > 100 ? 3 : 2).forEach(point => {
                if (isCovered(point.x, point.y)) return
                const hit = resolveHit({
                    x: point.x,
                    y: point.y,
                    radius: blast / 3,
                    layer: null,
                    destroyedGlyphs,
                    destroyedBlocks,
                    viewport,
                })
                if (hit) impactAt(point.x, point.y, hit, { quiet: true, power })
            })
        })
        snakes.slice().forEach(entry => {
            const inRange = entry.segments.some(
                segment => segment.pos && Math.hypot(segment.pos.x - centre.x, segment.pos.y - centre.y) <= blast
            )
            if (inRange) damageSnake(entry, damage, centre, true)
        })
        if (boss && Math.hypot(boss.x - centre.x, boss.y - centre.y) <= blast + BOSS_HALF_WIDTH) {
            hitBoss(damage, centre.x, centre.y, true)
        }
        addFlash(centre.x, centre.y, blast * 2.4, 0.4)
        addSparks(centre.x, centre.y, 18, 1.5)
        shake = Math.min(14, shake + 8)
        sound.boom(1.8)
    }

    const updateBolts = dt => {
        if (!bolts.length) return
        // All hit tests of a frame share one pass with the input layer switched off (see
        // `withLayerTransparent`); nothing can dispatch an event to the page in between.
        withLayerTransparent(inputLayer, () => {
            for (let i = bolts.length - 1; i >= 0; i--) {
                const bolt = bolts[i]
                bolt.age += dt
                if (bolt.type === 'blackhole' && bolt.age >= bolt.weapon.travel) {
                    startBlackhole(bolt.x, bolt.y, bolt.weapon)
                    removeBolt(bolt)
                    continue
                }
                const step = (bolt.speed * dt) / BOLT_SAMPLES
                let hitSomething = false
                for (let s = 0; s < BOLT_SAMPLES && !hitSomething; s++) {
                    bolt.x += bolt.dx * step
                    bolt.y += bolt.dy * step
                    bolt.travelled += step
                    // The first few pixels are inside the character's own gun.
                    if (bolt.age < 0.02) continue
                    if (bolt.type === 'blackhole') continue
                    const point = { x: bolt.x, y: bolt.y }
                    if (boss && insideBoss(boss, bolt.x, bolt.y)) {
                        if (bolt.type === 'rocket') damageArea(point, bolt.weapon.blast, bolt.weapon.damage)
                        else hitBoss(bolt.weapon.damage, bolt.x, bolt.y)
                        hitSomething = true
                        break
                    }
                    const snake = snakeAt(bolt.x, bolt.y)
                    if (snake) {
                        if (bolt.type === 'rocket') damageArea(point, bolt.weapon.blast, bolt.weapon.damage)
                        else damageSnake(snake, bolt.weapon.damage, point)
                        hitSomething = true
                        break
                    }
                    if (isCovered(bolt.x, bolt.y)) continue
                    const hit = resolveHit({
                        x: bolt.x,
                        y: bolt.y,
                        radius: bolt.weapon.radius || BOLT_HIT_RADIUS,
                        layer: null,
                        destroyedGlyphs,
                        destroyedBlocks,
                        viewport,
                    })
                    if (hit) {
                        if (bolt.type === 'rocket') damageArea(point, bolt.weapon.blast, bolt.weapon.damage)
                        else impactAt(bolt.x, bolt.y, hit)
                        hitSomething = true
                    }
                }
                const offScreen =
                    bolt.x < -40 || bolt.y < -40 || bolt.x > viewport.width + 40 || bolt.y > viewport.height + 40
                const spent = bolt.weapon.range && bolt.travelled > bolt.weapon.range
                if (hitSomething || offScreen || spent || bolt.age > 3) removeBolt(bolt)
                else {
                    toWorldOnScreen(bolt.mesh, bolt.x, bolt.y, BOLT_Z)
                    if (bolt.type === 'blackhole') bolt.mesh.rotation.set(time * 3, time * 4, time * 5)
                }
            }
        })
    }

    /* Flamethrower: a cone of short-lived flame puffs that burn whatever they touch. */
    const spawnFlames = weapon => {
        const { x, y, angle } = muzzle()
        for (let i = 0; i < 3; i++) {
            const a = angle + (random() - 0.5) * (weapon.spread || 0.3)
            const speed = weapon.speed * (0.8 + random() * 0.4)
            const material = glowMaterial(random() < 0.5 ? '#FF7043' : '#FFB74D')
            const mesh = new Mesh(unitPlane, material)
            mesh.renderOrder = 5
            scene.add(mesh)
            flames.push({
                x,
                y,
                vx: Math.cos(a) * speed,
                vy: Math.sin(a) * speed,
                age: 0,
                life: weapon.range / speed,
                mesh,
                material,
                weapon,
                check: i % 2 === 0,
            })
        }
        if (Math.random() < 0.25) sound.boom(0.25)
    }

    const removeFlame = index => {
        const flame = flames[index]
        scene.remove(flame.mesh)
        flame.material.dispose()
        flames.splice(index, 1)
    }

    const updateFlames = dt => {
        if (!flames.length) return
        withLayerTransparent(inputLayer, () => {
            for (let i = flames.length - 1; i >= 0; i--) {
                const flame = flames[i]
                flame.age += dt
                flame.x += flame.vx * dt
                flame.y += flame.vy * dt - 40 * dt
                const t = flame.age / flame.life
                if (t >= 1) {
                    removeFlame(i)
                    continue
                }
                const size = 16 + 46 * t
                flame.mesh.scale.set(size, size, 1)
                flame.material.opacity = 1 - t * 0.8
                toWorldOnScreen(flame.mesh, flame.x, flame.y, 24)
                const point = { x: flame.x, y: flame.y }
                if (boss && insideBoss(boss, flame.x, flame.y)) {
                    hitBoss(flame.weapon.damage, flame.x, flame.y, true)
                    removeFlame(i)
                    continue
                }
                const snake = snakeAt(flame.x, flame.y)
                if (snake) {
                    damageSnake(snake, flame.weapon.damage, point, true)
                    removeFlame(i)
                    continue
                }
                // Half the puffs test the page each frame: enough to burn a clean path, at half the cost.
                flame.check = !flame.check
                if (!flame.check || isCovered(flame.x, flame.y)) continue
                const hit = resolveHit({
                    x: flame.x,
                    y: flame.y,
                    radius: flame.weapon.radius,
                    layer: null,
                    destroyedGlyphs,
                    destroyedBlocks,
                    viewport,
                })
                if (hit) {
                    impactAt(flame.x, flame.y, hit, { quiet: true, power: 0.7 })
                    removeFlame(i)
                }
            }
        })
    }

    /* Laser: a hitscan beam that cuts through everything along it while held. */
    const laserGroup = new Group()
    const laserCoreMaterial = new MeshBasicMaterial({
        color: '#E0FFFF',
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
    })
    const laserGlowMaterial = glowMaterial('#4DD0E1')
    const laserCore = new Mesh(unitPlane, laserCoreMaterial)
    const laserGlow = new Mesh(unitPlane, laserGlowMaterial)
    laserGroup.add(laserGlow, laserCore)
    laserGroup.visible = false
    laserGroup.renderOrder = 5
    scene.add(laserGroup)
    disposables.add(laserCoreMaterial)
    disposables.add(laserGlowMaterial)

    const updateLaser = dt => {
        const weapon = weaponById(equipped)
        const active =
            phase === 'playing' &&
            !paused &&
            !greeting &&
            entering <= 0 &&
            weapon.kind === 'laser' &&
            (pointerFiring || autoFire)
        laserGroup.visible = active
        hud.dataset.laser = active ? 'on' : ''
        if (!active) return
        const { x, y, angle } = muzzle()
        const dx = Math.cos(angle)
        const dy = Math.sin(angle)
        // To the edge of the screen, or the boss, whichever comes first.
        const toEdge = Math.min(
            dx > 0 ? (viewport.width - x) / dx : dx < 0 ? -x / dx : Infinity,
            dy > 0 ? (viewport.height - y) / dy : dy < 0 ? -y / dy : Infinity
        )
        let length = Math.min(weapon.range, Math.max(0, toEdge))
        let hitsBoss = false
        if (boss) {
            for (let d = 0; d < length; d += 12) {
                if (insideBoss(boss, x + dx * d, y + dy * d)) {
                    length = d
                    hitsBoss = true
                    break
                }
            }
        }
        const flicker = 0.8 + Math.random() * 0.4
        toWorldOnScreen(laserGroup, x + (dx * length) / 2, y + (dy * length) / 2, BOLT_Z)
        laserGroup.rotation.z = -angle
        laserCore.scale.set(length, 4 * flicker, 1)
        laserGlow.scale.set(length + 30, 26 * flicker, 1)
        shake = Math.max(shake, 1.5)

        laserTick += dt
        if (laserTick < weapon.interval) return
        laserTick = 0
        laserPhase = (laserPhase + 1) % 3
        withLayerTransparent(inputLayer, () => {
            for (let d = 30 + laserPhase * 8; d < length; d += 24) {
                const px = x + dx * d
                const py = y + dy * d
                if (isCovered(px, py)) continue
                const hit = resolveHit({
                    x: px,
                    y: py,
                    radius: weapon.radius,
                    layer: null,
                    destroyedGlyphs,
                    destroyedBlocks,
                    viewport,
                })
                if (hit) impactAt(px, py, hit, { quiet: true, power: 0.6 })
            }
        })
        snakes.slice().forEach(entry => {
            const touched = entry.segments.find(segment => {
                if (!segment.pos) return false
                const along = (segment.pos.x - x) * dx + (segment.pos.y - y) * dy
                if (along < 0 || along > length) return false
                const off = Math.abs((segment.pos.x - x) * dy - (segment.pos.y - y) * dx)
                return off < SNAKE_TILE / 2 + 4
            })
            if (touched) damageSnake(entry, weapon.damage, touched.pos, true)
        })
        if (hitsBoss) hitBoss(weapon.damage, x + dx * length, y + dy * length, true)
        addSparks(x + dx * length, y + dy * length, 2, 0.6)
    }

    /* Black hole: stops, pulls everything loose towards it, then implodes. */
    const startBlackhole = (x, y, weapon) => {
        const material = new MeshBasicMaterial({ map: voidTexture, transparent: true, depthWrite: false })
        const core = new Mesh(unitPlane, material)
        const ringMaterial = glowMaterial('#B388FF')
        const ring = new Mesh(unitPlane, ringMaterial)
        core.renderOrder = 5
        ring.renderOrder = 5
        scene.add(ring, core)
        blackholes.push({ x, y, weapon, age: 0, core, ring, material, ringMaterial })
        sound.boom(0.6)
    }

    const updateBlackholes = dt => {
        for (let i = blackholes.length - 1; i >= 0; i--) {
            const hole = blackholes[i]
            hole.age += dt
            const t = hole.age / hole.weapon.pull
            const size = hole.weapon.blast * (0.5 + 0.5 * Math.min(1, t * 3)) * (1 + Math.sin(time * 20) * 0.04)
            hole.core.scale.set(size, size, 1)
            hole.ring.scale.set(size * 1.5, size * 1.5, 1)
            hole.ring.rotation.z = time * 4
            toWorldOnScreen(hole.core, hole.x, hole.y, 26)
            toWorldOnScreen(hole.ring, hole.x, hole.y, 25)
            // Everything loose within reach is pulled in.
            const reach = hole.weapon.blast * 1.8
            pieces.forEach(piece => {
                const dx = hole.x - piece.x
                const dy = hole.y - piece.y
                const distance = Math.hypot(dx, dy)
                if (distance > reach || distance < 1) return
                piece.sleeping = false
                piece.vx += (dx / distance) * 2400 * dt
                piece.vy += (dy / distance) * 2400 * dt - 1900 * dt
                piece.spinZ += 20 * dt
            })
            if (t >= 1) {
                damageArea({ x: hole.x, y: hole.y }, hole.weapon.blast, hole.weapon.damage, 1.8)
                pieces.forEach(piece => {
                    const dx = piece.x - hole.x
                    const dy = piece.y - hole.y
                    const distance = Math.hypot(dx, dy) || 1
                    if (distance > reach) return
                    piece.vx += (dx / distance) * 900
                    piece.vy += (dy / distance) * 900
                })
                scene.remove(hole.core, hole.ring)
                hole.material.dispose()
                hole.ringMaterial.dispose()
                blackholes.splice(i, 1)
            }
        }
    }

    /* Finger snap: half the visible text turns to dust, every snake bursts, the boss takes a hit. */
    const fireSnap = weapon => {
        addFlash(viewport.width / 2, viewport.height / 2, Math.max(viewport.width, viewport.height) * 2.2, 0.6)
        shake = 16
        sound.boom(2)
        showToast('🫰', 1.2)
        snakes
            .slice()
            .forEach(entry => damageSnake(entry, entry.segments.length + 1, entry.segments[0].pos || hero, true))
        if (boss) hitBoss(weapon.damage, boss.x, boss.y)
        const cols = 11
        const rows = 8
        withLayerTransparent(inputLayer, () => {
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    if (random() > weapon.share) continue
                    const x = ((c + 0.2 + random() * 0.6) / cols) * viewport.width
                    const y = 70 + ((r + 0.2 + random() * 0.6) / rows) * (viewport.height - 90)
                    if (isCovered(x, y)) continue
                    const hit = resolveHit({
                        x,
                        y,
                        radius: 34,
                        layer: null,
                        destroyedGlyphs,
                        destroyedBlocks,
                        viewport,
                    })
                    if (hit) impactAt(x, y, hit, { quiet: true, power: 0.55 })
                }
            }
        })
    }

    /* The boss. */
    const openTasksToday = () => {
        const reported = services.getOpenTasksToday ? services.getOpenTasksToday() : null
        if (typeof reported === 'number' && Number.isFinite(reported)) return Math.max(0, Math.floor(reported))
        // Without a count from the app, the task rows on the page stand in for today's list.
        return document.querySelectorAll(TASK_ROW_SELECTOR).length
    }

    const maybeSummonBoss = () => {
        if (boss || bossSummoned) return
        if (!shouldSummonBoss({ snakesKilled, elapsed: playTime, summoned: bossSummoned, openTasks: 1 })) return
        // Decided once: an empty day has no boss, and the count is not re-read every frame after that.
        bossSummoned = true
        const count = openTasksToday()
        if (!count) return
        boss = createBoss(count, viewport)
        bossModel = buildBoss(strings.bossCaption)
        bossModel.setCount(count)
        scene.add(bossModel.group)
        ui.bossLabel.textContent = `👾 ${strings.bossName.replace('{count}', count)}`
        ui.bossBar.style.display = 'flex'
        ui.bossFill.style.width = '100%'
        hud.dataset.boss = String(count)
        showToast(`⚠️ ${strings.bossIncoming}`, 2)
        sound.boom(2)
        shake = 10
    }

    const removeBoss = () => {
        if (bossModel) {
            scene.remove(bossModel.group)
            bossModel.dispose()
        }
        boss = null
        bossModel = null
        ui.bossBar.style.display = 'none'
        delete hud.dataset.boss
        orbs.splice(0).forEach(orb => {
            scene.remove(orb.mesh)
            orb.material.dispose()
        })
    }

    const hitBoss = (amount, x, y, quiet = false) => {
        if (!boss) return
        const killed = damageBoss(boss, amount)
        addScore(POINTS.bossHit)
        ui.bossFill.style.width = `${(boss.hp / boss.maxHp) * 100}%`
        if (!quiet) {
            addFlash(x, y, 70)
            addSparks(x, y, 8)
            shake = Math.min(10, shake + 3)
            sound.boom(1)
        }
        if (killed) bossDefeated()
    }

    const bossDefeated = () => {
        const count = boss.openTasks
        const points = bossKillPoints(count)
        addScore(points)
        heal(health, 30)
        updateHealth()
        for (let i = 0; i < 7; i++) {
            addFlash(
                boss.x + (random() - 0.5) * BOSS_HALF_WIDTH * 2,
                boss.y + (random() - 0.5) * BOSS_HALF_HEIGHT * 2,
                120 + random() * 160,
                0.5 + random() * 0.4
            )
        }
        addSparks(boss.x, boss.y, 40, 2)
        shake = 18
        sound.boom(2)
        // Its parts fly apart and fade: the group stays, each child gets a velocity and a spin.
        bossDebris = {
            model: bossModel,
            age: 0,
            parts: bossModel.group.children.map(child => ({
                child,
                v: { x: (random() - 0.5) * 900, y: random() * 700, z: random() * 500 },
                spin: { x: (random() - 0.5) * 12, y: (random() - 0.5) * 12, z: (random() - 0.5) * 12 },
            })),
        }
        bossModel = null
        boss = null
        ui.bossBar.style.display = 'none'
        hud.dataset.bossDefeated = String(count)
        showToast(`🏆 ${strings.bossDefeated} +${points.toLocaleString()}`, 2.4)
        orbs.splice(0).forEach(orb => {
            addFlash(orb.x, orb.y, 40)
            scene.remove(orb.mesh)
            orb.material.dispose()
        })
    }

    const updateBossDebris = dt => {
        if (!bossDebris) return
        bossDebris.age += dt
        bossDebris.parts.forEach(({ child, v, spin }) => {
            child.position.x += v.x * dt
            child.position.y += v.y * dt
            child.position.z += v.z * dt
            v.y -= 1400 * dt
            child.rotation.x += spin.x * dt
            child.rotation.y += spin.y * dt
            child.rotation.z += spin.z * dt
        })
        const fade = Math.max(0, 1 - bossDebris.age / 1.6)
        bossDebris.model.group.scale.setScalar(Math.max(0.01, fade))
        if (bossDebris.age >= 1.6) {
            scene.remove(bossDebris.model.group)
            bossDebris.model.dispose()
            bossDebris = null
        }
    }

    const spawnOrb = orb => {
        const material = glowMaterial('#FF5252')
        const mesh = new Mesh(unitPlane, material)
        mesh.scale.set(ORB_RADIUS * 4, ORB_RADIUS * 4, 1)
        mesh.renderOrder = 5
        scene.add(mesh)
        orbs.push({ ...orb, mesh, material })
    }

    const updateBoss = (dt, active = true) => {
        if (!boss) return
        const thrown = stepBoss(boss, dt, hero, viewport, random)
        if (active) thrown.forEach(spawnOrb)
        toWorldOnScreen(bossModel.group, boss.x, boss.y, BOSS_Z)
        bossModel.group.rotation.set(
            Math.sin(boss.t * 1.7) * 0.08,
            Math.sin(boss.t * 0.9) * 0.25,
            Math.sin(boss.t * 2.1) * 0.05
        )
        bossModel.bodyMaterial.emissiveIntensity = boss.hurt > 0 ? 0.55 : 0
        bossModel.lookAt(hero.x - boss.x, hero.y - boss.y)
        bossModel.setCount(displayedCount(boss))
        if (active && insideBoss(boss, hero.x, hero.y, 12)) takeDamage(DAMAGE.bossContact, boss)
    }

    const updateOrbs = (dt, active = true) => {
        for (let i = orbs.length - 1; i >= 0; i--) {
            const orb = orbs[i]
            const alive = stepOrb(orb, dt, viewport)
            const pulse = 1 + Math.sin(time * 18 + i) * 0.15
            orb.mesh.scale.set(ORB_RADIUS * 4 * pulse, ORB_RADIUS * 4 * pulse, 1)
            toWorldOnScreen(orb.mesh, orb.x, orb.y, 28)
            const hitsHero = active && Math.hypot(orb.x - hero.x, orb.y - hero.y) < ORB_RADIUS + 20
            if (hitsHero) {
                takeDamage(DAMAGE.bossOrb, orb)
                addFlash(orb.x, orb.y, 60)
            }
            if (!alive || hitsHero) {
                scene.remove(orb.mesh)
                orb.material.dispose()
                orbs.splice(i, 1)
            }
        }
    }

    /* The greeting. */
    const removeBubble = () => {
        if (!bubble) return
        scene.remove(bubble.mesh)
        bubble.mesh.material.map.dispose()
        bubble.mesh.material.dispose()
        bubble = null
    }

    const startGreeting = () => {
        if (phase !== 'playing' || entering > 0 || greeting) return
        const style = pickGreetingStyle(random, lastGreetingStyle)
        lastGreetingStyle = style
        const lines = strings.greetings && strings.greetings.length ? strings.greetings : ['Hi! 👋']
        const { texture, width, height } = bubbleTexture(lines[Math.floor(random() * lines.length)])
        removeBubble()
        const mesh = new Mesh(
            unitPlane,
            new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false })
        )
        mesh.renderOrder = 6
        mesh.visible = false
        scene.add(mesh)
        bubble = { mesh, width, height }
        pointerFiring = false
        pendingShot = false
        // Observable from outside (browser-tests/rage-mode waits on it rather than guessing a delay).
        hud.dataset.greeting = style
        greeting = {
            t: 0,
            plan: {
                start: { x: hero.x, y: hero.y, z: CHARACTER_Z, yaw: hero.yaw, facing: hero.facing },
                stage: { x: viewport.width / 2, y: viewport.height * 0.5 },
                // At 62% of the way to the camera she appears ~2.6x her normal size.
                closeZ: projector.distance * 0.62,
                style,
            },
        }
        sound.boom(0.35)
    }

    const resetRig = () => {
        character.root.rotation.set(0, 0, 0)
        character.arm.rotation.set(0, 0, 0)
        character.rearArm.rotation.set(0.15, 0, 0)
        character.head.rotation.set(0, 0, 0)
    }

    const updateGreeting = dt => {
        // She stays under your control while she greets: WASD / arrows (or a held finger) keep
        // steering `hero`, and the loop is an OFFSET from wherever you steer her — so the loop still
        // starts and ends on her, and she ends up where you flew her rather than where she began.
        const seek = touchSeek ? touchHoverTarget(hero, aim, viewport) : null
        stepCharacter(hero, { thrust: moveVector(held), seek }, dt, viewport)
        greeting.t += dt
        const { plan } = greeting
        const loop = greetingPose(greeting.t, plan)
        // Keep all of her on screen: close to the camera she is up to ~2.6x bigger, so the edge
        // margins grow with her apparent size (her half-width, head above, feet below the centre).
        const grow = (CHARACTER_SCALE * projector.distance) / (projector.distance - loop.z)
        const clampTo = (value, min, max) => Math.max(min, Math.min(max, value))
        const pose = {
            ...loop,
            x: clampTo(hero.x + loop.x - plan.start.x, 26 * grow, viewport.width - 26 * grow),
            y: clampTo(hero.y + loop.y - plan.start.y, 48 * grow, viewport.height - 36 * grow),
        }
        toWorldOnScreen(character.root, pose.x, pose.y, pose.z)
        character.root.rotation.set(pose.pitch, 0, pose.roll)
        character.yaw.rotation.y = pose.yaw
        character.arm.rotation.set(pose.armSpread, 0, pose.armPitch)
        character.rearArm.rotation.set(pose.rearArm, 0, 0)
        character.head.rotation.set(pose.headTilt, 0, 0)
        character.flames.forEach((flame, index) => {
            const flicker = 0.75 + Math.random() * 0.5
            flame.scale.set(1, (index % 2 ? 0.8 : 1) * 1.1 * flicker, 1)
        })

        if (bubble) {
            // A little overshoot as it pops in. The bubble is drawn at a fixed screen size (it is
            // text, and must stay readable), with its tail tip just above-right of her head.
            const pop = pose.bubble < 1 ? pose.bubble * (1 + 0.25 * Math.sin(Math.PI * pose.bubble)) : 1
            const depth = (projector.distance - pose.z) / projector.distance
            const perspective = 1 / depth
            const size = BUBBLE_SCREEN_SCALE * pop
            const tipX = pose.x + 14 * CHARACTER_SCALE * perspective
            const tipY = pose.y - 40 * CHARACTER_SCALE * perspective
            bubble.mesh.visible = pose.bubble > 0.01
            bubble.mesh.scale.set(bubble.width * size * depth, bubble.height * size * depth, 1)
            // Beside her head, but never off screen: steered to an edge, the bubble slides inwards.
            const halfWidth = (bubble.width / 2) * size
            const halfHeight = (bubble.height / 2) * size
            toWorldOnScreen(
                bubble.mesh,
                Math.max(halfWidth + 8, Math.min(viewport.width - halfWidth - 8, tipX + halfWidth - 20 * size)),
                Math.max(halfHeight + 8, tipY - halfHeight),
                pose.z + 20
            )
        }

        if (pose.done) {
            delete hud.dataset.greeting
            greeting = null
            removeBubble()
            resetRig()
            hero.yaw = pose.yaw
        }
    }

    /*
     * Anna can fly over the whole page, not just what fits on screen: pushing against the top or
     * bottom edge scrolls the content under her. The damage follows (scroll anchors above).
     */
    let edgeContainer = null
    let edgeContainerAge = Infinity
    const edgeScroll = dt => {
        const pushingDown =
            held.has('down') || (touchSeek && aim.y > viewport.height - EDGE_SCROLL_ZONE) || hero.vy > 60
        const pushingUp = held.has('up') || (touchSeek && aim.y < 72 + EDGE_SCROLL_ZONE) || hero.vy < -60
        let direction = 0
        let depth = 0
        if (hero.y > viewport.height - EDGE_SCROLL_ZONE && pushingDown) {
            direction = 1
            depth = (hero.y - (viewport.height - EDGE_SCROLL_ZONE)) / EDGE_SCROLL_ZONE
        } else if (hero.y < 72 + EDGE_SCROLL_ZONE && pushingUp) {
            direction = -1
            depth = (72 + EDGE_SCROLL_ZONE - hero.y) / EDGE_SCROLL_ZONE
        }
        if (!direction) return
        edgeContainerAge += dt
        if (edgeContainerAge > 0.5) {
            edgeContainer = scrollContainerAt(hero.x, viewport.height / 2, inputLayer)
            edgeContainerAge = 0
        }
        // Gentle at the start of the zone, full speed at the edge.
        const ramp = 0.25 + 0.75 * Math.min(1, Math.max(0, depth)) ** 1.5
        if (edgeContainer) edgeContainer.scrollTop += direction * EDGE_SCROLL_SPEED * ramp * dt
    }

    /* Per-frame updates. */
    const updateHero = dt => {
        if (greeting) {
            updateGreeting(dt)
            return
        }
        if (entering > 0) {
            entering -= dt
            stepCharacter(hero, { thrust: null, seek: entryTarget }, dt, viewport)
        } else {
            const seek = touchSeek ? touchHoverTarget(hero, aim, viewport) : null
            stepCharacter(hero, { thrust: moveVector(held), seek }, dt, viewport)
        }
        edgeScroll(dt)
        if (aim.x > hero.x + 4) hero.facing = 1
        else if (aim.x < hero.x - 4) hero.facing = -1
        const targetYaw = hero.facing > 0 ? -HERO_YAW : Math.PI + HERO_YAW
        hero.yaw += (targetYaw - hero.yaw) * Math.min(1, dt * 12)

        const bob = Math.sin(time * 3.2) * 3
        toWorldOnScreen(character.root, hero.x, hero.y + bob, CHARACTER_Z)
        character.root.rotation.set(0, 0, Math.max(-0.4, Math.min(0.4, (-hero.vx / 620) * 0.4)))
        character.yaw.rotation.y = hero.yaw
        const angle = aimAngle({ x: hero.x, y: hero.y - 6 }, aim)
        const dx = Math.cos(angle)
        const dy = Math.sin(angle)
        const pitch = Math.max(-1.45, Math.min(1.45, Math.atan2(-dy, hero.facing > 0 ? dx : -dx)))
        character.arm.rotation.set(0, 0, pitch)
        // She looks where she shoots.
        character.head.rotation.set(0, 0, Math.max(-0.4, Math.min(0.4, pitch * 0.4)))
        character.rearArm.rotation.set(0.15 + Math.sin(time * 3.2) * 0.05, 0, 0)

        const thrust = Math.min(1, Math.hypot(hero.vx, hero.vy) / 500) + 0.35
        character.flames.forEach((flame, index) => {
            const flicker = 0.75 + Math.random() * 0.5
            flame.scale.set(1, (index % 2 ? 0.8 : 1) * thrust * flicker, 1)
        })
    }

    const updatePieces = dt => {
        for (let i = 0; i < pieces.length; i++) {
            const piece = pieces[i]
            if (!piece.sleeping) {
                stepDebris(piece, dt, viewport.height)
                const resting = piece.y >= viewport.height - (piece.halfHeight || 0) - 0.5
                if (resting && piece.vy === 0 && Math.abs(piece.vx) < 12 && piece.z < 6) piece.sleeping = true
            }
            toWorld(piece.mesh, piece.x, piece.y, piece.z)
            piece.mesh.rotation.set(piece.rx, piece.ry, piece.rz)
        }
    }

    const updateEffects = dt => {
        for (let i = effects.length - 1; i >= 0; i--) {
            const effect = effects[i]
            effect.age += dt
            const t = effect.age / effect.life
            if (t >= 1) {
                scene.remove(effect.mesh)
                if (effect.material) effect.material.dispose()
                effects.splice(i, 1)
                continue
            }
            if (effect.type === 'flash') {
                const size = effect.size * (0.4 + 0.9 * Math.sqrt(t))
                effect.mesh.scale.set(size, size, 1)
                effect.material.opacity = 1 - t
            } else {
                effect.x += effect.vx * dt
                effect.y += effect.vy * dt
                effect.vy += 900 * dt
                effect.z = Math.min(MAX_Z, effect.z + effect.vz * dt)
                toWorldOnScreen(effect.mesh, effect.x, effect.y, effect.z)
                effect.mesh.scale.setScalar(Math.max(0.01, 1 - t))
            }
        }
    }

    const updateCamera = dt => {
        const base = camera.userData.base
        shake = Math.max(0, shake - dt * 30)
        camera.position.set(base.x + (Math.random() - 0.5) * shake, base.y + (Math.random() - 0.5) * shake, base.z)
    }

    /* Rewind: every piece flies home, then the holes and scorch marks fade and the page is whole. */
    const beginRewind = () => {
        if (phase !== 'playing' && phase !== 'gameover') return
        submitScore()
        closeShop()
        gameOverUi.hide()
        removeBoss()
        flames.splice(0).forEach(flame => {
            scene.remove(flame.mesh)
            flame.material.dispose()
        })
        blackholes.splice(0).forEach(hole => {
            scene.remove(hole.core, hole.ring)
            hole.material.dispose()
            hole.ringMaterial.dispose()
        })
        laserGroup.visible = false
        setAutoFire(false)
        character.root.visible = true
        ui.weaponBar.style.opacity = '0'
        ui.weaponBar.style.transition = 'opacity 300ms ease'
        pointerFiring = false
        pendingShot = false
        touchSeek = false
        held.clear()
        if (greeting) {
            greeting = null
            removeBubble()
            resetRig()
        }
        bolts.slice().forEach(removeBolt)
        // Every snake still crawling flies home too, tile by tile, to the letters it came from.
        snakes
            .splice(0)
            .forEach(entry =>
                entry.segments.forEach(segment => segmentToPiece(segment, segment.pos || segment.origin, 0))
            )
        pieces.forEach(piece => {
            piece.snapshot = { x: piece.x, y: piece.y, z: piece.z, rx: piece.rx, ry: piece.ry, rz: piece.rz }
            piece.snapshotScale = piece.mesh.scale.x
        })
        // Publish the rewind phase only after every surviving piece has its starting pose.
        phase = 'rewinding'
        rewindStart = time
        inputLayer.style.boxShadow = 'inset 0 0 0 rgba(224,0,0,0)'
        help.style.opacity = '0'
        hud.style.opacity = '0'
        hud.style.transition = 'opacity 300ms ease'
        sound.boom(0.4)
    }

    const updateRewind = () => {
        const elapsed = time - rewindStart
        const t = elapsed / REWIND_SECONDS
        pieces.forEach(piece => {
            // Home is where the piece came from, moved by however far its list has scrolled since.
            const shift = anchorShift(piece.anchor)
            const home = { x: piece.origin.x + shift.x, y: piece.origin.y + shift.y, z: piece.origin.z }
            const pose = rewindPose(piece.snapshot, home, t)
            toWorld(piece.mesh, pose.x, pose.y, pose.z)
            piece.mesh.rotation.set(pose.rx, pose.ry, pose.rz)
            if (piece.restScale) {
                const k = Math.min(1, t)
                piece.mesh.scale.setScalar(piece.snapshotScale + (piece.restScale - piece.snapshotScale) * k)
            }
        })
        // The hero flies back up into the top bar it came from.
        const home = from || { x: viewport.width / 2, y: -80 }
        const heroT = Math.min(1, t)
        toWorldOnScreen(
            character.root,
            hero.x + (home.x - hero.x) * heroT,
            hero.y + (home.y - hero.y) * heroT,
            CHARACTER_Z
        )
        character.root.scale.setScalar(CHARACTER_SCALE * (1 - heroT * 0.85))

        if (t >= 1) {
            const fade = Math.min(1, (elapsed - REWIND_SECONDS) / HOLE_FADE_SECONDS)
            // Once every piece is home the holes are redundant; drop the pieces and fade the rest.
            pieces.forEach(piece => {
                piece.mesh.visible = fade < 0.02
            })
            fadingMaterials.forEach(material => {
                material.opacity = 1 - fade
            })
            if (fade >= 1) finish()
        }
    }

    /* Weapons you own, and the shop. */
    const equip = id => {
        if (!owned.has(id)) return
        equipped = id
        writeStoredWeapon(id)
        fireCooldown = 0
        hud.dataset.weapon = id
        renderWeaponBar()
        if (shopUi.isOpen()) shopUi.render()
    }

    const renderWeaponBar = () => {
        ui.weaponBar.textContent = ''
        RAGE_WEAPONS.forEach((weapon, index) => {
            if (!owned.has(weapon.id)) return
            const chip = document.createElement('button')
            chip.type = 'button'
            chip.setAttribute('data-weapon', weapon.id)
            const label = strings.weapons && strings.weapons[weapon.id] ? strings.weapons[weapon.id].name : weapon.id
            chip.title = `${label} (${index + 1})`
            chip.setAttribute('aria-label', chip.title)
            chip.textContent = `${weapon.icon}`
            Object.assign(chip.style, {
                position: 'relative',
                border: 'none',
                borderRadius: '13px',
                width: '38px',
                height: '34px',
                fontSize: '18px',
                cursor: 'pointer',
                background: weapon.id === equipped ? '#FFAE47' : 'rgba(255,255,255,0.12)',
            })
            chip.addEventListener('pointerdown', event => event.stopPropagation())
            chip.addEventListener('click', event => {
                event.stopPropagation()
                equip(weapon.id)
            })
            ui.weaponBar.appendChild(chip)
        })
        const auto = document.createElement('button')
        auto.type = 'button'
        auto.textContent = '⟳'
        auto.title = `${strings.autoFire} (Space)`
        auto.setAttribute('aria-label', strings.autoFire)
        auto.setAttribute('aria-pressed', autoFire ? 'true' : 'false')
        auto.setAttribute('data-auto-fire', autoFire ? 'on' : 'off')
        Object.assign(auto.style, {
            border: 'none',
            borderRadius: '13px',
            width: '38px',
            height: '34px',
            fontSize: '18px',
            fontWeight: '700',
            cursor: 'pointer',
            color: autoFire ? '#091540' : '#FFFFFF',
            background: autoFire ? '#9CF0C8' : 'rgba(255,255,255,0.12)',
        })
        auto.addEventListener('pointerdown', event => event.stopPropagation())
        auto.addEventListener('click', event => {
            event.stopPropagation()
            toggleAutoFire()
        })
        ui.weaponBar.appendChild(auto)
        const more = document.createElement('button')
        more.type = 'button'
        more.textContent = '🛒'
        more.title = strings.shop
        more.setAttribute('aria-label', strings.shop)
        Object.assign(more.style, {
            border: 'none',
            borderRadius: '13px',
            width: '38px',
            height: '34px',
            fontSize: '16px',
            cursor: 'pointer',
            background: 'rgba(255,255,255,0.12)',
        })
        more.addEventListener('pointerdown', event => event.stopPropagation())
        more.addEventListener('click', event => {
            event.stopPropagation()
            openShop()
        })
        ui.weaponBar.appendChild(more)
    }

    const setAutoFire = on => {
        autoFire = on
        hud.dataset.autoFire = on ? 'on' : 'off'
        renderWeaponBar()
    }
    const toggleAutoFire = () => {
        if (phase !== 'playing') return
        setAutoFire(!autoFire)
        showToast(autoFire ? `⟳ ${strings.autoFireOn}` : strings.autoFireOff, 1.1)
    }

    let shopPending = null
    let shopConfirm = null
    let shopMessage = null
    const currentGold = () => {
        if (knownGold !== null) return knownGold
        const gold = services.getGold ? services.getGold() : null
        return typeof gold === 'number' ? gold : null
    }
    const shopUi = buildShop({
        strings,
        weapons: RAGE_WEAPONS,
        zIndex: Z_INDEX + 4,
        getState: () => ({
            owned,
            equipped,
            gold: currentGold(),
            pending: shopPending,
            confirm: shopConfirm,
            message: shopMessage,
        }),
        onBuy: id => {
            shopConfirm = id
            shopMessage = null
            shopUi.render()
        },
        onConfirm: id => buy(id),
        onCancel: () => {
            shopConfirm = null
            shopUi.render()
        },
        onEquip: id => equip(id),
        onClose: () => closeShop(),
    })

    // Buying goes to the server, which charges the Gold and records the weapon (see
    // functions/RageMode/rageModeProfile.js). Nothing is granted here until it says so.
    const buy = id => {
        shopConfirm = null
        if (!services.purchase) {
            shopMessage = { id, text: strings.shopUnavailable, tone: 'error' }
            shopUi.render()
            return
        }
        shopPending = id
        shopMessage = null
        shopUi.render()
        Promise.resolve()
            .then(() => services.purchase(id))
            .then(result => {
                if (result && result.ok) {
                    owned = new Set([RAGE_DEFAULT_WEAPON, ...(result.owned || []), id])
                    if (typeof result.newBalance === 'number') knownGold = result.newBalance
                    shopMessage = { id, text: strings.bought, tone: 'ok' }
                    equip(id)
                    sound.boom(0.5)
                } else {
                    if (result && typeof result.currentGold === 'number') knownGold = result.currentGold
                    const text =
                        result && result.reason === 'insufficient_gold' ? strings.notEnoughGold : strings.purchaseFailed
                    shopMessage = { id, text, tone: 'error' }
                }
            })
            .catch(error => {
                shopMessage = {
                    id,
                    text: error && error.code === 'offline' ? strings.offline : strings.purchaseFailed,
                    tone: 'error',
                }
            })
            .finally(() => {
                shopPending = null
                if (!finished) shopUi.render()
            })
    }

    const openShop = () => {
        if (phase !== 'playing' || shopUi.isOpen()) return
        paused = true
        pointerFiring = false
        pendingShot = false
        shopConfirm = null
        shopMessage = null
        shopUi.open()
        hud.dataset.shop = 'open'
    }
    const closeShop = () => {
        if (!shopUi.isOpen()) return
        paused = false
        shopUi.close()
        delete hud.dataset.shop
    }

    /* Game over, and another go. */
    const gameOverUi = buildGameOver(
        strings,
        () => playAgain(),
        () => beginRewind()
    )
    document.body.append(shopUi.element, gameOverUi.element)

    // A finished game's score goes to the server once, which keeps the best one.
    const submitScore = () => {
        if (scoreSubmitted) return
        scoreSubmitted = true
        const final = score
        const wasNew = final > best
        best = Math.max(best, final)
        if (final <= 0 || !services.submitScore) return wasNew
        Promise.resolve()
            .then(() => services.submitScore(final))
            .then(result => {
                if (!result || !result.ok) return
                best = Math.max(best, result.highscore || 0)
                if (!finished) {
                    gameOverUi.update({ best, isNew: !!result.isNew })
                    updateCounter()
                }
            })
            .catch(() => {})
        return wasNew
    }

    let lastRoundNew = false
    const gameOver = () => {
        phase = 'gameover'
        gameOverAt = time
        gameOverShown = false
        pointerFiring = false
        pendingShot = false
        setAutoFire(false)
        closeShop()
        if (greeting) {
            greeting = null
            removeBubble()
            resetRig()
            delete hud.dataset.greeting
        }
        hud.dataset.gameOver = '1'
        hero.vy = -300
        sound.boom(1.4)
        lastRoundNew = submitScore()
    }

    const updateGameOver = dt => {
        // She tumbles out of the sky; the page carries on without her.
        hero.vy += 1500 * dt
        hero.y = Math.min(viewport.height - 30, hero.y + hero.vy * dt)
        character.root.visible = true
        toWorldOnScreen(character.root, hero.x, hero.y, CHARACTER_Z)
        character.root.rotation.z += dt * 6
        updateSnakes(dt, false)
        updateBoss(dt, false)
        updateOrbs(dt, false)
        updatePieces(dt)
        if (!gameOverShown && time - gameOverAt > 0.9) {
            gameOverShown = true
            gameOverUi.show({ score, best: Math.max(best, score), isNew: lastRoundNew })
        }
    }

    const playAgain = () => {
        gameOverUi.hide()
        // Whatever is left of the last round drops to the floor (and still flies home on exit).
        snakes
            .splice(0)
            .forEach(entry =>
                entry.segments.forEach(segment => segmentToPiece(segment, segment.pos || segment.origin, 0.4))
            )
        hud.dataset.snakes = '0'
        removeBoss()
        flames.splice(0).forEach(flame => {
            scene.remove(flame.mesh)
            flame.material.dispose()
        })
        health = createHealth()
        updateHealth()
        score = 0
        playTime = tuning.bossHeadStart || 0
        snakesKilled = 0
        bossSummoned = false
        scoreSubmitted = false
        updateCounter()
        hero.x = viewport.width / 2
        hero.y = viewport.height * 0.42
        hero.vx = 0
        hero.vy = 0
        resetRig()
        character.root.visible = true
        delete hud.dataset.gameOver
        snakeTimer = SNAKE_FIRST_DELAY
        entering = 0.35
        phase = 'playing'
    }

    // What the player owns and their best score come from the server; until then: the blaster.
    renderWeaponBar()
    hud.dataset.weapon = equipped
    if (services.loadProfile) {
        Promise.resolve()
            .then(() => services.loadProfile())
            .then(profile => {
                if (!profile || finished) return
                owned = new Set([RAGE_DEFAULT_WEAPON, ...(Array.isArray(profile.owned) ? profile.owned : [])])
                best = Math.max(best, Number(profile.highscore) || 0)
                if (preferredWeapon && owned.has(preferredWeapon)) equip(preferredWeapon)
                else renderWeaponBar()
                updateCounter()
                if (shopUi.isOpen()) shopUi.render()
            })
            .catch(() => {})
    } else if (preferredWeapon && owned.has(preferredWeapon)) equip(preferredWeapon)

    /* Loop. */
    let frameId = 0
    let lastTimestamp = 0
    const frame = timestamp => {
        // A cancelled callback can still be delivered after teardown. It belongs to this arena,
        // never to a later one, and must not touch disposed meshes or restart the frame loop.
        if (finished) return
        frameId = 0
        const dt = lastTimestamp ? Math.min(0.05, (timestamp - lastTimestamp) / 1000) : 1 / 60
        lastTimestamp = timestamp
        time += dt
        if (phase === 'playing') {
            // The shop pauses the game: nothing moves, nothing can hurt her while she browses.
            if (!paused) {
                playTime += dt
                updateHero(dt)
                // She blinks while she cannot be hit again.
                character.root.visible = !isBlinking(health, time) || Math.floor(time * 14) % 2 === 0
                fireCooldown -= dt
                const weapon = weaponById(equipped)
                const wantsFire = pointerFiring || pendingShot || autoFire
                if (weapon.kind === 'laser') pendingShot = false
                else if (wantsFire && !greeting && entering <= 0 && fireCooldown <= 0) {
                    fire()
                    pendingShot = false
                    fireCooldown = weapon.interval
                }
                maybeSummonBoss()
                updateSnakes(dt)
                updateBolts(dt)
                updateFlames(dt)
                updateLaser(dt)
                updateBlackholes(dt)
                updateBoss(dt)
                updateOrbs(dt)
                updatePieces(dt)
            }
        } else if (phase === 'gameover') {
            updateGameOver(dt)
        } else {
            updateRewind()
        }
        // updateRewind may finish and dispose the renderer on this very frame.
        if (finished) return
        updateEffects(dt)
        updateBossDebris(dt)
        updateAnchors()
        updateCamera(dt)
        renderer.render(scene, camera)
        if (phase !== 'done') frameId = requestAnimationFrame(frame)
    }
    frameId = requestAnimationFrame(frame)

    /* Input. */
    const setAimFromEvent = event => {
        aim.x = event.clientX
        aim.y = event.clientY
    }
    const onPointerDown = event => {
        event.preventDefault()
        event.stopPropagation()
        if (phase !== 'playing' || paused) return
        sound.unlock()
        setAimFromEvent(event)
        touchSeek = event.pointerType === 'touch'
        // During a greeting a finger still steers her, but nothing is fired.
        if (!greeting) {
            pointerFiring = true
            pendingShot = true
        }
        if (inputLayer.setPointerCapture) {
            try {
                inputLayer.setPointerCapture(event.pointerId)
            } catch (error) {
                // A synthetic pointer id cannot be captured; aiming still works without it.
            }
        }
    }
    const onPointerMove = event => {
        event.preventDefault()
        setAimFromEvent(event)
    }
    const onPointerUp = event => {
        event.preventDefault()
        event.stopPropagation()
        pointerFiring = false
        if (event.pointerType === 'touch') touchSeek = false
    }
    const swallow = event => {
        event.preventDefault()
        event.stopPropagation()
    }
    const onKey = event => {
        const down = event.type === 'keydown'
        if (isBrowserShortcut(event)) {
            // Let Cmd+R, Ctrl+W & co. work, but keep the app's own shortcuts out of it.
            event.stopImmediatePropagation()
            return
        }
        event.preventDefault()
        event.stopImmediatePropagation()
        if (down && event.key === 'Escape') {
            // Escape closes the shop first; only then does it leave rage mode.
            if (shopUi.isOpen()) closeShop()
            else beginRewind()
            return
        }
        if (shopUi.isOpen() || phase !== 'playing') return
        if (event.code === 'Space') {
            if (down && !event.repeat) toggleAutoFire()
            return
        }
        if (event.key === 'Enter') {
            if (down && !event.repeat) startGreeting()
            return
        }
        if (down && event.code === 'KeyB') {
            openShop()
            return
        }
        const digit = /^Digit([1-9])$/.exec(event.code)
        if (down && digit) {
            const weapon = RAGE_WEAPONS[Number(digit[1]) - 1]
            if (weapon) equip(weapon.id)
            return
        }
        const direction = directionForKey(event.code)
        if (!direction) return
        if (down) held.add(direction)
        else held.delete(direction)
    }
    // The wheel / trackpad scrolls whatever is under the pointer, as it would without the arena.
    const onWheel = event => {
        event.preventDefault()
        event.stopPropagation()
        const container = scrollContainerAt(event.clientX, event.clientY, inputLayer)
        if (!container) return
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1
        container.scrollTop += event.deltaY * unit
        container.scrollLeft += event.deltaX * unit
    }
    const onBlur = () => {
        held.clear()
        pointerFiring = false
        touchSeek = false
    }
    const onResize = () => {
        // Every piece and hole is anchored to where the page WAS laid out; after a resize the page
        // has moved under them, so the damage is repaired at once rather than left floating.
        pieces.splice(0).forEach(piece => {
            scene.remove(piece.mesh)
            if (piece.ownGeometry) piece.mesh.geometry.dispose()
        })
        snakes.splice(0).forEach(entry => entry.segments.forEach(segment => scene.remove(segment.mesh)))
        hud.dataset.snakes = '0'
        coveredRows.splice(0)
        anchors.clear()
        scorchMeshes.splice(0)
        holes.clear()
        scorches.clear()
        destroyedGlyphs.clear()
        destroyedBlocks = new WeakSet()
        resizeCamera()
        centreOverlays()
    }
    // No visibility listener of our own (the app's resume signals have one owner, utils/appResume.js):
    // the browser already stops requestAnimationFrame in a hidden tab, `frame` clamps the gap it
    // leaves to one 50ms step, and `blur` releases every held key and button.

    inputLayer.addEventListener('pointerdown', onPointerDown)
    inputLayer.addEventListener('pointermove', onPointerMove)
    inputLayer.addEventListener('pointerup', onPointerUp)
    inputLayer.addEventListener('pointercancel', onPointerUp)
    inputLayer.addEventListener('contextmenu', swallow)
    inputLayer.addEventListener('wheel', onWheel, { passive: false })
    inputLayer.addEventListener('touchstart', swallow, { passive: false })
    inputLayer.addEventListener('click', swallow)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onResize)

    const stopHudEvent = event => event.stopPropagation()
    ;[ui.shop, greet, mute, exit].forEach(button => {
        button.addEventListener('pointerdown', stopHudEvent)
    })
    ui.shop.addEventListener('click', event => {
        event.stopPropagation()
        if (shopUi.isOpen()) closeShop()
        else openShop()
    })
    greet.addEventListener('click', event => {
        event.stopPropagation()
        startGreeting()
    })
    mute.addEventListener('click', event => {
        event.stopPropagation()
        sound.muted = !sound.muted
        writeMuted(sound.muted)
        mute.textContent = sound.muted ? '🔇' : '🔊'
        mute.title = sound.muted ? strings.unmute : strings.mute
        mute.setAttribute('aria-label', mute.title)
    })
    exit.addEventListener('click', event => {
        event.stopPropagation()
        beginRewind()
    })

    /* Teardown. */
    function finish() {
        if (finished) return
        finished = true
        phase = 'done'
        if (frameId) cancelAnimationFrame(frameId)
        cancelAnimationFrame(entranceFrameId)
        clearTimeout(helpTimer)
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('keyup', onKey, true)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('resize', onResize)
        clearTimeout(toastTimer)
        clearTimeout(hurtTimer)
        ;[
            inputLayer,
            canvas,
            hud,
            help,
            ui.weaponBar,
            ui.bossBar,
            ui.toast,
            shopUi.element,
            gameOverUi.element,
        ].forEach(node => {
            if (node.parentNode) node.parentNode.removeChild(node)
        })
        removeBoss()
        if (bossDebris) {
            bossDebris.model.dispose()
            bossDebris = null
        }
        flames.forEach(flame => flame.material.dispose())
        blackholes.forEach(hole => {
            hole.material.dispose()
            hole.ringMaterial.dispose()
        })
        pieces.forEach(piece => {
            if (piece.ownGeometry) piece.mesh.geometry.dispose()
        })
        anchors.forEach(anchor => anchor.scorchMaterial && anchor.scorchMaterial.dispose())
        tileTextureCache.clear()
        effects.forEach(effect => effect.material && effect.material.dispose())
        bolts.slice().forEach(removeBolt)
        character.root.traverse(node => {
            if (node.geometry) node.geometry.dispose()
            if (node.material && node.material.dispose) node.material.dispose()
        })
        holeMaterials.forEach(material => material.dispose())
        edgeMaterials.forEach(material => material.dispose())
        if (scorchMaterial.map) scorchMaterial.map.dispose()
        disposables.forEach(resource => resource.dispose && resource.dispose())
        glyphTextureCache.clear()
        removeBubble()
        renderer.dispose()
        sound.close()
        activeArena = null
        if (onExit) onExit()
    }

    activeArena = {
        /** Rewind and close; `{ immediate: true }` skips the rewind (e.g. the app is navigating away). */
        stop({ immediate = false } = {}) {
            if (immediate) finish()
            else beginRewind()
        },
    }
    return activeArena
}
