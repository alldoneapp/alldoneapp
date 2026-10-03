import {
    BoxGeometry,
    BufferGeometry,
    CanvasTexture,
    Color,
    ConeGeometry,
    CylinderGeometry,
    DirectionalLight,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    HemisphereLight,
    IcosahedronGeometry,
    InstancedMesh,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Object3D,
    OrthographicCamera,
    PCFSoftShadowMap,
    Plane,
    PlaneGeometry,
    RingGeometry,
    Scene,
    ShadowMaterial,
    SphereGeometry,
    SRGBColorSpace,
    Vector3,
    WebGLRenderer,
} from 'three'

import { createRandom, shatterRect } from './rageDebris'
import { directionForKey, dragShip, isBrowserShortcut, moveVector, stepShip } from './raidControls'
import { glyphStyle, RAGE_LAYER_ATTRIBUTE, resolveBackgroundColor, TASK_ROW_SELECTOR } from './rageTargets'
import { RAGE_DEFAULT_WEAPON, RAGE_WEAPONS, weaponById } from './rageWeapons'
import {
    applyDamage,
    buyHangarItem,
    completeMission,
    createRun,
    DAMAGE,
    isBlinking,
    missionDifficulty,
    recordKill,
    registerKill,
    currentCombo,
    comboMultiplier,
    startNextMission,
    useBomb,
} from './raidRun'
import {
    createEnemy,
    damageEnemy,
    DEFAULT_TINT,
    ENEMY_TYPES,
    expandWave,
    MINE_FUSE_SECONDS,
    MINE_TRIGGER_RADIUS,
    mineBurst,
    splitSpecs,
    stepAirEnemy,
    stepBullet,
    stepEnemyFire,
} from './raidEnemies'
import {
    activeBuffs,
    collectPickup,
    createBuffs,
    enemyTimeScale,
    fireIntervalFactor,
    isActive,
    MAGNET_RADIUS,
    PICKUP_TYPES,
    rollDrops,
} from './raidPickups'
import {
    buildMission,
    CHUNK_HEIGHT,
    daySeed,
    RIVER_HALF_WIDTH,
    riverX,
    ROAD_HALF_WIDTH,
    roadX,
    SCROLL_SPEED,
    terrainChunk,
} from './raidLevel'
import { MAIN_GUN_DAMAGE, MAIN_GUN_SPEED, mainGun, nearestAhead, specialAngles, steerTowards, UP } from './raidArmory'
import {
    beamHits,
    BEAM_WARN,
    bossKindFor,
    COLUMN_WIDTH,
    createBeam,
    createRaidBoss,
    createWave,
    damageRaidBoss,
    displayedCount,
    insideRaidBoss,
    ORB_RADIUS,
    stepBeam,
    stepRaidBoss,
    stepWave,
    SWEEP_WIDTH,
    WAVE_GAP,
    WAVE_THICKNESS,
    waveHits,
} from './raidBosses'
import { BOSS_HP } from './rageBoss'
import { buildRaidBossModel, DISC_TEXTURE_TURN } from './raidBossModels'
import { buildCharacter } from './rageModels'
import { createSound, writeMuted } from './rageSound'
import { buildRaidHud, NARROW_HUD_WIDTH, visibleWidth } from './raidHud'
import {
    checkpointFromRun,
    readRecord,
    reconcile,
    runFromCheckpoint,
    sanitizeRecord,
    writeRecord,
} from './raidProgress'
import { GREETING_TIMING, greetingPose, pickGreetingStyle } from './rageGreeting'
import { buildShop } from './rageShop'

/**
 * Rage mode, as a vertical-scrolling shooter in the tradition of the early-90s classics.
 *
 * THE TAKE-OFF. Anna launches from the page you are on. The app's root element slides down off the
 * screen while generated ground scrolls in above it, so for the first seconds the level IS your
 * page: the task rows on it carry little turrets and shoot back, and every one you destroy leaves a
 * hole where it was. After that the ground is generated from your day (`raidLevel.js`): today's
 * tasks are dug in as labelled bunkers, waves of fighters and incoming mail fly scripted paths, and
 * the mission ends with the boss built from today's open-task count. Between missions the hangar
 * sells repairs, bombs and upgrades for credits earned in the run (never Gold).
 *
 * THE PAGE IS NEVER CHANGED. Nothing in the app's DOM is added, removed or edited — React, Quill
 * and the React roots inside Quill embeds own those nodes (see `rageTargets.js`). The one thing the
 * arena touches is the INLINE STYLE of the root container (a `transform` while it slides away) and
 * `overflow` on <html> and <body> (so the moving page cannot grow a scrollbar). React never renders
 * those properties, and each is restored to exactly what it was on the way out. Holes and debris
 * are drawn on the arena's own canvas.
 *
 * THE CAMERA is orthographic and maps world units to CSS pixels one to one (screen y down, world y
 * up), so a hole drawn at a row's `getBoundingClientRect()` covers exactly that row. Ground objects
 * live in `ground`, a group that scrolls with the level: a point at ground distance `g` sits at
 * screen y = s − g, where `s` is how far the level has scrolled.
 *
 * THE SEAM. Above the page the ground exists; below it, it must not be drawn. One clipping plane,
 * shared by every ground material, cuts the ground at the page's top edge. Leaving puts the page
 * back by sliding it up again under the ground, which needs the same seam in reverse.
 *
 * THE INPUT. A transparent layer covers the viewport under the canvas, so no pointer event can reach
 * the app, and every key is swallowed in the window's capture phase, before the app's own
 * document-level listeners (including the escape stack). Browser shortcuts are left alone.
 */

const Z_INDEX = 2147482000
// Heights above the ground (world z). In an orthographic view they only decide what is drawn in
// front of what — except for shadows, which fall further away the higher something flies.
const Z = {
    page: 2,
    bunker: 7,
    cloud: 95,
    boss: 110,
    enemy: 120,
    playerShot: 140,
    shipGround: 18,
    ship: 150,
    enemyShot: 170,
    fx: 180,
    debris: 185,
    flash: 900,
}
// The sun: shadows fall down and to the right, a little further for every unit of height.
const SUN_DIRECTION = new Vector3(-0.3, 0.34, 1).normalize()
const TAKEOFF_SECONDS = 1.1
// The run-up on the page: she runs while the page starts to move, then the jetpack fires.
const RUNUP_MIN_SECONDS = 5
const RUNUP_MAX_SECONDS = 7
const RUNUP_SCROLL_FROM = 0.05
const RUNUP_SCROLL_TO = 0.75
// She lands low on the page and runs up it to where she will fly from.
const RUNUP_START_Y = 0.92
const FLY_Y = 0.8
// Mouse steering is relative to where she is when you take over; the gap between the (hidden)
// cursor and her closes as you move, fading by e every this many pixels of movement.
const STEER_OFFSET_FADE = 320
const LIFTOFF_SECONDS = 0.9
const RUN_TILT = 0.95
const RUN_SCALE = 0.86
const SCROLL_RAMP_SECONDS = 2.5
const CLOUD_COUNT = 4
const PAGE_CAP_EXTRA = 40
const RETURN_SECONDS = 1.15
const HOLE_FADE_SECONDS = 0.3
const MISSION_END_DELAY = 2.6
const SHIP_HIT_RADIUS = 11
const MUZZLE_OFFSET = 34
const MAX_SHOTS = 700
const MAX_ENEMY_SHOTS = 600
const MAX_PUFFS = 520
const MAX_SPARKS = 400
const MAX_DEBRIS = 260
const MAX_WRECKS = 40
const MAX_PICKUPS = 24
const PICKUP_COLLECT_RADIUS = 34
const PICKUP_LIFE = 14
const DRONE_ORBIT = 54
const DRONE_FIRE_INTERVAL = 0.24
// The cast that gets a "New:" announcement the first time it shows up in a run.
const INTRODUCED_TYPES = ['chat', 'ping', 'note', 'mine', 'meeting', 'deadline', 'carrier']
const MAX_PAGE_TURRETS = 8
const WEAPON_KEY = 'alldone.rageMode.weapon'
// Anna's height on screen at scale 1, for shrinking her into (and out of) the avatar she launches from.
const ANNA_HEIGHT = 70
// At the front of the greeting loop she is this much bigger: "towards the camera" for an
// orthographic camera, which has no perspective to do it for her.
const GREETING_GROW = 1.6
const BUBBLE_SCALE = 1.2
const START_OVER_CONFIRM_SECONDS = 3
const BUNKER_COLORS = ['#0C66FF', '#09A87A', '#7E57C2', '#E64A19', '#0097A7']

// Three seasons of ground, one per mission in turn. App colours, kept soft so the bright game
// pieces read on top of them.
const THEMES = [
    {
        ground: '#C8DFAE',
        fields: ['#B5D493', '#D3E6AC', '#A6C985', '#DDEBBE'],
        bank: '#B0CF95',
        water: '#78B4E6',
        road: '#ECE6D8',
        line: '#FFFFFF',
        trees: ['#5E9E52', '#4E8C46', '#6FAE5C'],
        roofs: ['#E57355', '#F2A65A', '#9AA7B8', '#C9605E'],
    },
    {
        ground: '#E9D9B4',
        fields: ['#E1C690', '#EEDFBB', '#D6B57A', '#F2E6CC'],
        bank: '#D9C597',
        water: '#6BAFD8',
        road: '#F6F1E6',
        line: '#FFFFFF',
        trees: ['#C9823B', '#B5652E', '#D9A441'],
        roofs: ['#8D6E63', '#E57355', '#607D8B', '#B0BEC5'],
    },
    {
        ground: '#E8EFF5',
        fields: ['#DCE6EF', '#F4F8FB', '#D0DDE8', '#FFFFFF'],
        bank: '#D5E1EB',
        water: '#5D9BCB',
        road: '#C9D3DD',
        line: '#F5F7FA',
        trees: ['#3F7F5B', '#336B4C', '#4C8D68'],
        roofs: ['#C9605E', '#5C6B85', '#8C95A8', '#E57355'],
    },
]

let activeArena = null

/** True while an arena is on screen. */
export const isRageArenaActive = () => !!activeArena

const toWorld = (object, x, y, z) => object.position.set(x, -y, z)
const easeInOut = k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2)
const clamp01 = k => Math.max(0, Math.min(1, k))

// three warns about (and ignores) an alpha channel in `rgba()`; every colour here is opaque.
const opaqueColor = css => {
    const match = /rgba?\(([^)]+)\)/.exec(css || '')
    if (!match) return new Color(css || '#ffffff')
    const [r, g, b] = match[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number)
    return new Color(`rgb(${r}, ${g}, ${b})`)
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

/**
 * Set CSS properties on an element for the duration of the game. The returned function puts back
 * exactly what was there — including removing a `style` attribute that did not exist before, so
 * the page's markup is byte-identical afterwards.
 */
const setTemporaryStyle = (element, properties) => {
    if (!element || !element.style) return () => {}
    const hadAttribute = element.hasAttribute('style')
    const previous = Object.keys(properties).map(name => [
        name,
        element.style.getPropertyValue(name),
        element.style.getPropertyPriority(name),
    ])
    Object.entries(properties).forEach(([name, value]) => element.style.setProperty(name, value))
    return () => {
        previous.forEach(([name, value, priority]) => {
            if (value) element.style.setProperty(name, value, priority)
            else element.style.removeProperty(name)
        })
        if (!hadAttribute && !element.getAttribute('style')) element.removeAttribute('style')
    }
}

/* ------------------------------------------------------------------------------------------------ */
/* Textures                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

const canvasTexture = (width, height, draw) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context) draw(context, width, height)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return texture
}

const roundedRect = (context, x, y, w, h, r) => {
    context.beginPath()
    context.moveTo(x + r, y)
    context.arcTo(x + w, y, x + w, y + h, r)
    context.arcTo(x + w, y + h, x, y + h, r)
    context.arcTo(x, y + h, x, y, r)
    context.arcTo(x, y, x + w, y, r)
    context.closePath()
}

// A soft-edged opaque disc: fire, smoke and flame particles are tinted copies of it. Opaque rather
// than additive, because additive glow disappears on a light background.
const puffTexture = () =>
    canvasTexture(64, 64, (context, w) => {
        const gradient = context.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
        gradient.addColorStop(0, 'rgba(255,255,255,1)')
        gradient.addColorStop(0.62, 'rgba(255,255,255,0.95)')
        gradient.addColorStop(1, 'rgba(255,255,255,0)')
        context.fillStyle = gradient
        context.fillRect(0, 0, w, w)
    })

// Anna's shot: an orange capsule with a dark rim, readable on light ground and dark water alike.
const boltTexture = () =>
    canvasTexture(16, 48, (context, w, h) => {
        context.fillStyle = '#9A4A00'
        roundedRect(context, 1, 1, w - 2, h - 2, 7)
        context.fill()
        context.fillStyle = '#FFAE47'
        roundedRect(context, 3, 3, w - 6, h - 6, 5)
        context.fill()
        context.fillStyle = '#FFF4D6'
        roundedRect(context, 6, 6, w - 12, h * 0.45, 3)
        context.fill()
    })

// Enemy fire: a red ring around a white core, the colour of danger in every shooter.
// Enemy fire: a soft disc, tinted per enemy (red by default, blue chat, purple meetings…), with a
// separate white core drawn over it so every shot reads as a glowing ball whatever its colour.
const orbTexture = () =>
    canvasTexture(48, 48, (context, w) => {
        context.fillStyle = 'rgba(40,40,40,0.9)'
        context.beginPath()
        context.arc(w / 2, w / 2, w / 2 - 1, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = '#FFFFFF'
        context.beginPath()
        context.arc(w / 2, w / 2, w / 2 - 5, 0, Math.PI * 2)
        context.fill()
    })

/* The cast's faces. Each is a card texture for the +z face of a box, drawn at 2x. */
const cardTexture = (width, height, draw) =>
    canvasTexture(width * 2, height * 2, (context, w, h) => {
        context.scale(2, 2)
        draw(context, w / 2, h / 2)
    })

const chatTexture = () =>
    cardTexture(48, 34, (c, w, h) => {
        c.fillStyle = '#FFFFFF'
        roundedRect(c, 1, 1, w - 2, h - 2, 12)
        c.fill()
        c.strokeStyle = '#2F80ED'
        c.lineWidth = 3
        roundedRect(c, 2.5, 2.5, w - 5, h - 5, 11)
        c.stroke()
        c.fillStyle = '#2F80ED'
        ;[-11, 0, 11].forEach(dx => {
            c.beginPath()
            c.arc(w / 2 + dx, h / 2, 4, 0, Math.PI * 2)
            c.fill()
        })
    })

const badgeTexture = () =>
    cardTexture(32, 32, (c, w) => {
        c.fillStyle = '#E53935'
        c.beginPath()
        c.arc(w / 2, w / 2, w / 2 - 1, 0, Math.PI * 2)
        c.fill()
        c.strokeStyle = '#FFFFFF'
        c.lineWidth = 2.5
        c.beginPath()
        c.arc(w / 2, w / 2, w / 2 - 3, 0, Math.PI * 2)
        c.stroke()
        c.fillStyle = '#FFFFFF'
        c.font = '800 18px Roboto, system-ui, sans-serif'
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText('1', w / 2, w / 2 + 1)
    })

const noteTexture = () =>
    cardTexture(48, 48, (c, w, h) => {
        c.fillStyle = '#FFE082'
        c.fillRect(0, 0, w, h)
        c.fillStyle = '#FFCA28'
        c.beginPath()
        c.moveTo(w - 12, h)
        c.lineTo(w, h - 12)
        c.lineTo(w, h)
        c.fill()
        c.strokeStyle = 'rgba(120,80,0,0.45)'
        c.lineWidth = 2
        ;[13, 21, 29, 37].forEach((y, i) => {
            c.beginPath()
            c.moveTo(8, y)
            c.lineTo(w - 10 - (i % 2) * 10, y)
            c.stroke()
        })
    })

const checkboxTexture = () =>
    cardTexture(40, 40, (c, w) => {
        c.fillStyle = '#FFFFFF'
        roundedRect(c, 1, 1, w - 2, w - 2, 9)
        c.fill()
        c.strokeStyle = '#2E7D32'
        c.lineWidth = 4
        roundedRect(c, 3, 3, w - 6, w - 6, 8)
        c.stroke()
        c.lineCap = 'round'
        c.lineWidth = 5
        c.beginPath()
        c.moveTo(11, 21)
        c.lineTo(18, 28)
        c.lineTo(30, 12)
        c.stroke()
    })

const calendarTexture = () =>
    cardTexture(72, 62, (c, w, h) => {
        c.fillStyle = '#FFFFFF'
        roundedRect(c, 1, 1, w - 2, h - 2, 8)
        c.fill()
        c.fillStyle = '#7E57C2'
        roundedRect(c, 1, 1, w - 2, 18, 8)
        c.fill()
        c.fillRect(1, 10, w - 2, 9)
        c.fillStyle = '#FFFFFF'
        c.font = '800 10px Roboto, system-ui, sans-serif'
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText('MEETING', w / 2, 11)
        c.fillStyle = '#31264F'
        c.font = '800 20px Roboto, system-ui, sans-serif'
        c.fillText('10:00', w / 2, 37)
        c.fillStyle = 'rgba(126,87,194,0.35)'
        c.fillRect(12, 50, w - 24, 4)
    })

const clockTexture = () =>
    cardTexture(84, 84, (c, w) => {
        const r = w / 2
        c.fillStyle = '#EF6C00'
        c.beginPath()
        c.arc(r, r, r - 1, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#FFFFFF'
        c.beginPath()
        c.arc(r, r, r - 7, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#3A2A1E'
        for (let i = 0; i < 12; i++) {
            const a = (Math.PI * 2 * i) / 12
            const long = i % 3 === 0
            c.beginPath()
            c.arc(r + Math.cos(a) * (r - 14), r + Math.sin(a) * (r - 14), long ? 3 : 1.8, 0, Math.PI * 2)
            c.fill()
        }
    })

// The starred task: a golden card with a white star, the one thing worth chasing.
const starCardTexture = () =>
    cardTexture(48, 34, (c, w, h) => {
        const gradient = c.createLinearGradient(0, 0, w, h)
        gradient.addColorStop(0, '#FFE082')
        gradient.addColorStop(1, '#FFB300')
        c.fillStyle = gradient
        roundedRect(c, 1, 1, w - 2, h - 2, 7)
        c.fill()
        c.fillStyle = '#FFFFFF'
        c.beginPath()
        for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + (Math.PI * i) / 5
            const radius = i % 2 ? 5 : 12
            const x = w / 2 + Math.cos(a) * radius
            const y = h / 2 + Math.sin(a) * radius
            if (i) c.lineTo(x, y)
            else c.moveTo(x, y)
        }
        c.closePath()
        c.fill()
    })

// A power-up token's face: its colour round the rim, its icon in the middle.
const pickupTexture = (icon, color) =>
    canvasTexture(96, 96, (c, w) => {
        const r = w / 2
        c.fillStyle = color
        c.beginPath()
        c.arc(r, r, r - 2, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#FFFFFF'
        c.beginPath()
        c.arc(r, r, r - 10, 0, Math.PI * 2)
        c.fill()
        c.font = '44px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText(icon, r, r + 3)
    })

// The shadow the ground throws onto the page below the seam: it is what makes the generated ground
// read as lying ON TOP of your page rather than being pasted next to it.
const seamShadowTexture = () =>
    canvasTexture(4, 64, (context, w, h) => {
        const gradient = context.createLinearGradient(0, 0, 0, h)
        gradient.addColorStop(0, 'rgba(20,28,48,0.34)')
        gradient.addColorStop(0.35, 'rgba(20,28,48,0.12)')
        gradient.addColorStop(1, 'rgba(20,28,48,0)')
        context.fillStyle = gradient
        context.fillRect(0, 0, w, h)
    })

const ringTexture = () =>
    canvasTexture(256, 256, (context, w) => {
        const gradient = context.createRadialGradient(w / 2, w / 2, w * 0.36, w / 2, w / 2, w / 2)
        gradient.addColorStop(0, 'rgba(255,255,255,0)')
        gradient.addColorStop(0.55, 'rgba(255,236,170,0.95)')
        gradient.addColorStop(0.8, 'rgba(255,138,61,0.8)')
        gradient.addColorStop(1, 'rgba(255,138,61,0)')
        context.fillStyle = gradient
        context.fillRect(0, 0, w, w)
    })

// The face of an incoming e-mail: white, a blue flap, and the red dot of an unread badge.
const envelopeTexture = () =>
    canvasTexture(96, 68, (context, w, h) => {
        context.fillStyle = '#FFFFFF'
        roundedRect(context, 2, 2, w - 4, h - 4, 8)
        context.fill()
        context.strokeStyle = '#0C66FF'
        context.lineWidth = 5
        roundedRect(context, 4, 4, w - 8, h - 8, 7)
        context.stroke()
        context.beginPath()
        context.moveTo(6, 8)
        context.lineTo(w / 2, h * 0.58)
        context.lineTo(w - 6, 8)
        context.stroke()
        context.fillStyle = '#FF3B30'
        context.beginPath()
        context.arc(w - 14, 14, 10, 0, Math.PI * 2)
        context.fill()
    })

const ellipsize = (context, text, maxWidth) => {
    if (!text || context.measureText(text).width <= maxWidth) return text
    let cut = text
    while (cut.length > 1 && context.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1)
    return `${cut.trimEnd()}…`
}

/** A bunker's roof: the task title on the task's colour (armoured ones in gunmetal with a hazard rim). */
const bunkerTexture = (label, color, armoured, width, height) => {
    const scale = 2
    return canvasTexture(Math.ceil(width * scale), Math.ceil(height * scale), (context, w, h) => {
        context.scale(scale, scale)
        const cw = w / scale
        const ch = h / scale
        // The slab's own edge colour behind the rounded corners, so they read as a bevel.
        context.fillStyle = armoured ? '#262B38' : opaqueColor(color).multiplyScalar(0.72).getStyle()
        context.fillRect(0, 0, cw, ch)
        context.fillStyle = armoured ? '#3A4152' : color
        roundedRect(context, 1.5, 1.5, cw - 3, ch - 3, 8)
        context.fill()
        if (armoured) {
            context.strokeStyle = '#FFAE47'
            context.lineWidth = 3
            context.setLineDash && context.setLineDash([7, 5])
            roundedRect(context, 3, 3, cw - 6, ch - 6, 7)
            context.stroke()
            context.setLineDash && context.setLineDash([])
        }
        context.fillStyle = 'rgba(255,255,255,0.16)'
        context.fillRect(8, 5, cw - 16, 5)
        if (label) {
            context.fillStyle = '#FFFFFF'
            context.font = `700 13px Roboto, system-ui, sans-serif`
            context.textBaseline = 'middle'
            context.fillText(ellipsize(context, label, cw - 52), 42, ch / 2 + 1)
        }
    })
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

/** A task row as it looks on the page, for the shards it breaks into. */
const rowTexture = (row, width, height) =>
    canvasTexture(Math.max(2, Math.ceil(width)), Math.max(2, Math.ceil(height)), context => {
        context.fillStyle = row.background
        context.fillRect(0, 0, width, height)
        context.fillStyle = row.style.color
        context.font = row.style.font
        context.textBaseline = 'middle'
        context.fillText(row.label, 44, height / 2)
    })

/* ------------------------------------------------------------------------------------------------ */
/* Geometry                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

/** Flat, vertex-coloured quads in one geometry: a whole chunk of ground is one draw call. */
const createQuadBuilder = () => {
    const positions = []
    const colors = []
    const quad = (points, z, color) => {
        const [a, b, c, d] = points
        ;[a, b, c, a, c, d].forEach(p => {
            positions.push(p.x, p.y, z)
            colors.push(color.r, color.g, color.b)
        })
    }
    return {
        rect(x, y, w, h, z, color) {
            quad(
                [
                    { x, y },
                    { x: x + w, y },
                    { x: x + w, y: y + h },
                    { x, y: y + h },
                ],
                z,
                color
            )
        },
        quad,
        build() {
            const geometry = new BufferGeometry()
            geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
            geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
            return geometry
        },
    }
}

/**
 * A pitched roof, one unit wide (x), deep (y) and high (z), its ridge along x. Seen from above its
 * two slopes catch the sun differently, which is what makes a house read as a house.
 */
const roofGeometry = () => {
    const ridgeL = [-0.5, 0, 1]
    const ridgeR = [0.5, 0, 1]
    const frontL = [-0.5, -0.5, 0]
    const frontR = [0.5, -0.5, 0]
    const backL = [-0.5, 0.5, 0]
    const backR = [0.5, 0.5, 0]
    const triangles = [
        [frontL, frontR, ridgeR],
        [frontL, ridgeR, ridgeL],
        [backR, backL, ridgeL],
        [backR, ridgeL, ridgeR],
        [frontL, ridgeL, backL],
        [frontR, backR, ridgeR],
    ]
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(triangles.flat(2), 3))
    geometry.computeVertexNormals()
    return geometry
}

/** A flat triangle around its own centroid, textured from the rectangle it was cut out of. */
const shardGeometry = (vertices, centroid, size) => {
    const positions = []
    const uvs = []
    vertices.forEach(v => {
        positions.push(v.x - centroid.x, -(v.y - centroid.y), 0)
        uvs.push(v.x / size.width, 1 - v.y / size.height)
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
    return geometry
}

/* ------------------------------------------------------------------------------------------------ */
/* The arena                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Open the raid over the current page. Returns a handle whose `stop()` flies everyone home and puts
 * the page back. Only one arena exists at a time; a second call returns the running one.
 *
 * @param {object} options
 * @param {object} options.strings  translated strings (`rageStrings.js`)
 * @param {{x:number,y:number,size?:number}} [options.from] where Anna takes off from and lands
 *   again (Anna's avatar in the assistant line); `size` is its height, which she shrinks into
 * @param {string} [options.progressScope] whose progress this is (the user id); see `raidProgress.js`
 *   (`services.saveProgress(checkpoint | null)` → Promise<{ok, savedAt}> keeps the server's copy;
 *   `loadProfile()` returns it as `progress`)
 * @param {() => void} [options.onExit] called once the arena is fully gone
 * @param {HTMLElement} [options.pageRoot] the element that slides away (default `#root`)
 * @param {object} [options.services] the outside world, all optional (a harness passes fakes):
 *   loadProfile() → Promise<{owned, highscore}>, purchase(id) → Promise<{ok, owned, newBalance, reason}>,
 *   submitScore(score) → Promise<{ok, highscore, isNew}>, getGold() → number,
 *   getOpenTasksToday() → number, getProjectColor(projectId) → css colour | null
 * @param {object} [options.tuning] for tests only: `startShield`, `invincible`, `seed`, `bossAt`
 *   (seconds; waves scheduled later are dropped), `noWaves`, `waves` (a wave list to fly instead),
 *   `bossHp`, `bossKind` and `pickups` (ids dropped right in front of her at lift-off).
 */
export function startRageArena({ strings, from, onExit, pageRoot, progressScope, services = {}, tuning = {} }) {
    if (activeArena) return activeArena

    const random = createRandom(Date.now() & 0xffff)
    const touchDevice = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const seed = typeof tuning.seed === 'number' ? tuning.seed : daySeed()

    // A focused editor or input would keep its caret blinking under the arena; nothing may type now.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur()

    /* Renderer, camera, lights. */
    const renderer = new WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touchDevice ? 1.5 : 2))
    renderer.outputColorSpace = SRGBColorSpace
    renderer.setClearColor(0x000000, 0)
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
        cursor: touchDevice ? 'default' : 'none',
        touchAction: 'none',
        userSelect: 'none',
        webkitUserSelect: 'none',
        background: 'transparent',
    })

    const scene = new Scene()
    const camera = new OrthographicCamera(0, 1, 0, -1, 0.1, 3000)
    camera.position.set(0, 0, 1500)
    // A bright sky-and-ground fill: the shaded sides of trees, roofs and rubble stay light, so
    // nothing on the ground reads as a dark spot.
    scene.add(new HemisphereLight('#ffffff', '#b4bdcc', 1.6))
    // Real shadows instead of painted blobs: everything above the ground casts a crisp silhouette
    // onto an invisible catcher plane, and the higher it flies the further away its shadow falls —
    // on the ground and on your page alike.
    const sun = new DirectionalLight('#ffffff', 1.8)
    if (renderer.shadowMap) {
        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = PCFSoftShadowMap
    }
    sun.castShadow = true
    sun.shadow.mapSize.set(touchDevice ? 1024 : 2048, touchDevice ? 1024 : 2048)
    sun.shadow.bias = -0.0008
    scene.add(sun, sun.target)
    const shadowCatcher = new Mesh(
        new PlaneGeometry(1, 1),
        new ShadowMaterial({ color: '#14203D', opacity: 0.2, depthWrite: false })
    )
    shadowCatcher.receiveShadow = true
    shadowCatcher.renderOrder = 1
    scene.add(shadowCatcher)
    const aimSun = () => {
        const cx = viewport.width / 2
        const cy = -viewport.height / 2
        sun.target.position.set(cx, cy, 0)
        sun.position.set(cx + SUN_DIRECTION.x * 1500, cy + SUN_DIRECTION.y * 1500, SUN_DIRECTION.z * 1500)
        const reach = Math.hypot(viewport.width, viewport.height) / 2 + 260
        Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 4000 })
        sun.shadow.camera.updateProjectionMatrix()
        shadowCatcher.position.set(cx, cy, 0.9)
        shadowCatcher.scale.set(viewport.width + 400, viewport.height + 400, 1)
    }

    const resizeCamera = () => {
        viewport.width = window.innerWidth
        viewport.height = window.innerHeight
        renderer.setSize(viewport.width, viewport.height, false)
        camera.left = 0
        camera.right = viewport.width
        camera.top = 0
        camera.bottom = -viewport.height
        camera.updateProjectionMatrix()
        aimSun()
    }
    resizeCamera()

    /* Shared resources. */
    const disposables = new Set()
    const keep = resource => {
        disposables.add(resource)
        return resource
    }
    const unitPlane = keep(new PlaneGeometry(1, 1))
    const textures = {
        puff: keep(puffTexture()),
        bolt: keep(boltTexture()),
        orb: keep(orbTexture()),
        ring: keep(ringTexture()),
        envelope: keep(envelopeTexture()),
        seamShadow: keep(seamShadowTexture()),
    }
    // The seam: ground is only drawn ABOVE the page's top edge (see the header).
    const seamPlane = new Plane(new Vector3(0, 1, 0), 0)
    const clipped = material => {
        material.clippingPlanes = [seamPlane]
        return keep(material)
    }
    const groundMaterial = clipped(new MeshBasicMaterial({ vertexColors: true }))
    const treeMaterial = clipped(new MeshStandardMaterial({ roughness: 0.9, flatShading: true }))
    const wallMaterial = clipped(new MeshStandardMaterial({ color: '#F4EEE3', roughness: 0.9, flatShading: true }))
    const roofMaterial = clipped(new MeshStandardMaterial({ roughness: 0.7, flatShading: true }))
    const rubbleMaterial = clipped(new MeshStandardMaterial({ roughness: 0.9, flatShading: true }))
    const cloudMaterial = clipped(
        new MeshBasicMaterial({ map: textures.puff, transparent: true, opacity: 0.42, depthWrite: false })
    )
    const foundationMaterials = new Map()
    // A soft-edged patch (the puff texture, tinted), so a wreck fades into the ground around it.
    const foundationMaterial = css => {
        if (!foundationMaterials.has(css))
            foundationMaterials.set(
                css,
                clipped(new MeshBasicMaterial({ map: textures.puff, color: css, transparent: true, depthWrite: false }))
            )
        return foundationMaterials.get(css)
    }
    const treeGeometry = keep(new IcosahedronGeometry(1, 0))
    const roofPrism = keep(roofGeometry())
    const noseGeometry = keep(new ConeGeometry(5, 14, 6))
    const boxGeometry = keep(new BoxGeometry(1, 1, 1))
    const turretBaseGeometry = keep(new CylinderGeometry(11, 13, 10, 12))
    const barrelGeometry = keep(new BoxGeometry(5, 20, 5))
    const turretMaterial = keep(new MeshStandardMaterial({ color: '#3A4152', roughness: 0.5, metalness: 0.3 }))
    const barrelMaterial = keep(new MeshStandardMaterial({ color: '#1E2330', roughness: 0.4, metalness: 0.5 }))

    const standard = color => keep(new MeshStandardMaterial({ color, roughness: 0.55, flatShading: true }))
    const enemyMaterials = {
        hull: standard('#24305E'),
        accent: standard('#E64A19'),
        glass: keep(new MeshStandardMaterial({ color: '#6FD3FF', emissive: '#2F8FCF', emissiveIntensity: 0.5 })),
        envelopeSide: standard('#C9D6EA'),
        envelopeFace: keep(new MeshBasicMaterial({ map: textures.envelope })),
        engine: keep(new MeshBasicMaterial({ color: '#FFAE47' })),
    }
    // Each member of the cast: its face texture and the colour of its edges, made on first use.
    const castLooks = {}
    const castLook = (type, makeTexture, edge) => {
        if (!castLooks[type]) {
            const face = keep(new MeshBasicMaterial({ map: keep(makeTexture()), transparent: true }))
            castLooks[type] = { face, edge: standard(edge) }
        }
        return castLooks[type]
    }
    const cylinderGeometry = keep(new CylinderGeometry(1, 1, 1, 28))
    const spikeGeometry = keep(new ConeGeometry(3.2, 9, 5))
    const coreTexture = keep(puffTexture())
    const tintColors = new Map()
    const tintColor = css => {
        if (!tintColors.has(css)) tintColors.set(css, new Color(css))
        return tintColors.get(css)
    }

    /* Layers of the scene. */
    const ground = new Group()
    const pageGroup = new Group()
    scene.add(ground, pageGroup)
    const character = buildCharacter(touchDevice ? 0.85 : 1.1)
    // Anna flies UP the screen, seen from above and behind: her head points up the screen, her
    // jetpack faces the camera, and her gun arm points forward over her head. `bank` rolls her
    // about her own long axis as she steers; `tilt` shows a little of her head.
    character.yaw.rotation.y = Math.PI / 2
    character.arm.rotation.z = Math.PI / 2
    const bank = new Group()
    bank.add(character.root)
    const shipNode = new Group()
    shipNode.rotation.x = 0.5
    shipNode.add(bank)
    character.root.traverse(node => {
        if (node.isMesh && !character.flames.includes(node)) node.castShadow = true
    })
    scene.add(shipNode)

    /* Instanced projectiles and particles. */
    const dummy = new Object3D()
    const instanced = (geometry, material, capacity, renderOrder) => {
        const mesh = new InstancedMesh(geometry, material, capacity)
        mesh.count = 0
        mesh.frustumCulled = false
        mesh.renderOrder = renderOrder
        scene.add(mesh)
        return mesh
    }
    const shotMesh = instanced(
        unitPlane,
        keep(new MeshBasicMaterial({ map: textures.bolt, transparent: true, depthWrite: false, depthTest: false })),
        MAX_SHOTS,
        3
    )
    const enemyShotMesh = instanced(
        unitPlane,
        keep(new MeshBasicMaterial({ map: textures.orb, transparent: true, depthWrite: false, depthTest: false })),
        MAX_ENEMY_SHOTS,
        5
    )
    // The white heart of every enemy shot, drawn over its tinted body.
    const enemyCoreMesh = instanced(
        unitPlane,
        keep(new MeshBasicMaterial({ map: textures.puff, transparent: true, depthWrite: false, depthTest: false })),
        MAX_ENEMY_SHOTS,
        6
    )
    const puffMesh = instanced(
        unitPlane,
        keep(new MeshBasicMaterial({ map: textures.puff, transparent: true, depthWrite: false, depthTest: false })),
        MAX_PUFFS,
        4
    )
    const sparkMesh = instanced(boxGeometry, keep(new MeshBasicMaterial({ color: '#FFAE47' })), MAX_SPARKS, 4)
    // Instance colours exist only once something is written; write white everywhere first.
    const white = new Color('#ffffff')
    for (let i = 0; i < MAX_PUFFS; i++) puffMesh.setColorAt(i, white)
    for (let i = 0; i < MAX_ENEMY_SHOTS; i++) enemyShotMesh.setColorAt(i, white)

    // The laser: a red beam with a white core, both scaled to reach from the muzzle to the top.
    const laserGlow = new Mesh(unitPlane, keep(new MeshBasicMaterial({ color: '#FF3B30' })))
    const laserCore = new Mesh(unitPlane, keep(new MeshBasicMaterial({ color: '#FFFFFF' })))
    const laserGroup = new Group()
    laserGroup.add(laserGlow, laserCore)
    laserGroup.visible = false
    scene.add(laserGroup)

    // A full-screen white flash for bombs and the finger snap.
    const flashMaterial = keep(
        new MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0, depthWrite: false })
    )
    const flash = new Mesh(unitPlane, flashMaterial)
    flash.renderOrder = 10
    scene.add(flash)

    const seamShadow = new Mesh(
        unitPlane,
        keep(new MeshBasicMaterial({ map: textures.seamShadow, transparent: true, depthWrite: false }))
    )
    seamShadow.renderOrder = 2
    scene.add(seamShadow)

    /* The page we take off from. */
    const root = pageRoot || document.getElementById('root')
    const restoreStyles = [
        setTemporaryStyle(document.documentElement, { overflow: 'hidden' }),
        setTemporaryStyle(document.body, { overflow: 'hidden' }),
    ]
    let restoreRoot = () => {}
    if (root && root !== document.body && root !== document.documentElement) {
        restoreRoot = setTemporaryStyle(root, { 'will-change': 'transform', transform: 'translate3d(0, 0px, 0)' })
    }
    let appliedPageOffset = 0
    const setPageOffset = offset => {
        if (!root || root === document.body || Math.abs(offset - appliedPageOffset) < 0.25) return
        appliedPageOffset = offset
        root.style.setProperty('transform', `translate3d(0, ${offset.toFixed(1)}px, 0)`)
    }
    const pageCap = () => viewport.height + PAGE_CAP_EXTRA

    // Task rows: on screen they become the welcome committee, all of them lend their titles to the
    // bunkers further up. Read-only, like everything that looks at the page.
    const readRows = () => {
        const rows = []
        Array.from(document.querySelectorAll(TASK_ROW_SELECTOR)).forEach(element => {
            if (element.closest(`[${RAGE_LAYER_ATTRIBUTE}]`)) return
            const rect = element.getBoundingClientRect()
            let longest = null
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const text = (node.textContent || '').replace(/\s+/g, ' ').trim()
                if (text && (!longest || text.length > longest.text.length)) longest = { text, node }
            }
            if (!longest) return
            const projectId = (element.id || '').replace(/^task_body_/, '').split('_')[0]
            const label = longest.text.slice(0, 80)
            rows.push({
                element,
                rect,
                label,
                projectId,
                style: longest.node.parentElement ? glyphStyle(longest.node.parentElement) : null,
            })
        })
        return rows
    }
    const pageRows = root ? readRows() : []
    const levelTasks = []
    {
        const labels = new Set()
        pageRows.forEach(row => {
            if (labels.has(row.label)) return
            labels.add(row.label)
            let color = null
            try {
                color = services.getProjectColor ? services.getProjectColor(row.projectId) : null
            } catch (error) {
                color = null
            }
            levelTasks.push({ label: row.label, color })
        })
    }

    /* State. */
    // Pick up where the last raid left off (raidProgress.js), unless there is nothing to pick up.
    // This browser's copy first, so take-off is instant; the server's copy (which may come from
    // another device) is reconciled with it when the profile arrives, during the run-up.
    let record = readRecord(progressScope)
    let checkpoint = record ? record.checkpoint : null
    const freshRun = () => {
        const next = checkpoint ? runFromCheckpoint(checkpoint) : createRun()
        if (typeof tuning.startShield === 'number')
            next.shield = Math.max(1, Math.min(next.maxShield, tuning.startShield))
        return next
    }
    let run = freshRun()
    // One save in flight at a time, newest last: two quick hangar purchases must never reach the
    // server in the wrong order.
    let syncing = false
    const syncProgress = () => {
        if (syncing || !services.saveProgress || !record || !record.pending) return
        syncing = true
        const sending = record
        Promise.resolve()
            .then(() => services.saveProgress(sending.checkpoint))
            .then(result => {
                if (result && result.ok && record === sending) {
                    record = { checkpoint: sending.checkpoint, savedAt: result.savedAt, pending: false }
                    writeRecord(progressScope, record)
                }
            })
            .catch(() => {})
            .finally(() => {
                syncing = false
                if (record && record.pending && record !== sending) syncProgress()
            })
    }
    /** Remember `next` (a checkpoint, or null for "start over") here and on the server. */
    const storeProgress = next => {
        checkpoint = next
        record = { checkpoint: next, savedAt: Date.now(), pending: true }
        writeRecord(progressScope, record)
        ui.setCanStartOver(!!next)
        syncProgress()
    }
    const saveProgress = () => storeProgress(checkpointFromRun(run))
    /** The server's copy arrived: fly with whichever is newer, and push ours up if it is. */
    const adoptServerProgress = progress => {
        const remote = progress ? sanitizeRecord({ ...progress, pending: false }) : null
        const { record: chosen, push } = reconcile(record, remote)
        const next = chosen ? chosen.checkpoint : null
        const changed = JSON.stringify(next) !== JSON.stringify(checkpoint)
        record = chosen
        writeRecord(progressScope, chosen)
        // Before lift-off the raid can still switch to it; mid-mission it applies next time.
        if (changed && (phase === 'takeoff' || phase === 'runup')) {
            checkpoint = next
            run = freshRun()
            ui.setCanStartOver(!!checkpoint)
            hudDirty = true
        }
        if (push) syncProgress()
    }
    let startOverArmedUntil = -Infinity
    let best = 0
    let phase = 'takeoff'
    let finished = false
    let time = 0
    let scroll = 0
    let scrollRamp = 0
    let shake = 0
    let shotsFired = 0
    let scoreSubmitted = false
    let lastRoundNew = false
    let returnStart = 0
    let returnFrom = 0
    let returnSeam = 0
    let gameOverAt = 0
    let gameOverShown = false
    let missionEndAt = null
    let hudDirty = true
    const ship = { x: viewport.width / 2, y: viewport.height * RUNUP_START_Y, vx: 0 }
    const launch = from ? { x: from.x, y: from.y } : { x: viewport.width / 2, y: viewport.height + 40 }
    // She comes out of the avatar at its size, and shrinks back into it on the way home.
    const launchScale = Math.max(0.2, Math.min(1, (from && from.size ? from.size : 20) / ANNA_HEIGHT))
    let greeting = null
    let runupStart = 0
    let liftoffAt = -Infinity
    let runupPuffIn = 0
    let lastStride = -1
    // The raid waits (a little) for the server's copy of your progress before the mission starts.
    let progressSettled = !services.loadProfile
    let lastGreetingStyle = null
    let bubble = null
    let bankAngle = 0
    const pointer = { x: ship.x, y: ship.y, active: false, anchored: false, offsetX: 0, offsetY: 0 }
    // Where the mouse wants her: the cursor plus the gap that was there when steering began.
    const steerTarget = () =>
        pointer.active && touchId === null ? { x: pointer.x + pointer.offsetX, y: pointer.y + pointer.offsetY } : null
    /**
     * Forget where the cursor was. A browser cannot move the real cursor, so instead the next mouse
     * movement is taken as "the cursor is where Anna is" — she never jumps to wherever the hidden
     * cursor was left (on the crosshair at take-off, on a shop button, on the hangar's launch button).
     */
    const resetSteering = () => {
        pointer.active = false
        pointer.anchored = false
    }
    let paused = false
    const held = new Set()
    let touchId = null
    let touchLast = null

    let owned = new Set([RAGE_DEFAULT_WEAPON])
    const preferredWeapon = readStoredWeapon()
    let equipped = RAGE_DEFAULT_WEAPON
    let knownGold = null
    let mainCooldown = 0
    let specialCooldown = 0
    let laserTick = 0
    let rocketSide = 1
    let volleyCount = 0

    const shots = []
    const enemyShots = []
    const rockets = []
    const blackholes = []
    const puffs = []
    const sparks = []
    const debris = []
    const airEnemies = []
    const pendingSpawns = []
    let pendingWaves = []
    let bunkers = []
    let pageTargets = []
    let mission = null
    let missionTime = 0
    let missionOrigin = 0
    let boss = null
    let bossModel = null
    let bossState = 'waiting'
    let terrainTheme = 0

    const sound = createSound()
    sound.unlock()

    /* HUD. */
    const narrow = visibleWidth() < NARROW_HUD_WIDTH
    const ui = buildRaidHud({
        strings,
        zIndex: Z_INDEX,
        touch: touchDevice,
        muted: sound.muted,
        narrow,
        actions: {
            exit: () => beginReturn(),
            toggleMute: () => {
                sound.setMuted(!sound.muted)
                writeMuted(sound.muted)
                ui.setMuted(sound.muted)
            },
            bomb: () => dropBomb(),
            equip: id => equip(id),
            buyHangar: id => buyFromHangar(id),
            launch: () => launchNextMission(),
            openGoldShop: () => openShop(),
            playAgain: () => playAgain(),
            greet: () => startGreeting(),
            startOver: () => startOver(),
            requestStartOver: () => requestStartOver(),
        },
    })
    ui.setCanStartOver(!!checkpoint)
    const hud = ui.hud
    const setPhase = next => {
        phase = next
        hud.dataset.phase = next
    }
    setPhase('takeoff')

    /* Effects. */
    // Fire cools from white through yellow and orange into a light smoke — never into soot, which
    // reads as a dark stain on the light ground.
    const FIRE_RAMP = ['#FFFFFF', '#FFF1A8', '#FFC857', '#FF8A3D', '#F0643A', '#D9D4CF'].map(c => new Color(c))
    const SMOKE = new Color('#E2E5EA')
    const rings = []
    const addRing = (x, y, size, life = 0.45, opacity = 0.75) => {
        const mesh = new Mesh(
            unitPlane,
            new MeshBasicMaterial({
                map: textures.ring,
                transparent: true,
                depthWrite: false,
                depthTest: false,
                opacity,
            })
        )
        mesh.renderOrder = 7
        scene.add(mesh)
        rings.push({ mesh, x, y, size, age: 0, life, opacity })
    }
    const addPuff = (x, y, size, { life = 0.55, smoke = false, vx = 0, vy = 0 } = {}) => {
        puffs.push({ x, y, size, life, age: 0, smoke, vx, vy })
        if (puffs.length > MAX_PUFFS) puffs.shift()
    }
    const addSparks = (x, y, count, power = 1) => {
        for (let i = 0; i < count; i++) {
            const angle = random() * Math.PI * 2
            const speed = (160 + random() * 380) * power
            sparks.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                age: 0,
                life: 0.3 + random() * 0.25,
            })
        }
        while (sparks.length > MAX_SPARKS) sparks.shift()
    }
    const explode = (x, y, size = 1) => {
        addPuff(x, y, 46 * size, { life: 0.22 })
        const count = Math.round(6 + 4 * size)
        for (let i = 0; i < count; i++) {
            const angle = random() * Math.PI * 2
            const distance = random() * 22 * size
            addPuff(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, (18 + random() * 22) * size, {
                life: 0.45 + random() * 0.35,
                vx: Math.cos(angle) * 40 * size,
                vy: Math.sin(angle) * 40 * size,
            })
        }
        for (let i = 0; i < Math.round(2 + size); i++)
            addPuff(x + (random() - 0.5) * 30 * size, y + (random() - 0.5) * 30 * size, 24 * size, {
                life: 1 + random() * 0.6,
                smoke: true,
                vy: -12,
            })
        addSparks(x, y, Math.round(8 * size), Math.min(1.6, size))
        if (size >= 1) addRing(x, y, 120 * size, 0.4, 0.6)
        shake = Math.min(14, shake + 3 * size)
        sound.explosion(size)
    }
    const flashScreen = strength => {
        flashMaterial.opacity = Math.max(flashMaterial.opacity, strength)
    }

    /**
     * What a destroyed bunker leaves on the ground at screen point (x, y): its scorched foundation
     * in a lighter shade of its own colour and a little heap of rubble that smokes for a moment,
     * all scrolling away with the ground. Light on purpose — a dark crater reads as a stain.
     */
    const wrecks = []
    const addWreck = (x, y, w, h, color) => {
        const group = new Group()
        group.position.set(x, scroll - y, 1.1)
        const base = new Color(color).lerp(new Color(THEMES[terrainTheme].ground), 0.8).lerp(new Color('#FFFFFF'), 0.1)
        const foundation = new Mesh(unitPlane, foundationMaterial(`#${base.getHexString()}`))
        foundation.scale.set(w * 1.1, h * 1.6, 1)
        group.add(foundation)
        const count = 12
        const rubble = new InstancedMesh(boxGeometry, rubbleMaterial, count)
        rubble.castShadow = true
        rubble.frustumCulled = false
        const light = new Color(color).lerp(new Color('#FFFFFF'), 0.35)
        const tints = [
            light,
            new Color(color).lerp(new Color('#FFFFFF'), 0.6),
            new Color('#ECE7DD'),
            new Color('#D9D2C5'),
        ]
        for (let i = 0; i < count; i++) {
            const size = 6 + random() * 9
            dummy.position.set((random() - 0.5) * w * 0.7, (random() - 0.5) * h * 0.6, size / 2)
            dummy.rotation.set(random(), random(), random() * Math.PI)
            dummy.scale.set(size, size * (0.6 + random() * 0.6), size * 0.7)
            dummy.updateMatrix()
            rubble.setMatrixAt(i, dummy.matrix)
            rubble.setColorAt(i, tints[i % tints.length])
        }
        group.add(rubble)
        ground.add(group)
        wrecks.push({ group, rubble, g: scroll - y, smokeUntil: time + 3, smokeIn: 0 })
        while (wrecks.length > MAX_WRECKS) removeWreck(wrecks.shift())
    }
    const removeWreck = wreck => {
        ground.remove(wreck.group)
        wreck.rubble.dispose()
    }
    // A thin plume rising from each fresh wreck, drifting with the ground.
    const updateWrecks = dt => {
        const groundSpeed =
            phase === 'flying' || phase === 'cleared' ? (mission ? mission.scrollSpeed : SCROLL_SPEED) : 0
        wrecks.forEach(wreck => {
            if (time > wreck.smokeUntil) return
            wreck.smokeIn -= dt
            if (wreck.smokeIn > 0) return
            wreck.smokeIn = 0.12
            const y = scroll - wreck.g
            if (y < -40 || y > viewport.height + 40) return
            addPuff(wreck.group.position.x + (random() - 0.5) * 16, y, 12 + random() * 10, {
                life: 1.2,
                smoke: true,
                vx: 14,
                vy: groundSpeed * 0.8 - 30,
            })
        })
    }

    /** Break a textured rectangle (screen coords) into shards that scatter across the ground. */
    const shatter = (texture, rect, power = 1) => {
        const material = keep(new MeshBasicMaterial({ map: texture, side: DoubleSide, transparent: true }))
        shatterRect(rect.width, rect.height, random, 30).forEach(shard => {
            const geometry = shardGeometry(shard.vertices, shard.centroid, rect)
            const mesh = new Mesh(geometry, material)
            mesh.renderOrder = 6
            const x = rect.left + shard.centroid.x
            const y = rect.top + shard.centroid.y
            const cx = rect.left + rect.width / 2
            const cy = rect.top + rect.height / 2
            const angle = Math.atan2(y - cy, x - cx) + (random() - 0.5) * 0.8
            const speed = (120 + random() * 260) * power
            const piece = {
                mesh,
                material,
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                spin: (random() - 0.5) * 14,
                age: 0,
                life: 0.7 + random() * 0.5,
            }
            toWorld(mesh, x, y, Z.debris)
            scene.add(mesh)
            debris.push(piece)
        })
        while (debris.length > MAX_DEBRIS) {
            const old = debris.shift()
            scene.remove(old.mesh)
            old.mesh.geometry.dispose()
        }
    }

    /* Terrain. */
    const chunks = new Map()
    const buildChunk = index => {
        const theme = THEMES[terrainTheme]
        const data = terrainChunk({ index, width: viewport.width, seed })
        const base = index * CHUNK_HEIGHT
        const group = new Group()
        group.position.set(0, base, 0)
        const quads = createQuadBuilder()
        const color = css => new Color(css)
        quads.rect(0, 0, viewport.width, CHUNK_HEIGHT, 0, color(theme.ground))
        const fieldColors = theme.fields.map(color)
        data.fields.forEach(field => {
            quads.rect(field.x, field.y, field.w, field.h, 0.1, fieldColors[field.shade])
            // Every other field is ploughed: rows a shade darker than the field itself.
            if (field.shade % 2 === 0) {
                const rows = fieldColors[field.shade].clone().multiplyScalar(0.94)
                for (let y = field.y + 5; y < field.y + field.h - 3; y += 9)
                    quads.rect(field.x + 4, y, field.w - 8, 3, 0.12, rows)
            }
        })
        // The river: a ribbon following its meander on a band of sand, a darker channel down its
        // middle and a few light ripples on top.
        const sand = color(theme.bank).lerp(color('#F3E7C9'), 0.45)
        const water = color(theme.water)
        const deep = water.clone().multiplyScalar(0.88)
        const ripple = water.clone().lerp(color('#FFFFFF'), 0.45)
        for (let y = 0; y < CHUNK_HEIGHT; y += 16) {
            const x0 = riverX(base + y, viewport.width, seed)
            const x1 = riverX(base + y + 16, viewport.width, seed)
            if ((base + y) % 112 === 0 || (base + y + 48) % 112 === 0) {
                const side = (base + y) % 224 === 0 ? -0.45 : 0.35
                quads.rect(x0 + RIVER_HALF_WIDTH * side - 7, y + 4, 14, 2, 0.35, ripple)
            }
            ;[
                [RIVER_HALF_WIDTH + 10, 0.2, sand],
                [RIVER_HALF_WIDTH, 0.3, water],
                [RIVER_HALF_WIDTH * 0.45, 0.32, deep],
            ].forEach(([half, z, tint]) =>
                quads.quad(
                    [
                        { x: x0 - half, y },
                        { x: x0 + half, y },
                        { x: x1 + half, y: y + 16 },
                        { x: x1 - half, y: y + 16 },
                    ],
                    z,
                    tint
                )
            )
        }
        const road = roadX(viewport.width, seed)
        quads.rect(road - ROAD_HALF_WIDTH, 0, ROAD_HALF_WIDTH * 2, CHUNK_HEIGHT, 0.4, color(theme.road))
        for (let y = 8; y < CHUNK_HEIGHT; y += 40) quads.rect(road - 1.5, y, 3, 18, 0.5, color(theme.line))
        if (data.crossRoad) {
            quads.rect(
                0,
                data.crossRoad.y - ROAD_HALF_WIDTH,
                viewport.width,
                ROAD_HALF_WIDTH * 2,
                0.45,
                color(theme.road)
            )
            for (let x = 8; x < viewport.width; x += 40)
                quads.rect(x, data.crossRoad.y - 1.5, 18, 3, 0.55, color(theme.line))
        }
        const flat = new Mesh(quads.build(), groundMaterial)
        group.add(flat)

        if (data.trees.length) {
            // Each tree is a small cluster: a big crown and a smaller one beside it.
            const trees = new InstancedMesh(treeGeometry, treeMaterial, data.trees.length * 2)
            trees.frustumCulled = false
            trees.castShadow = true
            data.trees.forEach((tree, i) => {
                const tint = color(theme.trees[i % theme.trees.length])
                dummy.position.set(tree.x, tree.y, tree.r)
                dummy.rotation.set(i, i * 0.7, i)
                dummy.scale.setScalar(tree.r)
                dummy.updateMatrix()
                trees.setMatrixAt(i * 2, dummy.matrix)
                trees.setColorAt(i * 2, tint)
                const angle = i * 2.4
                dummy.position.set(
                    tree.x + Math.cos(angle) * tree.r * 0.8,
                    tree.y + Math.sin(angle) * tree.r * 0.8,
                    tree.r * 0.7
                )
                dummy.scale.setScalar(tree.r * 0.62)
                dummy.updateMatrix()
                trees.setMatrixAt(i * 2 + 1, dummy.matrix)
                trees.setColorAt(i * 2 + 1, tint.clone().lerp(color('#FFFFFF'), 0.12))
            })
            group.add(trees)
        }
        if (data.houses.length) {
            // Cream walls under a pitched roof in one of the theme's roof colours.
            const walls = new InstancedMesh(boxGeometry, wallMaterial, data.houses.length)
            const roofs = new InstancedMesh(roofPrism, roofMaterial, data.houses.length)
            ;[walls, roofs].forEach(mesh => {
                mesh.frustumCulled = false
                mesh.castShadow = true
            })
            data.houses.forEach((house, i) => {
                const wallHeight = house.h * 0.6
                dummy.rotation.set(0, 0, i % 3 === 0 ? Math.PI / 2 : 0)
                dummy.position.set(house.x, house.y, wallHeight / 2)
                dummy.scale.set(house.w, house.d, wallHeight)
                dummy.updateMatrix()
                walls.setMatrixAt(i, dummy.matrix)
                dummy.position.set(house.x, house.y, wallHeight)
                dummy.scale.set(house.w * 1.08, house.d * 1.16, house.h * 0.55)
                dummy.updateMatrix()
                roofs.setMatrixAt(i, dummy.matrix)
                roofs.setColorAt(i, color(theme.roofs[i % theme.roofs.length]))
            })
            group.add(walls, roofs)
        }
        ground.add(group)
        return group
    }
    const disposeChunk = group => {
        ground.remove(group)
        group.children.forEach(child => {
            if (
                child.geometry &&
                child.geometry !== unitPlane &&
                child.geometry !== treeGeometry &&
                child.geometry !== roofPrism &&
                child.geometry !== boxGeometry
            )
                child.geometry.dispose()
            if (child.isInstancedMesh && child.dispose) child.dispose()
        })
    }
    const clearTerrain = () => {
        chunks.forEach(disposeChunk)
        chunks.clear()
    }
    // `renderScroll` is the scroll the ground is DRAWN at; it differs from `scroll` only while
    // leaving. `seamG` is the ground distance at the page's top edge.
    let renderScroll = 0
    let scrollDelta = 0
    let seamG = 0
    const updateTerrain = () => {
        const low = Math.max(seamG, renderScroll - viewport.height - 20)
        const high = renderScroll + 20
        const first = Math.max(0, Math.floor(low / CHUNK_HEIGHT))
        const last = Math.max(0, Math.floor(high / CHUNK_HEIGHT))
        for (let index = first; index <= last; index++) {
            if (!chunks.has(index)) chunks.set(index, buildChunk(index))
        }
        chunks.forEach((group, index) => {
            if (index < first - 1 || index > last + 1) {
                disposeChunk(group)
                chunks.delete(index)
            }
        })
        ground.position.y = -renderScroll
        // Screen y of the seam; the plane keeps world y ≥ −seamY.
        const seamY = renderScroll - seamG
        seamPlane.constant = seamY
        seamShadow.visible = seamY > 0 && seamY < viewport.height
        seamShadow.position.set(viewport.width / 2, -(seamY + 14), Z.page + 1)
        seamShadow.scale.set(viewport.width, 28, 1)
    }

    /* Models. */
    const buildTurret = () => {
        const group = new Group()
        const base = new Mesh(turretBaseGeometry, turretMaterial)
        base.rotation.x = Math.PI / 2
        const pivot = new Group()
        pivot.position.z = 8
        const barrel = new Mesh(barrelGeometry, barrelMaterial)
        barrel.position.y = -12
        pivot.add(barrel)
        group.add(base, pivot)
        base.castShadow = true
        barrel.castShadow = true
        return { group, pivot }
    }
    // Points a turret's barrel (local −y) at a screen-space direction.
    const aimTurret = (pivot, dx, dy) => {
        pivot.rotation.z = Math.atan2(dx, dy)
    }

    // Each fighter gets its own hull and wing materials, so a hit can flash it white.
    const buildFighter = () => {
        const group = new Group()
        const hull = enemyMaterials.hull.clone()
        const wing = enemyMaterials.accent.clone()
        const part = (geometry, w, h, d, material, x, y, z, rz = 0) => {
            const mesh = new Mesh(geometry, material)
            mesh.scale.set(w, h, d)
            mesh.position.set(x, y, z)
            mesh.rotation.z = rz
            mesh.castShadow = true
            group.add(mesh)
            return mesh
        }
        // Nose towards the bottom of the screen (world −y): it is coming for Anna.
        part(boxGeometry, 10, 38, 9, hull, 0, 2, 0)
        const nose = part(noseGeometry, 1, 1, 1, hull, 0, -24, 0)
        nose.rotation.z = Math.PI
        // Swept wings, tailplane and fin.
        part(boxGeometry, 28, 13, 3, wing, -13, 2, 0, -0.32)
        part(boxGeometry, 28, 13, 3, wing, 13, 2, 0, 0.32)
        part(boxGeometry, 20, 6, 2, wing, 0, 19, 1)
        part(boxGeometry, 2, 10, 9, hull, 0, 18, 5)
        part(boxGeometry, 6, 11, 5, enemyMaterials.glass, 0, -8, 5)
        const engine = new Mesh(boxGeometry, enemyMaterials.engine)
        engine.scale.set(6, 4, 4)
        engine.position.set(0, 23, 0)
        group.add(engine)
        group.rotation.x = -0.3
        group.userData.flash = [hull, wing]
        group.userData.engine = engine
        return group
    }
    const buildEnvelope = () => {
        const side = enemyMaterials.envelopeSide
        const mesh = new Mesh(boxGeometry, [side, side, side, side, enemyMaterials.envelopeFace, side])
        mesh.scale.set(34, 24, 5)
        mesh.castShadow = true
        return mesh
    }

    // A cylinder's cap texture sits a quarter turn off once the disc faces the camera; turn it back.
    const uprightDisc = texture => {
        if (texture && texture.center) {
            texture.center.set(0.5, 0.5)
            texture.rotation = DISC_TEXTURE_TURN
        }
        return texture
    }
    // A box with a face: the shape most of the cast is made of.
    const card = (look, w, h, d) => {
        const mesh = new Mesh(boxGeometry, [look.edge, look.edge, look.edge, look.edge, look.face, look.edge])
        mesh.scale.set(w, h, d)
        mesh.castShadow = true
        return mesh
    }
    // A disc facing the camera (a badge, a clock).
    const disc = (look, radius, depth) => {
        uprightDisc(look.face.map)
        const mesh = new Mesh(cylinderGeometry, [look.edge, look.face, look.edge])
        mesh.rotation.x = Math.PI / 2
        mesh.scale.set(radius, depth, radius)
        mesh.castShadow = true
        return mesh
    }
    const buildCast = type => {
        const group = new Group()
        switch (type) {
            case 'chat': {
                const look = castLook('chat', chatTexture, '#BBD3F7')
                group.add(card(look, 46, 33, 7))
                const tail = new Mesh(spikeGeometry, look.edge)
                tail.position.set(-12, -19, 0)
                tail.rotation.z = Math.PI * 0.85
                group.add(tail)
                break
            }
            case 'ping':
                group.add(disc(castLook('ping', badgeTexture, '#B71C1C'), 15, 7))
                break
            case 'note':
            case 'noteSmall': {
                const size = type === 'note' ? 46 : 26
                group.add(card(castLook('note', noteTexture, '#F9C846'), size, size, 3))
                group.rotation.z = (random() - 0.5) * 0.5
                break
            }
            case 'mine': {
                const look = castLook('mine', checkboxTexture, '#A5D6A7')
                group.add(card(look, 36, 36, 9))
                const spikes = standard('#2E7D32')
                ;[0, 1, 2, 3].forEach(i => {
                    const spike = new Mesh(spikeGeometry, spikes)
                    const angle = (Math.PI / 2) * i + Math.PI / 4
                    spike.position.set(Math.cos(angle) * 24, Math.sin(angle) * 24, 0)
                    spike.rotation.z = angle - Math.PI / 2
                    spike.castShadow = true
                    group.add(spike)
                })
                group.userData.blink = look.edge
                break
            }
            case 'meeting': {
                group.add(card(castLook('meeting', calendarTexture, '#D1C4E9'), 70, 60, 12))
                const rings = standard('#5E35B1')
                ;[-18, 18].forEach(x => {
                    const ring = new Mesh(cylinderGeometry, rings)
                    ring.rotation.x = Math.PI / 2
                    ring.scale.set(4, 16, 4)
                    ring.position.set(x, 30, 4)
                    ring.castShadow = true
                    group.add(ring)
                })
                break
            }
            case 'deadline': {
                group.add(disc(castLook('deadline', clockTexture, '#BF360C'), 40, 14))
                const hand = standard('#3A2A1E')
                const makeHand = (length, width) => {
                    const pivot = new Group()
                    pivot.position.z = 8
                    const bar = new Mesh(boxGeometry, hand)
                    bar.scale.set(width, length, 3)
                    bar.position.y = length / 2 - 3
                    pivot.add(bar)
                    group.add(pivot)
                    return pivot
                }
                group.userData.hands = [makeHand(30, 3.5), makeHand(20, 5)]
                // Two little bells on top, like an alarm clock.
                ;[-26, 26].forEach(x => {
                    const bell = new Mesh(cylinderGeometry, castLook('deadline', clockTexture, '#BF360C').edge)
                    bell.rotation.x = Math.PI / 2
                    bell.scale.set(9, 6, 9)
                    bell.position.set(x, 34, 4)
                    group.add(bell)
                })
                break
            }
            case 'carrier':
                group.add(card(castLook('carrier', starCardTexture, '#FFB300'), 46, 32, 6))
                break
            default:
                return null
        }
        group.rotation.x = -0.3
        return group
    }

    /* Spawning. */
    const introduced = new Set()
    const spawnAirEnemy = spec => {
        const enemy = createEnemy(spec, missionDifficulty(run.mission), random)
        enemy.mesh =
            spec.type === 'mail' ? buildEnvelope() : spec.type === 'fighter' ? buildFighter() : buildCast(spec.type)
        enemy.spin = random() * Math.PI * 2
        scene.add(enemy.mesh)
        stepAirEnemy(enemy, 0, ship)
        airEnemies.push(enemy)
        // The first of a new kind is announced, with how to deal with it.
        if (INTRODUCED_TYPES.includes(spec.type) && !introduced.has(spec.type)) {
            introduced.add(spec.type)
            const text = strings.enemies && strings.enemies[spec.type]
            if (text) ui.showToast(`⚠️ ${text.name}: ${text.hint}`, 2.6)
            sound.announce()
        }
    }

    /* Power-ups. */
    const pickups = []
    const pickupLooks = {}
    const pickupLook = id => {
        if (!pickupLooks[id]) {
            const type = PICKUP_TYPES[id]
            pickupLooks[id] = {
                face: keep(new MeshBasicMaterial({ map: uprightDisc(keep(pickupTexture(type.icon, type.color))) })),
                edge: standard(type.color),
                halo: keep(
                    new MeshBasicMaterial({
                        map: textures.ring,
                        color: type.color,
                        transparent: true,
                        depthWrite: false,
                        opacity: 0.8,
                    })
                ),
            }
        }
        return pickupLooks[id]
    }
    /** A token tossed up from (x, y) that then drifts down the screen until collected or gone. */
    const spawnPickup = (id, x, y, toss = true) => {
        if (pickups.length >= MAX_PICKUPS) return
        const look = pickupLook(id)
        const group = new Group()
        const token = new Mesh(cylinderGeometry, [look.edge, look.face, look.edge])
        token.rotation.x = Math.PI / 2
        token.scale.set(17, 6, 17)
        token.castShadow = true
        const halo = new Mesh(unitPlane, look.halo)
        halo.renderOrder = 3
        halo.position.z = -2
        group.add(halo, token)
        scene.add(group)
        pickups.push({
            id,
            group,
            token,
            halo,
            x,
            y,
            vx: toss ? (random() - 0.5) * 140 : 0,
            vy: toss ? -120 - random() * 60 : 0,
            age: 0,
            phase: random() * Math.PI * 2,
        })
    }
    const dropFrom = (kind, x, y) =>
        rollDrops(kind, random, run).forEach((id, i) => spawnPickup(id, x + (i - 0.5) * 18, y))
    const removePickup = pickup => scene.remove(pickup.group)

    /* Buffs. */
    let buffs = createBuffs()
    const shieldBubble = new Mesh(
        keep(new SphereGeometry(1, 24, 16)),
        keep(new MeshBasicMaterial({ color: '#4FC3F7', transparent: true, opacity: 0.22, depthWrite: false }))
    )
    shieldBubble.renderOrder = 8
    shieldBubble.visible = false
    scene.add(shieldBubble)
    // The assistants: two little helper bots orbiting Anna while the pickup lasts.
    const drones = [0, 1].map(() => {
        const group = new Group()
        const body = new Mesh(boxGeometry, standard('#F4F6FB'))
        body.scale.set(16, 14, 10)
        body.castShadow = true
        const visor = new Mesh(boxGeometry, enemyMaterials.glass)
        visor.scale.set(12, 5, 3)
        visor.position.set(0, 1, 6)
        const antenna = new Mesh(boxGeometry, standard('#7E57C2'))
        antenna.scale.set(2, 2, 8)
        antenna.position.set(0, 5, 8)
        group.add(body, visor, antenna)
        group.scale.setScalar(1.35)
        group.visible = false
        scene.add(group)
        return { group, cooldown: 0, x: 0, y: 0 }
    })
    let lastBuffHud = -1
    let lastMultiplier = 1

    const removeAirEnemy = enemy => {
        scene.remove(enemy.mesh)
        if (enemy.mesh.isMesh) return
        ;(enemy.mesh.userData.flash || []).forEach(material => material.dispose())
        enemy.mesh.clear()
    }

    const turretClipped = clipped(turretMaterial.clone())
    const barrelClipped = clipped(barrelMaterial.clone())
    const placeBunker = bunker => {
        const color = bunker.color || BUNKER_COLORS[Math.floor(bunker.g) % BUNKER_COLORS.length]
        const texture = keep(bunkerTexture(bunker.label, color, bunker.armoured, bunker.w, bunker.h))
        const roof = clipped(new MeshBasicMaterial({ map: texture }))
        const side = clipped(
            new MeshStandardMaterial({ color: bunker.armoured ? '#262B38' : opaqueColor(color).multiplyScalar(0.7) })
        )
        const slab = new Mesh(boxGeometry, [side, side, side, side, roof, side])
        slab.scale.set(bunker.w, bunker.h, 14)
        slab.castShadow = true
        const group = new Group()
        group.add(slab)
        const turret = buildTurret()
        turret.group.position.set(-bunker.w / 2 + 21, 0, 10)
        turret.group.scale.setScalar(bunker.armoured ? 1.15 : 1)
        turret.group.traverse(node => {
            if (node.isMesh) node.material = node.material === turretMaterial ? turretClipped : barrelClipped
        })
        group.add(turret.group)
        group.position.set(bunker.x, bunker.g, Z.bunker)
        ground.add(group)
        const type = bunker.armoured ? 'armoured' : 'bunker'
        bunker.enemy = createEnemy({ type }, missionDifficulty(run.mission), random)
        bunker.model = { group, pivot: turret.pivot, texture, roof, side }
        bunker.texture = texture
        bunker.tint = color
    }
    const removeBunkerModel = bunker => {
        if (!bunker.model) return
        ground.remove(bunker.model.group)
        bunker.model = null
    }

    // The page's task rows that are on screen at take-off: holes and turrets drawn over them.
    const buildPageTargets = () => {
        pageGroup.clear()
        const top = 64
        let turrets = 0
        pageTargets = pageRows
            .filter(row => {
                const r = row.rect
                return r.width > 40 && r.height > 12 && r.top >= top && r.bottom <= viewport.height - 8
            })
            .map((row, index) => {
                const target = {
                    row,
                    rect: { left: row.rect.left, top: row.rect.top, width: row.rect.width, height: row.rect.height },
                    background: resolveBackgroundColor(row.element),
                    enemy: createEnemy({ type: 'pageTask' }, 1, random),
                    turret: null,
                    hole: null,
                }
                // Every other row is armed, so the page shoots back without becoming a wall of fire.
                if (index % 2 === 0 && turrets < MAX_PAGE_TURRETS) {
                    turrets += 1
                    target.turret = buildTurret()
                    target.turret.group.position.set(row.rect.left + 20, -(row.rect.top + row.rect.height / 2), 14)
                    target.turret.group.scale.setScalar(0.85)
                    pageGroup.add(target.turret.group)
                } else target.enemy.fireIn = Infinity
                return target
            })
    }
    const pageTargetCentre = target => ({
        x: target.rect.left + target.rect.width / 2,
        y: target.rect.top + target.rect.height / 2 + appliedPageOffset,
    })
    const holeMaterials = []

    /* Missions. */
    const startMission = (number, { fromPage = false, resumed = false } = {}) => {
        const difficulty = missionDifficulty(number)
        mission = buildMission({ mission: number, seed, tasks: levelTasks, width: viewport.width })
        if (typeof tuning.bossAt === 'number') {
            mission.bossAt = tuning.bossAt
            mission.waves = mission.waves.filter(wave => wave.at < tuning.bossAt)
        }
        if (tuning.noWaves) mission.waves = []
        if (Array.isArray(tuning.waves)) mission.waves = tuning.waves.map(wave => ({ ...wave }))
        mission.difficulty = difficulty
        missionTime = 0
        // Mission 1 starts at the page's top edge; later ones start just above the screen.
        missionOrigin = fromPage ? 0 : scroll + viewport.height
        pendingWaves = mission.waves.slice()
        pendingSpawns.length = 0
        bunkers.forEach(removeBunkerModel)
        bunkers = mission.bunkers.map(bunker => ({ ...bunker, g: missionOrigin + bunker.g, dead: false }))
        bossState = 'waiting'
        missionEndAt = null
        if (terrainTheme !== mission.theme) {
            terrainTheme = mission.theme
            clearTerrain()
        }
        hud.dataset.bunkers = String(bunkers.length)
        ui.showToast((resumed ? strings.continueAt : strings.missionStart).replace('{n}', number), 2.2)
        sound.missionStart()
        hudDirty = true
    }

    const bunkerScreenY = bunker => scroll - bunker.g

    /* Hostiles: one list for every shootable thing on screen this frame. */
    const hostiles = () => {
        const list = []
        airEnemies.forEach(enemy => {
            if (enemy.hp > 0 && enemy.y > -20)
                list.push({ kind: 'air', ref: enemy, x: enemy.x, y: enemy.y, r: enemy.radius })
        })
        bunkers.forEach(bunker => {
            if (bunker.dead || !bunker.model) return
            const y = bunkerScreenY(bunker)
            if (y < -bunker.h || y > viewport.height + bunker.h) return
            list.push({ kind: 'bunker', ref: bunker, x: bunker.x, y, halfW: bunker.w / 2, halfH: bunker.h / 2 })
        })
        pageTargets.forEach(target => {
            if (target.enemy.hp <= 0) return
            const centre = pageTargetCentre(target)
            if (centre.y > viewport.height + 20) return
            list.push({
                kind: 'page',
                ref: target,
                x: centre.x,
                y: centre.y,
                halfW: target.rect.width / 2,
                halfH: target.rect.height / 2,
            })
        })
        if (boss && boss.hp > 0) list.push({ kind: 'boss', ref: boss, x: boss.x, y: boss.y })
        return list
    }
    const hits = (hostile, x, y, r) => {
        if (hostile.kind === 'air') return Math.hypot(hostile.x - x, hostile.y - y) <= hostile.r + r
        if (hostile.kind === 'boss') return insideRaidBoss(hostile.ref, x, y, r)
        return Math.abs(hostile.x - x) <= hostile.halfW + r && Math.abs(hostile.y - y) <= hostile.halfH + r
    }

    const EXPLOSION_SIZE = {
        mail: 0.7,
        ping: 0.7,
        noteSmall: 0.6,
        note: 0.9,
        chat: 0.9,
        mine: 1,
        meeting: 1.7,
        deadline: 2.4,
        carrier: 1.2,
    }
    // A kill feeds the combo; the gold star doubles whatever the combo is worth.
    const killMultiplier = () => registerKill(run, time) * (isActive(buffs, 'star', time) ? 2 : 1)

    const damageHostile = (hostile, amount) => {
        if (hostile.kind === 'boss') {
            if (damageRaidBoss(hostile.ref, amount)) killBoss()
            return
        }
        const enemy = hostile.kind === 'air' ? hostile.ref : hostile.ref.enemy
        if (!damageEnemy(enemy, amount)) {
            if (enemy.hp > 0) sound.hit()
            return
        }
        const multiplier = killMultiplier()
        if (hostile.kind === 'air') {
            recordKill(run, enemy.type, multiplier)
            explode(hostile.x, hostile.y, EXPLOSION_SIZE[enemy.type] || 1.1)
            dropFrom(enemy.type, hostile.x, hostile.y)
            splitSpecs(enemy, viewport).forEach(spec => spawnAirEnemy(spec))
            if (enemy.type === 'mine')
                mineBurst(enemy, false, missionDifficulty(run.mission)).forEach(shot =>
                    enemyShots.push({ ...shot, r: 7, damage: DAMAGE.bullet })
                )
            if (enemy.type === 'deadline') {
                flashScreen(0.4)
                for (let i = 0; i < 4; i++)
                    explode(hostile.x + (random() - 0.5) * 70, hostile.y + (random() - 0.5) * 70, 1.2)
            }
        } else if (hostile.kind === 'bunker') {
            const bunker = hostile.ref
            bunker.dead = true
            recordKill(run, bunker.armoured ? 'armoured' : 'bunker', multiplier)
            dropFrom(bunker.armoured ? 'armoured' : 'bunker', hostile.x, hostile.y)
            explode(hostile.x, hostile.y, bunker.armoured ? 1.7 : 1.3)
            addWreck(hostile.x, hostile.y, bunker.w, bunker.h, bunker.armoured ? '#3A4152' : bunker.tint)
            shatter(bunker.texture, {
                left: hostile.x - bunker.w / 2,
                top: hostile.y - bunker.h / 2,
                width: bunker.w,
                height: bunker.h,
            })
            removeBunkerModel(bunker)
        } else {
            destroyPageTarget(hostile.ref, hostile)
        }
        hudDirty = true
    }

    const destroyPageTarget = (target, hostile) => {
        recordKill(run, 'pageTask', killMultiplier())
        dropFrom('pageTask', hostile.x, hostile.y)
        const material = new MeshBasicMaterial({
            color: opaqueColor(target.background),
            transparent: true,
            depthWrite: false,
        })
        holeMaterials.push(keep(material))
        const hole = new Mesh(unitPlane, material)
        hole.scale.set(target.rect.width + 2, target.rect.height + 2, 1)
        hole.position.set(target.rect.left + target.rect.width / 2, -(target.rect.top + target.rect.height / 2), Z.page)
        pageGroup.add(hole)
        target.hole = hole
        if (target.turret) pageGroup.remove(target.turret.group)
        const rect = {
            left: target.rect.left,
            top: hostile.y - target.rect.height / 2,
            width: target.rect.width,
            height: target.rect.height,
        }
        if (target.row.style)
            shatter(
                keep(rowTexture({ ...target.row, background: target.background }, rect.width, rect.height)),
                rect,
                0.8
            )
        explode(hostile.x - target.rect.width / 2 + 24, hostile.y, 0.9)
    }

    const killBoss = () => {
        const openTasks = boss.openTasks
        run.score += 25 * openTasks
        recordKill(run, 'boss', killMultiplier())
        sound.bossDown()
        dropFrom('boss', boss.x, boss.y)
        for (let i = 0; i < 6; i++)
            setTimeout(() => {
                if (!finished && bossModel)
                    explode(boss.x + (random() - 0.5) * 140, boss.y + (random() - 0.5) * 110, 1.6)
            }, i * 160)
        explode(boss.x, boss.y, 2.4)
        flashScreen(0.7)
        ui.showToast(`🏆 ${strings.bossDefeated}`, 2.2)
        bossState = 'dead'
        clearHazards()
        ui.bossBar.style.display = 'none'
        setTimeout(() => removeBoss(), 900)
        finishMission()
        hudDirty = true
    }

    const removeBoss = () => {
        if (bossModel) {
            scene.remove(bossModel.group)
            bossModel.dispose()
            bossModel = null
        }
        if (boss && boss.hp <= 0) boss = null
    }

    const summonBoss = () => {
        // Every mission ends with the boss — on an empty inbox too. It is equally hard every day;
        // the open-task count is only what it wears on its chest.
        // Five different bosses, one per mission in turn (raidBosses.js).
        const openTasks = Math.max(0, Math.round(services.getOpenTasksToday ? services.getOpenTasksToday() || 0 : 0))
        const kind = tuning.bossKind || bossKindFor(run.mission)
        const hp =
            typeof tuning.bossHp === 'number' ? tuning.bossHp : Math.round(BOSS_HP * missionDifficulty(run.mission))
        boss = createRaidBoss(kind, openTasks, viewport, hp)
        bossModel = buildRaidBossModel(boss.kind, strings.bossCaption)
        bossModel.setCount(openTasks)
        scene.add(bossModel.group)
        bossState = 'active'
        const name = (strings.bosses && strings.bosses[boss.kind]) || strings.bossIncoming
        ui.showToast(`⚠️ ${name}`, 2.4)
        ui.bossBar.style.display = 'flex'
        ui.bossLabel.textContent = `${name} · ${strings.bossName.replace('{count}', openTasks)}`
        hud.dataset.bossKind = boss.kind
        flashScreen(0.35)
        shake = Math.min(16, shake + 8)
        sound.bossArrive(boss.kind)
    }

    const finishMission = () => {
        if (missionEndAt !== null) return
        missionEndAt = time + MISSION_END_DELAY
    }

    /* Firing. */
    const muzzle = () => ({ x: ship.x, y: ship.y - MUZZLE_OFFSET })
    const fireMainGun = () => {
        const gun = mainGun(run.cannonLevel)
        const from = muzzle()
        // A brainstorm fans the gun out: four extra bolts on wider angles.
        const barrels = isActive(buffs, 'spread', time)
            ? [
                  ...gun.barrels,
                  { dx: -14, angle: UP - 0.3 },
                  { dx: 14, angle: UP + 0.3 },
                  { dx: -18, angle: UP - 0.55 },
                  { dx: 18, angle: UP + 0.55 },
              ]
            : gun.barrels
        barrels.forEach(barrel =>
            shots.push({
                x: from.x + barrel.dx,
                y: from.y,
                vx: Math.cos(barrel.angle) * MAIN_GUN_SPEED,
                vy: Math.sin(barrel.angle) * MAIN_GUN_SPEED,
                damage: MAIN_GUN_DAMAGE,
                r: 6,
                life: 2,
                age: 0,
                kind: 'bolt',
            })
        )
        shotsFired += barrels.length
        hud.dataset.shots = String(shotsFired)
        addPuff(from.x - 9, from.y + 2, 11, { life: 0.07 })
        addPuff(from.x + 9, from.y + 2, 11, { life: 0.07 })
        volleyCount += 1
        sound.gun(run.cannonLevel)
        return gun.interval * fireIntervalFactor(buffs, time)
    }

    const fireSpecial = weapon => {
        const from = muzzle()
        switch (weapon.kind) {
            case 'bolt':
                specialAngles(weapon).forEach(angle =>
                    shots.push({
                        x: from.x,
                        y: from.y,
                        vx: Math.cos(angle) * weapon.speed * 0.75,
                        vy: Math.sin(angle) * weapon.speed * 0.75,
                        damage: weapon.damage,
                        r: 5,
                        life: (weapon.range || 600) / (weapon.speed * 0.75),
                        age: 0,
                        kind: 'pellet',
                    })
                )
                sound.weapon('bolt')
                break
            case 'rocket': {
                rocketSide = -rocketSide
                const mesh = new Group()
                const body = new Mesh(boxGeometry, enemyMaterials.hull)
                body.scale.set(6, 18, 6)
                const tip = new Mesh(boxGeometry, enemyMaterials.accent)
                tip.scale.set(6, 6, 6)
                tip.position.y = 11
                mesh.add(body, tip)
                scene.add(mesh)
                sound.weapon('rocket')
                rockets.push({
                    mesh,
                    x: ship.x + rocketSide * 18,
                    y: ship.y - 10,
                    angle: UP,
                    speed: weapon.speed * 0.8,
                    damage: weapon.damage,
                    blast: weapon.blast,
                    age: 0,
                    trail: 0,
                })
                break
            }
            case 'flame':
                sound.weapon('flame')
                for (let i = 0; i < 2; i++) {
                    const angle = UP + (random() - 0.5) * weapon.spread * 2
                    shots.push({
                        x: from.x,
                        y: from.y + 6,
                        vx: Math.cos(angle) * weapon.speed,
                        vy: Math.sin(angle) * weapon.speed,
                        damage: weapon.damage,
                        r: 14,
                        life: weapon.range / weapon.speed,
                        age: 0,
                        kind: 'flame',
                        hit: new Set(),
                    })
                }
                break
            case 'blackhole': {
                const core = new Mesh(unitPlane, keep(new MeshBasicMaterial({ color: '#2A1B4F', transparent: true })))
                const ring = new Mesh(
                    unitPlane,
                    keep(
                        new MeshBasicMaterial({
                            map: textures.ring,
                            color: '#B39DDB',
                            transparent: true,
                            depthWrite: false,
                        })
                    )
                )
                core.renderOrder = 6
                ring.renderOrder = 6
                scene.add(core, ring)
                sound.weapon('blackhole')
                blackholes.push({ core, ring, x: from.x, y: from.y, age: 0, weapon })
                break
            }
            case 'snap': {
                const targets = hostiles()
                if (!targets.length) return 0.5
                flashScreen(0.85)
                shake = Math.min(16, shake + 10)
                targets.forEach(hostile => {
                    addSparks(hostile.x, hostile.y, 6)
                    damageHostile(hostile, weapon.damage)
                })
                sound.weapon('snap')
                break
            }
            default:
                break
        }
        return weapon.interval
    }

    const updateLaser = (weapon, dt) => {
        const active = weapon.kind === 'laser' && (phase === 'flying' || phase === 'cleared') && !greeting
        laserGroup.visible = active
        sound.laser(active && !paused)
        if (!active) return
        const from = muzzle()
        const length = from.y + 20
        laserGlow.scale.set(weapon.radius + 6, length, 1)
        laserCore.scale.set(Math.max(2, weapon.radius / 3), length, 1)
        laserGlow.position.set(from.x, -(from.y - length / 2), Z.playerShot)
        laserCore.position.set(from.x, -(from.y - length / 2), Z.playerShot + 1)
        laserGlow.material.color.set(Math.floor(time * 20) % 2 ? '#FF3B30' : '#FF6A4D')
        laserTick -= dt
        if (laserTick > 0) return
        laserTick = weapon.interval
        hostiles().forEach(hostile => {
            if (hostile.y > from.y) return
            const halfW =
                hostile.kind === 'air' ? hostile.r : hostile.kind === 'boss' ? hostile.ref.halfWidth : hostile.halfW
            if (Math.abs(hostile.x - from.x) > halfW + weapon.radius) return
            damageHostile(hostile, weapon.damage)
            if (random() < 0.4) addSparks(hostile.x + (random() - 0.5) * 10, hostile.y + 10, 1, 0.5)
        })
    }

    /* Bombs. */
    const bombRings = []
    const dropBomb = () => {
        if (phase !== 'flying' && phase !== 'cleared') return
        if (!useBomb(run)) return
        hudDirty = true
        flashScreen(0.9)
        shake = 18
        sound.bomb()
        enemyShots.length = 0
        // A bomb also blows away shockwaves and beams that have not fired yet.
        waves.splice(0).forEach(removeWave)
        for (let i = beams.length - 1; i >= 0; i--)
            if (beams[i].age < BEAM_WARN) {
                removeBeam(beams[i])
                beams.splice(i, 1)
            }
        const ring = new Mesh(
            unitPlane,
            keep(new MeshBasicMaterial({ map: textures.ring, transparent: true, depthWrite: false }))
        )
        ring.renderOrder = 7
        scene.add(ring)
        bombRings.push({ mesh: ring, x: ship.x, y: ship.y, age: 0 })
        hostiles().forEach(hostile => {
            explode(hostile.x, hostile.y, 0.8)
            damageHostile(hostile, hostile.kind === 'boss' ? 50 : 999)
        })
        hud.dataset.bombsDropped = String(Number(hud.dataset.bombsDropped || 0) + 1)
    }

    /* Damage to Anna. */
    const hurtShip = amount => {
        if (tuning.invincible || phase !== 'flying') return
        if (isActive(buffs, 'shield', time)) {
            addSparks(ship.x, ship.y - 10, 6, 0.6)
            return
        }
        const result = applyDamage(run, amount, time)
        if (!result.hit) return
        hudDirty = true
        sound.hurt()
        if (run.shield < run.maxShield * 0.25) sound.alarm()
        shake = Math.min(14, shake + 6)
        addSparks(ship.x, ship.y, 10)
        if (result.dead) gameOver()
    }

    /* Shop (Gold weapons) — opened from the hangar. */
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
        zIndex: Z_INDEX + 5,
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

    const equip = id => {
        if (!owned.has(id)) return
        if (equipped !== id) sound.click()
        equipped = id
        writeStoredWeapon(id)
        specialCooldown = 0
        ui.renderWeapons(RAGE_WEAPONS, owned, equipped)
        if (shopUi.isOpen()) shopUi.render()
    }

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
                    sound.purchase()
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
    // The shop opens from the hangar or in the middle of a mission (🛒 or B); while it is open
    // the game is paused, so browsing can never get her killed.
    const openShop = () => {
        if (shopUi.isOpen() || !['hangar', 'flying', 'cleared', 'gameover'].includes(phase)) return
        if (phase === 'flying' || phase === 'cleared') paused = true
        held.clear()
        sound.whoosh()
        sound.engine(0)
        sound.laser(false)
        shopConfirm = null
        shopMessage = null
        shopUi.open()
        hud.dataset.shop = 'open'
        hud.dataset.paused = paused ? 'true' : 'false'
    }
    const closeShop = () => {
        if (!shopUi.isOpen()) return
        shopUi.close()
        delete hud.dataset.shop
        paused = false
        hud.dataset.paused = 'false'
        lastTimestamp = 0
        resetSteering()
    }

    /* Hangar. */
    let debrief = null
    let hangarMessage = null
    const openHangar = () => {
        setPhase('hangar')
        cancelGreeting()
        sound.engine(0)
        sound.laser(false)
        sound.missionComplete()
        buffs = createBuffs()
        ui.setBuffs([])
        debrief = completeMission(run)
        saveProgress()
        hangarMessage = null
        laserGroup.visible = false
        enemyShots.length = 0
        ui.hangar.show({ run, debrief, message: null })
        hudDirty = true
        // The next sector's ground is already visible behind the hangar.
        const nextTheme = run.mission % THEMES.length
        if (terrainTheme !== nextTheme) {
            terrainTheme = nextTheme
            clearTerrain()
        }
    }
    const buyFromHangar = id => {
        if (phase !== 'hangar') return
        const result = buyHangarItem(run, id)
        hangarMessage = result.ok ? null : result.reason === 'credits' ? { id, text: strings.notEnoughCredits } : null
        if (result.ok) {
            sound.purchase()
            saveProgress()
        }
        ui.hangar.update({ run, message: hangarMessage })
        hudDirty = true
    }
    const launchNextMission = () => {
        if (phase !== 'hangar') return
        closeShop()
        ui.hangar.hide()
        resetSteering()
        startNextMission(run)
        setPhase('flying')
        scrollRamp = 0.5
        startMission(run.mission)
    }

    /* Score, game over, another go. */
    const submitScore = () => {
        if (scoreSubmitted) return false
        scoreSubmitted = true
        const final = run.score
        const wasNew = final > best
        best = Math.max(best, final)
        if (final <= 0 || !services.submitScore) return wasNew
        Promise.resolve()
            .then(() => services.submitScore(final))
            .then(result => {
                if (!result || !result.ok) return
                best = Math.max(best, result.highscore || 0)
                if (!finished) ui.gameOver.update({ best, isNew: !!result.isNew })
            })
            .catch(() => {})
        return wasNew
    }

    const gameOver = () => {
        cancelGreeting()
        sound.engine(0)
        sound.laser(false)
        sound.gameOver()
        setPhase('gameover')
        gameOverAt = time
        gameOverShown = false
        laserGroup.visible = false
        explode(ship.x, ship.y, 2)
        flashScreen(0.5)
        shipNode.visible = false
        lastRoundNew = submitScore()
    }

    const clearBattlefield = ({ withExplosions = false } = {}) => {
        airEnemies.splice(0).forEach(enemy => {
            if (withExplosions && enemy.y > 0 && enemy.y < viewport.height) explode(enemy.x, enemy.y, 0.6)
            removeAirEnemy(enemy)
        })
        pendingSpawns.length = 0
        pendingWaves = []
        enemyShots.length = 0
        shots.length = 0
        rockets.splice(0).forEach(rocket => scene.remove(rocket.mesh))
        blackholes.splice(0).forEach(hole => scene.remove(hole.core, hole.ring))
        bunkers.forEach(removeBunkerModel)
        bunkers = []
        if (bossModel) {
            if (withExplosions && boss) explode(boss.x, boss.y, 1.4)
            scene.remove(bossModel.group)
            bossModel.dispose()
            bossModel = null
        }
        boss = null
        ui.bossBar.style.display = 'none'
        laserGroup.visible = false
        pickups.splice(0).forEach(removePickup)
        clearHazards()
        buffs = createBuffs()
        shieldBubble.visible = false
        drones.forEach(drone => {
            drone.group.visible = false
        })
        inputLayer.style.boxShadow = 'none'
        delete inputLayer.dataset.slow
        ui.setBuffs([])
        ui.setCombo(0, 1)
    }

    const playAgain = () => {
        if (phase !== 'gameover') return
        ui.gameOver.hide()
        relaunch()
    }

    // Another go from the checkpoint (or from mission 1 when there is none).
    const relaunch = () => {
        clearBattlefield()
        run = freshRun()
        scoreSubmitted = false
        ship.x = viewport.width / 2
        ship.y = viewport.height * FLY_Y
        resetSteering()
        shipNode.visible = true
        setPhase('flying')
        scrollRamp = 0.5
        startMission(run.mission, { resumed: !!checkpoint })
        hudDirty = true
    }

    /** Forget the saved progress and fly again from mission 1. */
    const startOver = () => {
        if (phase === 'takeoff' || phase === 'returning' || phase === 'done') return
        cancelGreeting()
        submitScore()
        storeProgress(null)
        closeShop()
        ui.hangar.hide()
        ui.gameOver.hide()
        relaunch()
        ui.showToast(strings.missionStart.replace('{n}', 1), 2)
    }
    // The ↺ in the status pill asks twice: a stray tap must not throw away five missions.
    const requestStartOver = () => {
        if (time < startOverArmedUntil) {
            startOverArmedUntil = -Infinity
            startOver()
            return
        }
        startOverArmedUntil = time + START_OVER_CONFIRM_SECONDS
        ui.showToast(strings.confirmStartOver, START_OVER_CONFIRM_SECONDS)
    }

    /* Leaving: everything flies home and the page slides back up under the ground. */
    const beginReturn = () => {
        if (phase === 'returning' || phase === 'done') return
        cancelGreeting()
        resetRig()
        liftoffAt = -Infinity
        submitScore()
        closeShop()
        ui.hangar.hide()
        ui.gameOver.hide()
        clearBattlefield({ withExplosions: true })
        held.clear()
        returnFrom = appliedPageOffset
        // The ground stays where it is; the seam moves to the bottom of the screen and rises.
        returnSeam = scroll - returnFrom
        seamG = returnSeam
        returnStart = time
        ui.weaponBar.style.opacity = '0'
        ui.help.style.opacity = '0'
        hud.style.transition = 'opacity 300ms ease'
        hud.style.opacity = '0'
        shipNode.visible = true
        setPhase('returning')
        sound.engine(0)
        sound.laser(false)
        sound.whoosh()
    }

    const updateReturn = () => {
        const elapsed = time - returnStart
        const k = easeInOut(clamp01(elapsed / RETURN_SECONDS))
        const pageTop = returnFrom * (1 - k)
        renderScroll = returnSeam + pageTop
        setPageOffset(pageTop)
        pageGroup.position.y = -pageTop
        const home = launch
        const shrink = 1 - k * (1 - launchScale)
        positionShip(ship.x + (home.x - ship.x) * k, ship.y + (home.y - ship.y) * k, shrink)
        if (elapsed >= RETURN_SECONDS) {
            const fade = clamp01((elapsed - RETURN_SECONDS) / HOLE_FADE_SECONDS)
            holeMaterials.forEach(material => {
                material.opacity = 1 - fade
            })
            pageGroup.children.forEach(child => {
                if (!child.material || !holeMaterials.includes(child.material)) child.visible = false
            })
            shipNode.visible = false
            if (fade >= 1) finish()
        }
    }

    /*
     * The greeting (Enter, or 👋): ONE loop towards the camera (`rageGreeting.js`). She turns from
     * flying away up the screen to face you, rises and grows to the front of the loop — growing is
     * what "towards the camera" means to an orthographic camera — greets with a pose and a speech
     * bubble, and drops back into formation. She stays steerable throughout (the loop is an OFFSET
     * from wherever you fly her) but does not shoot.
     */
    const removeBubble = () => {
        if (!bubble) return
        scene.remove(bubble.mesh)
        bubble.mesh.material.map.dispose()
        bubble.mesh.material.dispose()
        bubble = null
    }
    const resetRig = () => {
        shipNode.rotation.set(0.5, 0, 0)
        character.root.rotation.set(0, 0, 0)
        character.yaw.rotation.set(0, Math.PI / 2, 0)
        character.arm.rotation.set(0, 0, Math.PI / 2)
        character.rearArm.rotation.set(0.15, 0, 0)
        character.head.rotation.set(0, 0, 0)
        character.legs.forEach(leg => leg.rotation.set(0, 0, 0))
    }
    const cancelGreeting = () => {
        if (!greeting) return
        greeting = null
        delete hud.dataset.greeting
        removeBubble()
        resetRig()
    }
    const startGreeting = () => {
        if ((phase !== 'flying' && phase !== 'cleared') || greeting) return
        const style = pickGreetingStyle(random, lastGreetingStyle)
        lastGreetingStyle = style
        const lines = strings.greetings && strings.greetings.length ? strings.greetings : ['Hi! 👋']
        const { texture, width, height } = bubbleTexture(lines[Math.floor(random() * lines.length)])
        removeBubble()
        const mesh = new Mesh(
            unitPlane,
            new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false })
        )
        mesh.renderOrder = 9
        mesh.visible = false
        scene.add(mesh)
        bubble = { mesh, width, height }
        // Observable from outside (browser-tests/rage-mode waits on it rather than guessing a delay).
        hud.dataset.greeting = style
        greeting = {
            t: 0,
            plan: {
                start: { x: ship.x, y: ship.y, z: 0, yaw: Math.PI / 2, facing: 1 },
                stage: { x: viewport.width / 2, y: viewport.height * 0.5 },
                // `z` runs 0 → 1 towards the front of the loop; it becomes her size, see below.
                closeZ: 1,
                style,
            },
        }
        sound.greet()
    }
    const updateGreeting = dt => {
        greeting.t += dt
        const { plan } = greeting
        const loop = greetingPose(greeting.t, plan)
        const t = greeting.t
        const holdEnd = GREETING_TIMING.in + GREETING_TIMING.hold
        const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2)
        // How far she has turned from her flying rig into the upright greeting rig.
        const blend =
            t < GREETING_TIMING.in
                ? ease(clamp01(t / GREETING_TIMING.in))
                : t < holdEnd
                  ? 1
                  : 1 - ease(clamp01((t - holdEnd) / GREETING_TIMING.out))
        const scale = 1 + GREETING_GROW * clamp01(loop.z)
        // Keep all of her on screen while she is big.
        const half = (ANNA_HEIGHT / 2) * scale
        const x = Math.max(half * 0.6, Math.min(viewport.width - half * 0.6, ship.x + loop.x - plan.start.x))
        const y = Math.max(half, Math.min(viewport.height - half * 0.7, ship.y + loop.y - plan.start.y))
        toWorld(shipNode, x, y, Z.ship + 180 * clamp01(loop.z))
        shipNode.scale.setScalar(scale)
        shipNode.rotation.set(0.5 * (1 - blend), 0, 0)
        bank.rotation.y = bankAngle * (1 - blend)
        character.root.rotation.set(loop.pitch, 0, loop.roll)
        character.yaw.rotation.set(0, loop.yaw, 0)
        character.arm.rotation.set(loop.armSpread, 0, loop.armPitch + (Math.PI / 2) * (1 - blend))
        character.rearArm.rotation.set(loop.rearArm, 0, 0)
        character.head.rotation.set(loop.headTilt, 0, 0)
        const flicker = 0.8 + Math.random() * 0.4
        character.flames.forEach(flame => flame.scale.set(1, flicker, 1))

        if (bubble) {
            // A little overshoot as it pops in; a fixed size (it is text), beside her head, and slid
            // inwards rather than off screen near an edge.
            const pop = loop.bubble < 1 ? loop.bubble * (1 + 0.25 * Math.sin(Math.PI * loop.bubble)) : 1
            const size = BUBBLE_SCALE * pop
            const halfWidth = (bubble.width / 2) * size
            const halfHeight = (bubble.height / 2) * size
            const tipX = x + 16 * scale
            const tipY = y - (ANNA_HEIGHT / 2) * scale
            bubble.mesh.visible = loop.bubble > 0.01
            bubble.mesh.scale.set(bubble.width * size, bubble.height * size, 1)
            toWorld(
                bubble.mesh,
                Math.max(halfWidth + 8, Math.min(viewport.width - halfWidth - 8, tipX + halfWidth - 20 * size)),
                Math.max(halfHeight + 8, tipY - halfHeight),
                Z.flash - 10
            )
        }
        if (loop.done) cancelGreeting()
    }

    /*
     * Clouds: a few soft white puffs drifting over the ground (never over the page), a little faster
     * than the ground itself so they read as higher up.
     */
    const clouds = []
    const spawnCloud = y => {
        const group = new Group()
        const puffsInCloud = 3 + Math.floor(random() * 3)
        const width = 100 + random() * 130
        for (let i = 0; i < puffsInCloud; i++) {
            const puff = new Mesh(unitPlane, cloudMaterial)
            const size = width * (0.45 + random() * 0.4)
            puff.scale.set(size, size * 0.8, 1)
            puff.position.set((random() - 0.5) * width * 0.8, (random() - 0.5) * width * 0.22, i * 0.1)
            group.add(puff)
        }
        group.renderOrder = 2
        scene.add(group)
        clouds.push({ group, x: random() * viewport.width, y, drift: (random() - 0.5) * 12 })
    }
    for (let i = 0; i < CLOUD_COUNT; i++) spawnCloud(-150 - random() * viewport.height * 1.5)
    const updateClouds = dt => {
        clouds.forEach(cloud => {
            cloud.y += scrollDelta * 1.35
            cloud.x += cloud.drift * dt
            if (cloud.y > viewport.height + 180) {
                cloud.y = -180 - random() * 300
                cloud.x = random() * viewport.width
            }
            toWorld(cloud.group, cloud.x, cloud.y, Z.cloud)
        })
    }

    /*
     * The run-up. Anna lands on the page from her avatar and RUNS — legs pumping, jetpack sputtering
     * — while the page starts to move under her, slowly at first. Then the jetpack fires: a burst of
     * dust, she rises (her real shadow slides away from her feet), tips forward into flight, and the
     * ground picks up speed. The mission itself starts at lift-off.
     */
    const runPose = (elapsed, amount) => {
        const cadence = 8 + 12 * clamp01(elapsed / RUNUP_MIN_SECONDS) ** 1.3
        const swing = Math.sin(elapsed * cadence) * 0.9 * amount
        character.legs[0].rotation.z = swing
        character.legs[1].rotation.z = -swing
        character.rearArm.rotation.set(0.15, 0, -swing * 0.7)
        character.arm.rotation.z = Math.PI / 2 - (Math.PI / 2 - 0.35 + swing * 0.25) * amount
        character.head.rotation.set(0, 0, Math.sin(elapsed * cadence * 2) * 0.05 * amount)
        return Math.abs(Math.sin(elapsed * cadence)) * 5 * amount
    }
    const updateRunup = dt => {
        const elapsed = time - runupStart
        const k = clamp01(elapsed / RUNUP_MIN_SECONDS)
        // You can steer her across the page; up it, she runs on her own.
        const thrust = moveVector(held)
        stepShip(ship, { thrust: { x: thrust.x, y: 0 }, target: steerTarget() }, dt, viewport)
        ship.y = viewport.height * (RUNUP_START_Y + (FLY_Y - RUNUP_START_Y) * easeInOut(k))
        bankAngle *= 1 - Math.min(1, dt * 8)
        const bob = runPose(elapsed, 1)
        // A footstep every time a foot comes down (twice per stride).
        const cadence = 8 + 12 * k ** 1.3
        const stride = Math.floor((elapsed * cadence) / Math.PI)
        if (stride !== lastStride) {
            lastStride = stride
            sound.step(k)
        }
        shipNode.rotation.x = RUN_TILT
        // The jetpack coughs at first and roars into life as she picks up speed.
        const sputter = 0.15 + 0.6 * k * k + (Math.random() < 0.15 ? 0.35 : 0)
        positionShip(ship.x, ship.y - bob, RUN_SCALE, Z.shipGround, sputter)
        shake = Math.max(shake, k * k * 2.5)
        runupPuffIn -= dt
        if (runupPuffIn <= 0) {
            // Kicked-up dust, faster and further the faster she runs.
            runupPuffIn = 0.22 - 0.16 * k
            addPuff(ship.x + (random() - 0.5) * 10, ship.y + 22, 8 + random() * 6 + k * 8, {
                life: 0.5 + k * 0.4,
                smoke: true,
                vx: (random() - 0.5) * 40,
                vy: 40 + k * 260,
            })
        }
        if (elapsed >= RUNUP_MIN_SECONDS && (progressSettled || elapsed >= RUNUP_MAX_SECONDS)) liftOff()
    }
    const liftOff = () => {
        setPhase('flying')
        liftoffAt = time
        scrollRamp = RUNUP_SCROLL_TO
        // Ignition: a ring of dust and a burst of exhaust at her feet.
        addRing(ship.x, ship.y + 16, 150, 0.55, 0.5)
        for (let i = 0; i < 14; i++) {
            const angle = (i / 14) * Math.PI * 2
            addPuff(ship.x + Math.cos(angle) * 10, ship.y + 18 + Math.sin(angle) * 6, 30 + random() * 14, {
                life: 0.7,
                smoke: true,
                vx: Math.cos(angle) * 90,
                vy: Math.sin(angle) * 50 + 30,
            })
        }
        addPuff(ship.x, ship.y + 20, 30, { life: 0.25 })
        shake = Math.min(14, shake + 5)
        sound.ignition()
        startMission(run.mission, { fromPage: true, resumed: !!checkpoint })
        ;(tuning.pickups || []).forEach((id, i) => spawnPickup(id, ship.x + (i - 0.5) * 6, ship.y - 4, false))
    }
    // 0 → 1 over the lift-off; 1 when she is flying normally.
    const liftoffProgress = () => clamp01((time - liftoffAt) / LIFTOFF_SECONDS)

    /* Per-frame updates. */
    const positionShip = (x, y, scale = 1, z = Z.ship, thrust = 1) => {
        toWorld(shipNode, x, y, z)
        shipNode.scale.setScalar(scale)
        bank.rotation.y = bankAngle
        const flicker = (0.8 + Math.random() * 0.4) * thrust
        character.flames.forEach(flame => flame.scale.set(Math.min(1.3, 0.6 + thrust * 0.4), flicker, 1))
    }

    const updateShip = dt => {
        const thrust = moveVector(held)
        stepShip(ship, { thrust, target: steerTarget() }, dt, viewport)
        bankAngle += (Math.max(-0.7, Math.min(0.7, ship.vx / 900)) - bankAngle) * Math.min(1, dt * 8)
        const lift = liftoffProgress()
        if (greeting) updateGreeting(dt)
        else if (lift < 1) {
            const k = easeInOut(lift)
            runPose(time - runupStart, 1 - k)
            shipNode.rotation.x = RUN_TILT + (0.5 - RUN_TILT) * k
            positionShip(
                ship.x,
                ship.y,
                RUN_SCALE + (1 - RUN_SCALE) * k,
                Z.shipGround + (Z.ship - Z.shipGround) * k,
                1.6 - 0.6 * k
            )
        } else positionShip(ship.x, ship.y)
        shipNode.visible = !isBlinking(run, time) || Math.floor(time * 14) % 2 === 0
        const shipX = String(Math.round(ship.x))
        if (hud.dataset.shipX !== shipX) hud.dataset.shipX = shipX
    }

    const updateScroll = dt => {
        let factor
        if (phase === 'runup') {
            // Running: the page starts to move under her, slowly, a little faster with every step.
            const k = clamp01((time - runupStart) / RUNUP_MIN_SECONDS)
            factor = RUNUP_SCROLL_FROM + (RUNUP_SCROLL_TO - RUNUP_SCROLL_FROM) * k * k
        } else {
            // In the air: the ground picks up speed until it reaches the mission's own.
            scrollRamp = Math.min(1, scrollRamp + dt / SCROLL_RAMP_SECONDS)
            factor = scrollRamp * (phase === 'hangar' ? 0.35 : bossState === 'active' ? 0.5 : 1)
        }
        const before = scroll
        scroll += (mission ? mission.scrollSpeed : SCROLL_SPEED) * factor * dt
        scrollDelta = scroll - before
        renderScroll = scroll
        seamG = 0
        const offset = Math.min(scroll, pageCap())
        setPageOffset(offset)
        pageGroup.position.y = -appliedPageOffset
        hud.dataset.pageOffset = String(Math.round(appliedPageOffset))
    }

    const updateMission = dt => {
        missionTime += dt
        while (pendingWaves.length && pendingWaves[0].at <= missionTime) {
            const wave = pendingWaves.shift()
            expandWave(wave, viewport).forEach(spec => pendingSpawns.push({ at: wave.at + spec.delay, spec }))
        }
        for (let i = pendingSpawns.length - 1; i >= 0; i--) {
            if (pendingSpawns[i].at <= missionTime) {
                spawnAirEnemy(pendingSpawns[i].spec)
                pendingSpawns.splice(i, 1)
            }
        }
        if (bossState === 'waiting' && missionTime >= mission.bossAt && !pendingWaves.length && !pendingSpawns.length) {
            summonBoss()
        }
        if (missionEndAt !== null && phase === 'flying') setPhase('cleared')
        if (missionEndAt !== null && time >= missionEndAt) openHangar()
    }

    const updateAir = realDt => {
        const difficulty = missionDifficulty(run.mission)
        // A deadline extension slows the whole enemy side down.
        const dt = realDt * enemyTimeScale(buffs, time)
        for (let i = airEnemies.length - 1; i >= 0; i--) {
            const enemy = airEnemies[i]
            const type = ENEMY_TYPES[enemy.type]
            const alive = stepAirEnemy(enemy, dt, ship)
            if (!alive || enemy.hp <= 0) {
                removeAirEnemy(enemy)
                airEnemies.splice(i, 1)
                continue
            }
            if (phase === 'flying') {
                const fired = stepEnemyFire(enemy, dt, ship, viewport, difficulty, random)
                fired.forEach(bullet => enemyShots.push({ ...bullet, r: 7, damage: DAMAGE.bullet }))
                if (fired.length) sound.enemyShot(enemy.type)
                const distance = Math.hypot(enemy.x - ship.x, enemy.y - ship.y)
                if (type.contact && distance < enemy.radius + SHIP_HIT_RADIUS) {
                    hurtShip(type.contact)
                    // Small things break on her; big ones only take a knock.
                    const smash = type.kamikaze || type.mine || enemy.type === 'mail' || enemy.type === 'noteSmall'
                    damageHostile({ kind: 'air', ref: enemy, x: enemy.x, y: enemy.y, r: enemy.radius }, smash ? 99 : 3)
                }
                // A mine arms when she comes close, blinks, and goes off.
                if (type.mine && enemy.hp > 0) {
                    if (!enemy.armedAt && distance < MINE_TRIGGER_RADIUS) {
                        enemy.armedAt = time
                        sound.mine()
                    }
                    if (enemy.armedAt && time - enemy.armedAt > MINE_FUSE_SECONDS) {
                        mineBurst(enemy, true, difficulty).forEach(shot =>
                            enemyShots.push({ ...shot, r: 7, damage: DAMAGE.bullet })
                        )
                        explode(enemy.x, enemy.y, 1.1)
                        enemy.hp = 0
                    }
                }
            }
            enemy.spin += dt * 3
            toWorld(enemy.mesh, enemy.x, enemy.y, Z.enemy)
            const look = enemy.mesh.userData
            if (enemy.type === 'deadline') {
                look.hands[0].rotation.z = -enemy.t * 4
                look.hands[1].rotation.z = -enemy.t * 0.6
            } else if (enemy.type === 'mine') {
                enemy.mesh.rotation.z += dt * 0.8
                const blinking = enemy.armedAt && Math.floor((time - enemy.armedAt) * 14) % 2 === 0
                look.blink.emissive.set(blinking ? '#FF1744' : '#000000')
                look.blink.emissiveIntensity = blinking ? 1 : 0
            } else if (enemy.type === 'ping') {
                enemy.mesh.rotation.z = Math.sin(enemy.spin * 2) * 0.3
            } else if (enemy.type === 'chat' || enemy.type === 'carrier') {
                enemy.mesh.rotation.z = Math.max(-0.4, Math.min(0.4, -(enemy.vx || 0) / 400))
                if (enemy.type === 'carrier' && Math.random() < realDt * 12)
                    addSparks(enemy.x + (random() - 0.5) * 40, enemy.y + (random() - 0.5) * 26, 1, 0.3)
            } else if (enemy.type === 'note' || enemy.type === 'noteSmall') {
                enemy.mesh.rotation.y = Math.sin(enemy.spin) * 0.25
            }
            if (enemy.type === 'mail')
                enemy.mesh.rotation.set(
                    Math.sin(enemy.spin) * 0.3,
                    Math.cos(enemy.spin * 0.7) * 0.3,
                    Math.sin(enemy.spin * 0.5) * 0.25
                )
            else if (enemy.type === 'fighter')
                enemy.mesh.rotation.y = Math.max(-0.6, Math.min(0.6, -(enemy.vx || 0) / 500))
            const pulse = 1 + enemy.hurt * 2.5
            if (enemy.type === 'mail') enemy.mesh.scale.set(34 * pulse, 24 * pulse, 5)
            else if (enemy.type === 'fighter') enemy.mesh.scale.setScalar(pulse)
            else enemy.mesh.scale.setScalar(1 + enemy.hurt * 1.5)
            const flashes = enemy.mesh.userData.flash
            if (flashes) {
                flashes.forEach(material => {
                    material.emissive.set('#FFFFFF')
                    material.emissiveIntensity = enemy.hurt > 0 ? 0.9 : 0
                })
                enemy.mesh.userData.engine.scale.set(6, 4 + Math.random() * 3, 4)
            }
        }
        hud.dataset.enemies = String(airEnemies.length)
    }

    const updateGround = realDt => {
        const difficulty = missionDifficulty(run.mission)
        const dt = realDt * enemyTimeScale(buffs, time)
        bunkers.forEach(bunker => {
            if (bunker.dead) return
            const y = bunkerScreenY(bunker)
            if (!bunker.model && y > -bunker.h - 80 && y < viewport.height + bunker.h) placeBunker(bunker)
            if (!bunker.model) return
            if (y > viewport.height + bunker.h + 40) {
                removeBunkerModel(bunker)
                bunker.dead = true
                return
            }
            const turretX = bunker.x - bunker.w / 2 + 21
            bunker.enemy.x = turretX
            bunker.enemy.y = y
            aimTurret(bunker.model.pivot, ship.x - turretX, ship.y - y)
            if (phase === 'flying')
                stepEnemyFire(bunker.enemy, dt, ship, viewport, difficulty, random).forEach(bullet =>
                    enemyShots.push({ ...bullet, r: 7, damage: DAMAGE.bullet })
                )
        })
        pageTargets.forEach(target => {
            if (target.enemy.hp <= 0 || !target.turret) return
            const x = target.rect.left + 20
            const y = target.rect.top + target.rect.height / 2 + appliedPageOffset
            target.enemy.x = x
            target.enemy.y = y
            aimTurret(target.turret.pivot, ship.x - x, ship.y - y)
            if (phase === 'flying')
                stepEnemyFire(target.enemy, dt, ship, viewport, 1, random).forEach(bullet =>
                    enemyShots.push({ ...bullet, r: 7, damage: DAMAGE.bullet })
                )
        })
        hud.dataset.pageTargets = String(pageTargets.filter(target => target.enemy.hp > 0).length)
    }

    const updateBoss = realDt => {
        if (!boss || !bossModel) return
        const dt = realDt * enemyTimeScale(buffs, time)
        if (boss.hp > 0 && phase === 'flying') {
            const out = stepRaidBoss(boss, dt, ship, viewport, random)
            out.orbs.forEach(orb => enemyShots.push({ ...orb, r: ORB_RADIUS, damage: DAMAGE.bossOrb, orb: true }))
            if (out.orbs.length) sound.enemyShot(boss.kind === 'clock' ? 'deadline' : 'boss')
            if (boss.kind === 'clock') sound.tick(Math.floor(boss.t * 2) % 2 === 1)
            out.beams.forEach(spec => addBeam(createBeam(spec, boss)))
            out.waves.forEach(spec => addWave(createWave(spec, boss)))
            out.spawns.forEach(wave =>
                expandWave(wave, viewport).forEach(spec => pendingSpawns.push({ at: missionTime + spec.delay, spec }))
            )
            if (insideRaidBoss(boss, ship.x, ship.y, 6)) hurtShip(DAMAGE.bossContact)
        }
        toWorld(bossModel.group, boss.x, boss.y, Z.boss)
        bossModel.setCount(displayedCount(boss))
        bossModel.animate(boss, ship)
        bossModel.bodyMaterial.emissiveIntensity = boss.hurt > 0 ? 0.5 : 0
        ui.bossFill.style.width = `${(boss.hp / boss.maxHp) * 100}%`
        hud.dataset.boss = String(displayedCount(boss))
    }

    /*
     * Boss hazards beyond bullets. A beam is a thin flickering warning line first and only burns
     * after BEAM_WARN; a wave is a growing ring whose one gap is visible from the moment it leaves.
     */
    const beams = []
    const waves = []
    const addBeam = beam => {
        const glow = new MeshBasicMaterial({ color: '#FF3B30', transparent: true, depthWrite: false, depthTest: false })
        const core = new MeshBasicMaterial({ color: '#FFFFFF', transparent: true, depthWrite: false, depthTest: false })
        const group = new Group()
        const glowMesh = new Mesh(unitPlane, glow)
        const coreMesh = new Mesh(unitPlane, core)
        glowMesh.renderOrder = 8
        coreMesh.renderOrder = 9
        group.add(glowMesh, coreMesh)
        scene.add(group)
        beams.push({ ...beam, group, glow, core, glowMesh, coreMesh })
        sound.beamWarn()
    }
    const removeBeam = beam => {
        scene.remove(beam.group)
        beam.glow.dispose()
        beam.core.dispose()
    }
    const addWave = wave => {
        const material = new MeshBasicMaterial({
            color: '#E53935',
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            depthTest: false,
            side: DoubleSide,
        })
        const mesh = new Mesh(new BufferGeometry(), material)
        mesh.renderOrder = 7
        scene.add(mesh)
        waves.push({ ...wave, mesh, material })
        sound.wave(boss && boss.kind === 'bell' ? 'bell' : 'pulse')
    }
    const removeWave = wave => {
        scene.remove(wave.mesh)
        wave.mesh.geometry.dispose()
        wave.material.dispose()
    }
    const clearHazards = () => {
        beams.splice(0).forEach(removeBeam)
        waves.splice(0).forEach(removeWave)
    }
    const updateHazards = realDt => {
        const dt = realDt * enemyTimeScale(buffs, time)
        for (let i = beams.length - 1; i >= 0; i--) {
            const beam = beams[i]
            if (!stepBeam(beam, dt, boss)) {
                removeBeam(beam)
                beams.splice(i, 1)
                continue
            }
            const warning = beam.age < BEAM_WARN
            const flicker = Math.floor(beam.age * 16) % 2 === 0
            const width = beam.kind === 'column' ? COLUMN_WIDTH : SWEEP_WIDTH
            const glowWidth = warning ? 3 : width
            const coreWidth = warning ? 0 : width * 0.35
            beam.glow.opacity = warning ? (flicker ? 0.8 : 0.35) : 0.85
            beam.core.opacity = warning ? 0 : 1
            if (beam.kind === 'column') {
                beam.group.position.set(beam.x, -viewport.height / 2, Z.fx - 2)
                beam.group.rotation.z = 0
                beam.glowMesh.scale.set(glowWidth, viewport.height + 40, 1)
                beam.coreMesh.scale.set(Math.max(0.01, coreWidth), viewport.height + 40, 1)
            } else {
                const length = Math.hypot(viewport.width, viewport.height) * 1.2
                beam.group.position.set(beam.cx, -beam.cy, Z.fx - 2)
                // Screen angle a points along (cos a, sin a), i.e. world (cos a, -sin a).
                beam.group.rotation.z = -beam.angle
                beam.glowMesh.position.set(length / 2, 0, 0)
                beam.coreMesh.position.set(length / 2, 0, 0.1)
                beam.glowMesh.scale.set(length, glowWidth, 1)
                beam.coreMesh.scale.set(length, Math.max(0.01, coreWidth), 1)
            }
            if (beam.live && !beam.fired) {
                beam.fired = true
                sound.beamFire()
            }
            if (phase === 'flying' && beamHits(beam, ship.x, ship.y, SHIP_HIT_RADIUS)) hurtShip(DAMAGE.beam)
        }
        for (let i = waves.length - 1; i >= 0; i--) {
            const wave = waves[i]
            if (!stepWave(wave, dt, viewport)) {
                removeWave(wave)
                waves.splice(i, 1)
                continue
            }
            // The ring is redrawn at its true thickness every frame, its gap where the hit test has it.
            wave.mesh.geometry.dispose()
            const inner = Math.max(1, wave.radius - WAVE_THICKNESS / 2)
            wave.mesh.geometry = new RingGeometry(
                inner,
                wave.radius + WAVE_THICKNESS / 2,
                72,
                1,
                -wave.gapAngle + WAVE_GAP / 2,
                Math.PI * 2 - WAVE_GAP
            )
            wave.mesh.position.set(wave.x, -wave.y, Z.fx - 3)
            wave.material.opacity = 0.85 * Math.min(1, wave.age * 4)
            if (phase === 'flying' && waveHits(wave, ship.x, ship.y, SHIP_HIT_RADIUS)) hurtShip(DAMAGE.wave)
        }
        hud.dataset.beams = String(beams.length)
        hud.dataset.waves = String(waves.length)
    }

    const updateShots = dt => {
        const targets = hostiles()
        for (let i = shots.length - 1; i >= 0; i--) {
            const shot = shots[i]
            shot.age += dt
            shot.x += shot.vx * dt
            shot.y += shot.vy * dt
            if (shot.kind === 'flame') {
                shot.vx *= 1 - dt * 1.5
                shot.vy *= 1 - dt * 1.5
            }
            let spent = shot.age > shot.life || shot.y < -40 || shot.x < -40 || shot.x > viewport.width + 40
            if (!spent) {
                for (const hostile of targets) {
                    if (shot.hit && shot.hit.has(hostile.ref)) continue
                    if (!hits(hostile, shot.x, shot.y, shot.r)) continue
                    damageHostile(hostile, shot.damage)
                    if (shot.kind === 'flame') {
                        shot.hit.add(hostile.ref)
                        continue
                    }
                    addSparks(shot.x, shot.y, 3, 0.6)
                    spent = true
                    break
                }
            }
            if (spent) shots.splice(i, 1)
        }
        // Rockets: home in on the nearest thing ahead, explode on contact or at the edge.
        for (let i = rockets.length - 1; i >= 0; i--) {
            const rocket = rockets[i]
            rocket.age += dt
            const target = nearestAhead(
                rocket,
                targets.filter(h => h.kind !== 'boss' || h.ref.hp > 0)
            )
            rocket.angle = steerTowards(rocket.angle, rocket, target, 3.6, dt)
            rocket.x += Math.cos(rocket.angle) * rocket.speed * dt
            rocket.y += Math.sin(rocket.angle) * rocket.speed * dt
            rocket.trail -= dt
            if (rocket.trail <= 0) {
                rocket.trail = 0.04
                addPuff(rocket.x - Math.cos(rocket.angle) * 12, rocket.y - Math.sin(rocket.angle) * 12, 10, {
                    life: 0.5,
                    smoke: true,
                })
            }
            toWorld(rocket.mesh, rocket.x, rocket.y, Z.playerShot)
            rocket.mesh.rotation.z = -rocket.angle - Math.PI / 2
            const impact = targets.some(hostile => hits(hostile, rocket.x, rocket.y, 8))
            const gone = rocket.age > 4 || rocket.y < -40 || rocket.x < -40 || rocket.x > viewport.width + 40
            if (impact || gone) {
                if (impact) {
                    explode(rocket.x, rocket.y, 1)
                    hostiles().forEach(hostile => {
                        if (Math.hypot(hostile.x - rocket.x, hostile.y - rocket.y) <= rocket.blast + (hostile.r || 30))
                            damageHostile(hostile, rocket.damage)
                    })
                }
                scene.remove(rocket.mesh)
                rockets.splice(i, 1)
            }
        }
        // Black holes: fly out, stop, swallow enemy fire and grind what is close, then implode.
        for (let i = blackholes.length - 1; i >= 0; i--) {
            const hole = blackholes[i]
            const weapon = hole.weapon
            hole.age += dt
            if (hole.age < weapon.travel) hole.y -= weapon.speed * dt
            const pulling = hole.age >= weapon.travel
            const size = pulling ? weapon.blast * (0.5 + 0.2 * Math.sin(hole.age * 9)) : 26
            toWorld(hole.core, hole.x, hole.y, Z.playerShot)
            hole.core.scale.set(size * 0.45, size * 0.45, 1)
            toWorld(hole.ring, hole.x, hole.y, Z.playerShot + 1)
            hole.ring.scale.set(size * 2, size * 2, 1)
            hole.ring.rotation.z += dt * 6
            if (pulling) {
                for (let j = enemyShots.length - 1; j >= 0; j--) {
                    const shot = enemyShots[j]
                    const dx = hole.x - shot.x
                    const dy = hole.y - shot.y
                    const distance = Math.hypot(dx, dy)
                    if (distance < weapon.blast * 1.6) {
                        shot.vx += (dx / (distance || 1)) * 900 * dt
                        shot.vy += (dy / (distance || 1)) * 900 * dt
                    }
                    if (distance < 24) enemyShots.splice(j, 1)
                }
            }
            if (hole.age >= weapon.travel + weapon.pull) {
                sound.weapon('implode')
                explode(hole.x, hole.y, 1.6)
                hostiles().forEach(hostile => {
                    if (Math.hypot(hostile.x - hole.x, hostile.y - hole.y) <= weapon.blast + (hostile.r || 40))
                        damageHostile(hostile, weapon.damage)
                })
                scene.remove(hole.core, hole.ring)
                blackholes.splice(i, 1)
            }
        }
    }

    const updateEnemyShots = realDt => {
        const dt = realDt * enemyTimeScale(buffs, time)
        for (let i = enemyShots.length - 1; i >= 0; i--) {
            const shot = enemyShots[i]
            if (!stepBullet(shot, dt, viewport) || shot.age > 8) {
                enemyShots.splice(i, 1)
                continue
            }
            if (Math.hypot(shot.x - ship.x, shot.y - ship.y) < shot.r + SHIP_HIT_RADIUS && phase === 'flying') {
                hurtShip(shot.damage)
                enemyShots.splice(i, 1)
            }
        }
        while (enemyShots.length > MAX_ENEMY_SHOTS) enemyShots.shift()
    }

    const updatePickups = dt => {
        const magnet = isActive(buffs, 'magnet', time)
        const drift = phase === 'flying' || phase === 'cleared' ? 70 : 30
        for (let i = pickups.length - 1; i >= 0; i--) {
            const pickup = pickups[i]
            pickup.age += dt
            const dx = ship.x - pickup.x
            const dy = ship.y - pickup.y
            const distance = Math.hypot(dx, dy)
            if (magnet && distance < MAGNET_RADIUS) {
                pickup.vx += (dx / (distance || 1)) * 1600 * dt
                pickup.vy += (dy / (distance || 1)) * 1600 * dt
            } else {
                // Tossed up, it falls back to the drift speed of the ground and sways.
                pickup.vy += (drift - pickup.vy) * Math.min(1, dt * 2.2)
                pickup.vx *= 1 - Math.min(1, dt * 1.8)
            }
            pickup.x += pickup.vx * dt
            pickup.y += pickup.vy * dt
            pickup.x = Math.max(16, Math.min(viewport.width - 16, pickup.x))
            const collectable = phase === 'flying' || phase === 'cleared'
            if (collectable && distance < PICKUP_COLLECT_RADIUS) {
                collect(pickup)
                removePickup(pickup)
                pickups.splice(i, 1)
                continue
            }
            if (pickup.y > viewport.height + 40 || pickup.age > PICKUP_LIFE) {
                removePickup(pickup)
                pickups.splice(i, 1)
                continue
            }
            const bob = Math.sin(pickup.age * 4 + pickup.phase)
            toWorld(pickup.group, pickup.x, pickup.y, Z.enemy + 10)
            pickup.token.rotation.y = pickup.age * 3
            pickup.token.scale.set(17, 6, 17 * (0.85 + 0.15 * Math.abs(Math.cos(pickup.age * 3))))
            const halo = 56 + bob * 8
            pickup.halo.scale.set(halo, halo, 1)
            // About to vanish: it blinks.
            pickup.group.visible = pickup.age < PICKUP_LIFE - 2 || Math.floor(pickup.age * 8) % 2 === 0
        }
        hud.dataset.pickups = String(pickups.length)
    }

    const collect = pickup => {
        const result = collectPickup(buffs, run, pickup.id, time)
        if (!result) return
        const type = PICKUP_TYPES[pickup.id]
        const text = strings.pickups && strings.pickups[pickup.id]
        ui.showToast(`${type.icon} ${text || pickup.id}`, 1.6)
        addRing(pickup.x, pickup.y, 110, 0.4, 0.8)
        addSparks(pickup.x, pickup.y, 12, 0.8)
        sound.pickup(pickup.id)
        hud.dataset.collected = String(Number(hud.dataset.collected || 0) + 1)
        hud.dataset.lastPickup = pickup.id
        hudDirty = true
        lastBuffHud = -1
    }

    const updateBuffs = dt => {
        const now = time
        // The shield bubble: a pulsing sphere round her that flickers before it runs out.
        const shieldLeft = isActive(buffs, 'shield', now) ? buffs.until.shield - now : 0
        shieldBubble.visible = shieldLeft > 0 && (shieldLeft > 1.5 || Math.floor(now * 10) % 2 === 0)
        if (shieldBubble.visible) {
            const r = 46 + Math.sin(now * 6) * 3
            shieldBubble.scale.set(r, r, r * 0.6)
            toWorld(shieldBubble, ship.x, ship.y - 4, Z.ship)
        }
        // The assistants orbit her and shoot at the nearest thing ahead.
        const dronesOn = isActive(buffs, 'drones', now) && (phase === 'flying' || phase === 'cleared')
        drones.forEach((drone, index) => {
            drone.group.visible = dronesOn
            if (!dronesOn) return
            const angle = now * 2.2 + index * Math.PI
            drone.x = ship.x + Math.cos(angle) * DRONE_ORBIT
            drone.y = ship.y - 6 + Math.sin(angle) * DRONE_ORBIT * 0.45
            toWorld(drone.group, drone.x, drone.y, Z.ship + 8)
            drone.group.rotation.set(-0.4, 0, Math.sin(now * 3 + index) * 0.2)
            drone.cooldown -= dt
            if (drone.cooldown > 0 || greeting) return
            drone.cooldown = DRONE_FIRE_INTERVAL
            const target = nearestAhead({ x: drone.x, y: drone.y }, hostiles())
            const shotAngle = target ? Math.atan2(target.y - drone.y, target.x - drone.x) : UP
            shots.push({
                x: drone.x,
                y: drone.y - 10,
                vx: Math.cos(shotAngle) * MAIN_GUN_SPEED,
                vy: Math.sin(shotAngle) * MAIN_GUN_SPEED,
                damage: 0.8,
                r: 5,
                life: 1.6,
                age: 0,
                kind: 'pellet',
            })
        })
        // A gold star makes her sparkle.
        if (isActive(buffs, 'star', now) && Math.random() < dt * 14)
            addSparks(ship.x + (random() - 0.5) * 50, ship.y + (random() - 0.5) * 60, 1, 0.25)
        // A deadline extension tints the edges of the screen.
        const slow = isActive(buffs, 'slowmo', now)
        if (slow !== inputLayer.dataset.slow) {
            inputLayer.dataset.slow = slow
            inputLayer.style.boxShadow = slow ? 'inset 0 0 120px rgba(38,166,154,0.45)' : 'none'
        }
        // The HUD: the buffs running and the combo, refreshed a few times a second.
        if (now - lastBuffHud > 0.1) {
            lastBuffHud = now
            ui.setBuffs(activeBuffs(buffs, now))
            const combo = currentCombo(run, now)
            const multiplier = comboMultiplier(combo) * (isActive(buffs, 'star', now) ? 2 : 1)
            if (multiplier > lastMultiplier && multiplier > 1) sound.combo(multiplier)
            lastMultiplier = multiplier
            ui.setCombo(combo, multiplier)
            // The jetpack's rumble follows the ground speed; a battered shield keeps warning.
            if (phase === 'flying' || phase === 'cleared') {
                sound.engine(0.4 + 0.6 * scrollRamp)
                if (phase === 'flying' && run.shield < run.maxShield * 0.25) sound.alarm()
            }
            hud.dataset.buffs = activeBuffs(buffs, now)
                .map(buff => buff.id)
                .join(',')
        }
    }

    const updateEffects = dt => {
        for (let i = puffs.length - 1; i >= 0; i--) {
            const puff = puffs[i]
            puff.age += dt
            puff.x += puff.vx * dt
            puff.y += puff.vy * dt
            if (puff.age >= puff.life) puffs.splice(i, 1)
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
            const spark = sparks[i]
            spark.age += dt
            spark.x += spark.vx * dt
            spark.y += spark.vy * dt
            spark.vx *= 1 - dt * 3
            spark.vy *= 1 - dt * 3
            if (spark.age >= spark.life) sparks.splice(i, 1)
        }
        for (let i = debris.length - 1; i >= 0; i--) {
            const piece = debris[i]
            piece.age += dt
            piece.x += piece.vx * dt
            piece.y += piece.vy * dt
            piece.vx *= 1 - dt * 2.4
            piece.vy *= 1 - dt * 2.4
            piece.mesh.rotation.z += piece.spin * dt
            const k = piece.age / piece.life
            piece.mesh.scale.setScalar(Math.max(0.01, 1 - k * 0.6))
            toWorld(piece.mesh, piece.x, piece.y, Z.debris)
            if (k >= 1) {
                scene.remove(piece.mesh)
                piece.mesh.geometry.dispose()
                debris.splice(i, 1)
            }
        }
        for (let i = bombRings.length - 1; i >= 0; i--) {
            const ring = bombRings[i]
            ring.age += dt
            const k = ring.age / 0.7
            const size = Math.max(viewport.width, viewport.height) * 2.4 * k
            toWorld(ring.mesh, ring.x, ring.y, Z.fx)
            ring.mesh.scale.set(size, size, 1)
            ring.mesh.material.opacity = 1 - k
            if (k >= 1) {
                scene.remove(ring.mesh)
                bombRings.splice(i, 1)
            }
        }
        for (let i = rings.length - 1; i >= 0; i--) {
            const ring = rings[i]
            ring.age += dt
            const k = ring.age / ring.life
            toWorld(ring.mesh, ring.x, ring.y, Z.fx)
            const size = ring.size * (0.2 + 0.8 * (1 - (1 - k) * (1 - k)))
            ring.mesh.scale.set(size, size, 1)
            ring.mesh.material.opacity = ring.opacity * (1 - k)
            if (k >= 1) {
                scene.remove(ring.mesh)
                ring.mesh.material.dispose()
                rings.splice(i, 1)
            }
        }
        flashMaterial.opacity = Math.max(0, flashMaterial.opacity - dt * 2.4)
        flash.visible = flashMaterial.opacity > 0.01
        flash.position.set(viewport.width / 2, -viewport.height / 2, Z.flash)
        flash.scale.set(viewport.width, viewport.height, 1)
    }

    const writeInstances = () => {
        let n = 0
        shots.forEach(shot => {
            if (n >= MAX_SHOTS || shot.kind === 'flame') return
            const angle = Math.atan2(shot.vy, shot.vx)
            dummy.position.set(shot.x, -shot.y, Z.playerShot)
            dummy.rotation.set(0, 0, -angle - Math.PI / 2)
            dummy.scale.set(shot.kind === 'pellet' ? 8 : 9, shot.kind === 'pellet' ? 16 : 26, 1)
            dummy.updateMatrix()
            shotMesh.setMatrixAt(n++, dummy.matrix)
        })
        shotMesh.count = n
        shotMesh.instanceMatrix.needsUpdate = true
        n = 0
        enemyShots.forEach(shot => {
            if (n >= MAX_ENEMY_SHOTS) return
            dummy.position.set(shot.x, -shot.y, Z.enemyShot)
            dummy.rotation.set(0, 0, 0)
            const size = shot.r * 2.2
            dummy.scale.set(size, size, 1)
            dummy.updateMatrix()
            enemyShotMesh.setMatrixAt(n, dummy.matrix)
            enemyShotMesh.setColorAt(n, tintColor(shot.tint || DEFAULT_TINT))
            dummy.position.z += 1
            dummy.scale.set(size * 0.62, size * 0.62, 1)
            dummy.updateMatrix()
            enemyCoreMesh.setMatrixAt(n++, dummy.matrix)
        })
        enemyShotMesh.count = n
        enemyCoreMesh.count = n
        enemyShotMesh.instanceMatrix.needsUpdate = true
        enemyCoreMesh.instanceMatrix.needsUpdate = true
        if (enemyShotMesh.instanceColor) enemyShotMesh.instanceColor.needsUpdate = true
        n = 0
        const writePuff = (x, y, size, color) => {
            if (n >= MAX_PUFFS) return
            dummy.position.set(x, -y, Z.fx)
            dummy.rotation.set(0, 0, 0)
            dummy.scale.set(size, size, 1)
            dummy.updateMatrix()
            puffMesh.setMatrixAt(n, dummy.matrix)
            puffMesh.setColorAt(n++, color)
        }
        puffs.forEach(puff => {
            const k = puff.age / puff.life
            if (puff.smoke) {
                writePuff(puff.x, puff.y, puff.size * (0.6 + k) * (1 - k * 0.6), SMOKE)
                return
            }
            // Grows fast, then shrinks away while cooling from white through orange to soot.
            const size = puff.size * Math.min(1, k * 5 + 0.3) * (1 - k * k)
            writePuff(puff.x, puff.y, size, FIRE_RAMP[Math.min(FIRE_RAMP.length - 1, Math.floor(k * FIRE_RAMP.length))])
        })
        shots.forEach(shot => {
            if (shot.kind !== 'flame') return
            const k = shot.age / shot.life
            writePuff(
                shot.x,
                shot.y,
                shot.r * (1 + k * 2.2) * (1 - k * 0.4),
                FIRE_RAMP[Math.min(5, Math.floor(k * 5) + 1)]
            )
        })
        puffMesh.count = n
        puffMesh.instanceMatrix.needsUpdate = true
        if (puffMesh.instanceColor) puffMesh.instanceColor.needsUpdate = true
        n = 0
        sparks.forEach(spark => {
            if (n >= MAX_SPARKS) return
            const k = 1 - spark.age / spark.life
            dummy.position.set(spark.x, -spark.y, Z.fx + 1)
            dummy.rotation.set(0, 0, spark.age * 10)
            dummy.scale.set(3.5 * k + 0.5, 3.5 * k + 0.5, 3)
            dummy.updateMatrix()
            sparkMesh.setMatrixAt(n++, dummy.matrix)
        })
        sparkMesh.count = n
        sparkMesh.instanceMatrix.needsUpdate = true
    }

    const updateHud = () => {
        if (!hudDirty) return
        hudDirty = false
        ui.update(run)
        hud.dataset.kills = String(run.kills)
    }

    const updateCamera = dt => {
        shake = Math.max(0, shake - dt * 30)
        camera.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 1500)
    }

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
        if (paused) {
            // The shop is open: everything holds still (buff timers too), the picture stays.
            renderer.render(scene, camera)
            frameId = requestAnimationFrame(frame)
            return
        }
        time += dt
        if (phase === 'takeoff') {
            const k = easeInOut(clamp01(time / TAKEOFF_SECONDS))
            const x = launch.x + (ship.x - launch.x) * k
            const y = launch.y + (ship.y - launch.y) * k
            bankAngle = Math.sin(k * Math.PI) * 0.5
            // Out of the avatar and down onto the page, where she will start running.
            shipNode.rotation.x = 0.5 + (RUN_TILT - 0.5) * k
            positionShip(
                x,
                y,
                launchScale + (RUN_SCALE - launchScale) * k,
                Z.ship + (Z.shipGround - Z.ship) * k,
                1 - 0.7 * k
            )
            if (time >= TAKEOFF_SECONDS) {
                setPhase('runup')
                runupStart = time
            }
        } else if (phase === 'runup') {
            updateScroll(dt)
            updateRunup(dt)
        } else if (phase === 'returning') {
            updateReturn()
        } else {
            if (phase !== 'gameover') {
                updateScroll(dt)
                if (phase !== 'hangar') {
                    updateShip(dt)
                    mainCooldown -= dt
                    specialCooldown -= dt
                    if ((phase === 'flying' || phase === 'cleared') && !greeting && liftoffProgress() > 0.6) {
                        if (mainCooldown <= 0) mainCooldown = fireMainGun()
                        const weapon = weaponById(equipped)
                        if (equipped !== RAGE_DEFAULT_WEAPON && weapon.kind !== 'laser' && specialCooldown <= 0)
                            specialCooldown = fireSpecial(weapon)
                        updateLaser(weapon, dt)
                    }
                    updateMission(dt)
                } else {
                    positionShip(ship.x, ship.y)
                }
            } else {
                scroll += 20 * dt
                renderScroll = scroll
                if (!gameOverShown && time - gameOverAt > 1.1) {
                    gameOverShown = true
                    ui.gameOver.show({
                        score: run.score,
                        best: Math.max(best, run.score),
                        isNew: lastRoundNew,
                        mission: run.mission,
                    })
                }
            }
            updateAir(dt)
            updateGround(dt)
            updateBoss(dt)
            updateShots(dt)
            updateEnemyShots(dt)
            updatePickups(dt)
            updateBuffs(dt)
            updateHazards(dt)
        }
        // updateReturn may finish and dispose the renderer on this very frame.
        if (finished) return
        if (phase !== 'returning') updateClouds(dt)
        updateWrecks(dt)
        updateTerrain()
        updateEffects(dt)
        writeInstances()
        updateHud()
        updateCamera(dt)
        renderer.render(scene, camera)
        if (phase !== 'done') frameId = requestAnimationFrame(frame)
    }

    /* Input. */
    // The first movement after a reset only records the gap to Anna; after that every movement
    // moves her with the mouse and closes the gap a little. The closing is bounded so it can never
    // feel wrong: she always moves the way the mouse moved, at least two thirds and at most twice as
    // far, with only a little sideways drift.
    const steerTo = (x, y) => {
        if (!pointer.anchored) {
            pointer.offsetX = ship.x - x
            pointer.offsetY = ship.y - y
            pointer.anchored = true
        } else {
            const dx = x - pointer.x
            const dy = y - pointer.y
            const length = Math.hypot(dx, dy)
            if (length > 0) {
                const ux = dx / length
                const uy = dy / length
                const fade = 1 - Math.exp(-length / STEER_OFFSET_FADE)
                const gx = -pointer.offsetX * fade
                const gy = -pointer.offsetY * fade
                const along = Math.max(-length / 3, Math.min(length, gx * ux + gy * uy))
                let px = gx - (gx * ux + gy * uy) * ux
                let py = gy - (gx * ux + gy * uy) * uy
                const side = Math.hypot(px, py)
                if (side > length / 2) {
                    px *= length / 2 / side
                    py *= length / 2 / side
                }
                pointer.offsetX += along * ux + px
                pointer.offsetY += along * uy + py
            }
        }
        pointer.x = x
        pointer.y = y
        pointer.active = true
    }
    const onPointerDown = event => {
        event.preventDefault()
        event.stopPropagation()
        sound.unlock()
        if (event.pointerType === 'touch' || event.pointerType === 'pen') {
            touchId = event.pointerId
            touchLast = { x: event.clientX, y: event.clientY }
        } else {
            steerTo(event.clientX, event.clientY)
            // The right button drops a bomb, for those who play with one hand on the mouse.
            if (event.button === 2) dropBomb()
        }
        if (inputLayer.setPointerCapture) {
            try {
                inputLayer.setPointerCapture(event.pointerId)
            } catch (error) {
                // A synthetic pointer id cannot be captured; steering still works without it.
            }
        }
    }
    const onPointerMove = event => {
        event.preventDefault()
        if (event.pointerId === touchId && touchLast) {
            if (phase === 'flying' || phase === 'cleared')
                dragShip(ship, event.clientX - touchLast.x, event.clientY - touchLast.y, viewport)
            touchLast = { x: event.clientX, y: event.clientY }
            return
        }
        if (event.pointerType === 'touch') return
        steerTo(event.clientX, event.clientY)
        held.clear()
    }
    const onPointerUp = event => {
        event.preventDefault()
        event.stopPropagation()
        if (event.pointerId === touchId) {
            touchId = null
            touchLast = null
        }
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
            // Escape closes the Gold shop first; only then does it leave.
            if (shopUi.isOpen()) closeShop()
            else beginReturn()
            return
        }
        if (shopUi.isOpen()) return
        if (phase === 'hangar') {
            if (down && event.key === 'Enter') launchNextMission()
            if (down && event.code === 'KeyB') openShop()
            return
        }
        if (phase === 'gameover') {
            if (down && event.key === 'Enter' && gameOverShown) playAgain()
            if (down && event.code === 'KeyB' && gameOverShown) openShop()
            return
        }
        if (event.code === 'Space') {
            if (down && !event.repeat) dropBomb()
            return
        }
        if (down && event.code === 'KeyB') {
            openShop()
            return
        }
        if (event.key === 'Enter') {
            if (down && !event.repeat) startGreeting()
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
        // Steering with the keyboard: the mouse takes over again from wherever she ends up.
        if (down) resetSteering()
        if (down) held.add(direction)
        else held.delete(direction)
    }
    const onBlur = () => {
        held.clear()
        touchId = null
        touchLast = null
    }
    const onResize = () => {
        const oldWidth = viewport.width
        resizeCamera()
        ui.layout()
        clearTerrain()
        // Bunkers keep their place relative to the width; the page's rows were measured on the
        // old layout, so whatever is left of the welcome committee is stood down.
        const ratio = viewport.width / (oldWidth || viewport.width)
        bunkers.forEach(bunker => {
            bunker.x *= ratio
            if (bunker.model) bunker.model.group.position.x = bunker.x
        })
        pageTargets.forEach(target => {
            target.enemy.hp = 0
        })
        pageGroup.clear()
        holeMaterials.length = 0
        Object.assign(ship, { x: Math.min(ship.x, viewport.width - 30), y: Math.min(ship.y, viewport.height - 40) })
    }
    // No visibility listener of our own (the app's resume signals have one owner, utils/appResume.js):
    // the browser already stops requestAnimationFrame in a hidden tab, `frame` clamps the gap it
    // leaves to one 50ms step, and `blur` releases every held key.

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

    /* Mount. */
    document.body.append(inputLayer, canvas, ...ui.elements, shopUi.element)
    ui.renderWeapons(RAGE_WEAPONS, owned, equipped)
    buildPageTargets()
    const helpTimer = setTimeout(() => {
        ui.help.style.opacity = '0'
    }, 5000)
    hud.dataset.shots = '0'
    hud.dataset.kills = '0'
    hud.dataset.pageTargets = String(pageTargets.length)
    updateTerrain()

    // What the player owns and their best score come from the server; until then: the blaster.
    if (services.loadProfile) {
        Promise.resolve()
            .then(() => services.loadProfile())
            .then(profile => {
                progressSettled = true
                if (!profile || finished) return
                adoptServerProgress(profile.progress)
                owned = new Set([RAGE_DEFAULT_WEAPON, ...(Array.isArray(profile.owned) ? profile.owned : [])])
                best = Math.max(best, Number(profile.highscore) || 0)
                if (preferredWeapon && owned.has(preferredWeapon)) equip(preferredWeapon)
                else ui.renderWeapons(RAGE_WEAPONS, owned, equipped)
                if (shopUi.isOpen()) shopUi.render()
            })
            .catch(() => {
                // Offline: fly with this browser's copy, and try to deliver a pending save anyway.
                progressSettled = true
                syncProgress()
            })
    } else if (preferredWeapon && owned.has(preferredWeapon)) equip(preferredWeapon)

    frameId = requestAnimationFrame(frame)

    /* Teardown. */
    function finish() {
        if (finished) return
        finished = true
        setPhase('done')
        if (frameId) cancelAnimationFrame(frameId)
        clearTimeout(helpTimer)
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('keyup', onKey, true)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('resize', onResize)
        ui.dispose()
        ;[inputLayer, canvas, ...ui.elements, shopUi.element].forEach(node => {
            if (node.parentNode) node.parentNode.removeChild(node)
        })
        // The page, exactly as it was.
        restoreRoot()
        restoreStyles.forEach(restore => restore())
        clearBattlefield()
        clearTerrain()
        removeBubble()
        wrecks.splice(0).forEach(removeWreck)
        rings.splice(0).forEach(ring => ring.mesh.material.dispose())
        shadowCatcher.geometry.dispose()
        shadowCatcher.material.dispose()
        debris.forEach(piece => piece.mesh.geometry.dispose())
        character.root.traverse(node => {
            if (node.geometry) node.geometry.dispose()
            if (node.material && node.material.dispose) node.material.dispose()
        })
        ;[shotMesh, enemyShotMesh, puffMesh, sparkMesh].forEach(mesh => mesh.dispose && mesh.dispose())
        disposables.forEach(resource => resource.dispose && resource.dispose())
        renderer.dispose()
        sound.close()
        activeArena = null
        if (onExit) onExit()
    }

    activeArena = {
        /** Fly home and close; `{ immediate: true }` skips the flight (e.g. the app is navigating away). */
        stop({ immediate = false } = {}) {
            if (immediate) finish()
            else beginReturn()
        },
    }
    return activeArena
}
