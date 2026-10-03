import {
    AdditiveBlending,
    BoxGeometry,
    CanvasTexture,
    ConeGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    SRGBColorSpace,
} from 'three'

import { BOSS_HALF_HEIGHT, BOSS_HALF_WIDTH } from './rageBoss'

/**
 * Rage mode's three.js models and textures: Anna with her jetpack, the open-tasks boss, and the
 * small canvas textures the raid draws with. Built from boxes at runtime, so the chunk ships no
 * model files and everything stays crisp at any size.
 */

export const CHARACTER_SCALE = 1.35
const BOSS_COLOR = '#D32F2F'

// Anna Alldone, as she appears in the app's celebration pictures: a wavy blonde bob, a big smile,
// a light-blue button-up shirt and navy trousers. The jetpack and blaster are rage mode's own.
export const PALETTE = {
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

export const radialTexture = (stops, size = 128) => {
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

/**
 * The hero: Anna Alldone as a chunky voxel figure with a jetpack and a blaster. Built from boxes at
 * runtime so there is no model to load, and so it stays crisp at any size. Local +x is "forward"
 * (her face), local +z is the side that faces the camera; the arm pivot aims the blaster and the
 * yaw group turns the whole figure towards its target.
 */
export const buildCharacter = (scale = CHARACTER_SCALE) => {
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

    lean.scale.setScalar(scale)
    return { root: lean, yaw, head, arm, rearArm, flames, materials: Object.values(materials) }
}

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
export const buildBoss = caption => {
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
