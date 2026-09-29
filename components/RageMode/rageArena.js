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
    PlaneGeometry,
    Scene,
    SRGBColorSpace,
    WebGLRenderer,
} from 'three'

import { createRandom, launchVelocity, MAX_Z, rewindPose, shatterRect, stepDebris } from './rageDebris'
import {
    aimAngle,
    BOLT_SPEED,
    directionForKey,
    FIRE_INTERVAL,
    isBrowserShortcut,
    moveVector,
    stepCharacter,
    touchHoverTarget,
} from './rageControls'
import { RAGE_LAYER_ATTRIBUTE, resolveHit, withLayerTransparent } from './rageTargets'
import { greetingPose, pickGreetingStyle } from './rageGreeting'

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

const buildHud = (strings, touch, muted, narrow) => {
    const hud = document.createElement('div')
    hud.setAttribute(RAGE_LAYER_ATTRIBUTE, 'hud')
    Object.assign(hud.style, {
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: String(Z_INDEX + 2),
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '5px 5px 5px 14px',
        borderRadius: '20px',
        background: '#091540',
        boxShadow: '0 6px 24px rgba(9,21,64,0.35)',
        color: '#fff',
        font: '600 13px Roboto, system-ui, sans-serif',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        pointerEvents: 'none',
    })
    const title = document.createElement('span')
    // On a phone the pill has to fit between the screen edges with the counter and two buttons.
    title.textContent = narrow ? '🔥' : `🔥 ${strings.title}`
    title.style.letterSpacing = '0.04em'
    title.style.textTransform = 'uppercase'
    const counter = document.createElement('span')
    Object.assign(counter.style, {
        fontVariantNumeric: 'tabular-nums',
        color: '#FFCE8F',
        minWidth: '24px',
    })
    const hint = document.createElement('span')
    hint.textContent = strings.exitHint
    Object.assign(hint.style, { color: 'rgba(255,255,255,0.6)', fontWeight: '400' })
    if (touch) hint.style.display = 'none'
    const greet = hudButton(strings.greet, '👋')
    const mute = hudButton(muted ? strings.unmute : strings.mute, muted ? '🔇' : '🔊')
    const exit = hudButton(strings.exit, '✕')
    hud.append(title, counter, hint, greet, mute, exit)

    const help = document.createElement('div')
    help.setAttribute(RAGE_LAYER_ATTRIBUTE, 'help')
    help.textContent = touch ? strings.touchHelp : strings.desktopHelp
    Object.assign(help.style, {
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: String(Z_INDEX + 2),
        padding: '8px 16px',
        borderRadius: '16px',
        background: 'rgba(9,21,64,0.8)',
        color: '#fff',
        font: '400 13px Roboto, system-ui, sans-serif',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        transition: 'opacity 600ms ease',
    })
    return { hud, counter, greet, mute, exit, help }
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
 */
export function startRageArena({ strings, from, onExit }) {
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
    const holeMaterials = new Map()
    const holeMaterial = css => {
        if (!holeMaterials.has(css)) {
            holeMaterials.set(
                css,
                new MeshBasicMaterial({ color: opaqueColor(css), transparent: true, depthWrite: false })
            )
        }
        return holeMaterials.get(css)
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
    let rewindStart = 0

    const bolts = []
    const pieces = []
    const effects = []
    const destroyedGlyphs = new Map()
    let destroyedBlocks = new WeakSet()

    const sound = createSound()
    sound.unlock()
    const { hud, counter, greet, mute, exit, help } = buildHud(
        strings,
        touchDevice,
        sound.muted,
        viewport.width < NARROW_HUD_WIDTH
    )
    const updateCounter = () => {
        counter.textContent = `${destroyedCount} ${strings.destroyed}`
    }
    updateCounter()

    document.body.append(inputLayer, canvas, hud, help)
    requestAnimationFrame(() => {
        inputLayer.style.boxShadow = 'inset 0 0 90px rgba(224,0,0,0.14)'
    })
    const helpTimer = setTimeout(() => {
        help.style.opacity = '0'
    }, 4500)

    /* Spawning. */
    const addPiece = (mesh, rect, impact, power, kind) => {
        const origin = { x: rect.x, y: rect.y, z: PIECE_START_Z }
        const velocity = launchVelocity(origin, impact, random, power)
        const piece = {
            mesh,
            kind,
            origin,
            x: origin.x,
            y: origin.y,
            z: origin.z,
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
            if (old.kind !== 'glyph') old.mesh.geometry.dispose()
        }
    }

    const addHole = (rect, background, pad = 1) => {
        const mesh = new Mesh(unitPlane, holeMaterial(background))
        mesh.scale.set(rect.width + pad * 2, rect.height + pad * 2, 1)
        toWorld(mesh, rect.left + rect.width / 2, rect.top + rect.height / 2, 0)
        mesh.renderOrder = 1
        holes.add(mesh)
    }

    const addScorch = (x, y, size) => {
        const mesh = new Mesh(unitPlane, scorchMaterial)
        mesh.scale.set(size, size, 1)
        mesh.rotation.z = random() * Math.PI * 2
        toWorld(mesh, x, y, 0.5)
        mesh.renderOrder = 2
        scorches.add(mesh)
        while (scorches.children.length > MAX_SCORCH) scorches.remove(scorches.children[0])
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
        hit.glyphs.forEach(glyph => {
            gone.add(glyph.index)
            addHole(glyph.rect, hit.background, 1)
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
        addHole(hit.rect, hit.background, 0)
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
                { x: hit.rect.left + shard.centroid.x, y: hit.rect.top + shard.centroid.y, halfHeight: spanY },
                impact,
                power * 0.9,
                'shard'
            )
        })
        destroyedCount += 1
        addScorch(hit.rect.left + width / 2, hit.rect.top + height / 2, Math.min(140, Math.max(width, height) * 0.9))
    }

    const impactAt = (x, y, hit) => {
        const power = 1
        if (hit.kind === 'text') knockOutText(hit, { x, y }, power)
        else shatterBlock(hit, { x, y }, power)
        addScorch(x, y, 34 + random() * 22)
        addFlash(x, y, 70)
        addSparks(x, y, 7)
        shake = Math.min(9, shake + (hit.kind === 'text' ? 2.2 : 4.5))
        sound.boom(hit.kind === 'text' ? 0.8 : 1.2)
        updateCounter()
    }

    /* Firing. */
    const muzzle = () => {
        const angle = aimAngle({ x: hero.x, y: hero.y - 6 }, aim)
        const reach = 36 * CHARACTER_SCALE
        return { x: hero.x + Math.cos(angle) * reach, y: hero.y - 6 + Math.sin(angle) * reach, angle }
    }

    const fire = () => {
        const { x, y, angle } = muzzle()
        const mesh = new Mesh(boltGeometry, boltMaterial)
        mesh.rotation.z = -angle
        mesh.renderOrder = 4
        toWorldOnScreen(mesh, x, y, BOLT_Z)
        const glow = new Mesh(
            unitPlane,
            new MeshBasicMaterial({
                map: glowTexture,
                transparent: true,
                blending: AdditiveBlending,
                depthWrite: false,
            })
        )
        glow.scale.set(34, 34, 1)
        glow.position.z = -2
        mesh.add(glow)
        scene.add(mesh)
        bolts.push({ x, y, dx: Math.cos(angle), dy: Math.sin(angle), age: 0, mesh, glow })
        addFlash(x, y, 34, 0.08)
        sound.pew()
    }

    const removeBolt = index => {
        const bolt = bolts[index]
        scene.remove(bolt.mesh)
        bolt.glow.material.dispose()
        bolts.splice(index, 1)
    }

    const updateBolts = dt => {
        if (!bolts.length) return
        // All hit tests of a frame share one pass with the input layer switched off (see
        // `withLayerTransparent`); nothing can dispatch an event to the page in between.
        withLayerTransparent(inputLayer, () => {
            for (let i = bolts.length - 1; i >= 0; i--) {
                const bolt = bolts[i]
                bolt.age += dt
                const step = (BOLT_SPEED * dt) / BOLT_SAMPLES
                let hitSomething = false
                for (let s = 0; s < BOLT_SAMPLES && !hitSomething; s++) {
                    bolt.x += bolt.dx * step
                    bolt.y += bolt.dy * step
                    // The first few pixels are inside the character's own gun.
                    if (bolt.age < 0.02) continue
                    const hit = resolveHit({
                        x: bolt.x,
                        y: bolt.y,
                        radius: BOLT_HIT_RADIUS,
                        layer: null,
                        destroyedGlyphs,
                        destroyedBlocks,
                        viewport,
                    })
                    if (hit) {
                        impactAt(bolt.x, bolt.y, hit)
                        hitSomething = true
                    }
                }
                const offScreen =
                    bolt.x < -40 || bolt.y < -40 || bolt.x > viewport.width + 40 || bolt.y > viewport.height + 40
                if (hitSomething || offScreen || bolt.age > 2) removeBolt(i)
                else toWorldOnScreen(bolt.mesh, bolt.x, bolt.y, BOLT_Z)
            }
        })
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
        if (phase !== 'playing') return
        phase = 'rewinding'
        rewindStart = time
        pointerFiring = false
        held.clear()
        if (greeting) {
            greeting = null
            removeBubble()
            resetRig()
        }
        pieces.forEach(piece => {
            piece.snapshot = { x: piece.x, y: piece.y, z: piece.z, rx: piece.rx, ry: piece.ry, rz: piece.rz }
        })
        bolts.slice().forEach((bolt, index) => removeBolt(bolts.length - 1 - index))
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
            const pose = rewindPose(piece.snapshot, piece.origin, t)
            toWorld(piece.mesh, pose.x, pose.y, pose.z)
            piece.mesh.rotation.set(pose.rx, pose.ry, pose.rz)
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
            holeMaterials.forEach(material => {
                material.opacity = 1 - fade
            })
            scorchMaterial.opacity = 1 - fade
            if (fade >= 1) finish()
        }
    }

    /* Loop. */
    let frameId = 0
    let lastTimestamp = 0
    const frame = timestamp => {
        frameId = 0
        const dt = lastTimestamp ? Math.min(0.05, (timestamp - lastTimestamp) / 1000) : 1 / 60
        lastTimestamp = timestamp
        time += dt
        if (phase === 'playing') {
            updateHero(dt)
            fireCooldown -= dt
            const wantsFire = pointerFiring || pendingShot
            if (wantsFire && !greeting && entering <= 0 && fireCooldown <= 0) {
                fire()
                pendingShot = false
                fireCooldown = FIRE_INTERVAL
            }
            updateBolts(dt)
            updatePieces(dt)
        } else {
            updateRewind()
        }
        updateEffects(dt)
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
            beginRewind()
            return
        }
        if (event.code === 'Space') {
            if (down && !event.repeat) startGreeting()
            return
        }
        const direction = directionForKey(event.code)
        if (!direction) return
        if (down) held.add(direction)
        else held.delete(direction)
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
            if (piece.kind !== 'glyph') piece.mesh.geometry.dispose()
        })
        holes.clear()
        scorches.clear()
        destroyedGlyphs.clear()
        destroyedBlocks = new WeakSet()
        resizeCamera()
    }
    // No visibility listener of our own (the app's resume signals have one owner, utils/appResume.js):
    // the browser already stops requestAnimationFrame in a hidden tab, `frame` clamps the gap it
    // leaves to one 50ms step, and `blur` releases every held key and button.

    inputLayer.addEventListener('pointerdown', onPointerDown)
    inputLayer.addEventListener('pointermove', onPointerMove)
    inputLayer.addEventListener('pointerup', onPointerUp)
    inputLayer.addEventListener('pointercancel', onPointerUp)
    inputLayer.addEventListener('contextmenu', swallow)
    inputLayer.addEventListener('wheel', swallow, { passive: false })
    inputLayer.addEventListener('touchstart', swallow, { passive: false })
    inputLayer.addEventListener('click', swallow)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onResize)

    const stopHudEvent = event => event.stopPropagation()
    ;[greet, mute, exit].forEach(button => {
        button.addEventListener('pointerdown', stopHudEvent)
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
    let finished = false
    function finish() {
        if (finished) return
        finished = true
        phase = 'done'
        if (frameId) cancelAnimationFrame(frameId)
        clearTimeout(helpTimer)
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('keyup', onKey, true)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('resize', onResize)
        ;[inputLayer, canvas, hud, help].forEach(node => {
            if (node.parentNode) node.parentNode.removeChild(node)
        })
        pieces.forEach(piece => {
            if (piece.kind !== 'glyph') piece.mesh.geometry.dispose()
        })
        effects.forEach(effect => effect.material && effect.material.dispose())
        bolts.forEach(bolt => bolt.glow.material.dispose())
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
