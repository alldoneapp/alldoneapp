import {
    BoxGeometry,
    CanvasTexture,
    CylinderGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    SphereGeometry,
    SRGBColorSpace,
} from 'three'

import { buildBoss } from './rageModels'

/**
 * The five raid bosses as three.js models (`raidBosses.js` decides how they fight). Each returns
 * `{ group, bodyMaterial, setCount(n), animate(boss, ship), dispose() }`: `bodyMaterial` flashes
 * when hit, `setCount` redraws today's open-task count wherever that boss wears it, and `animate`
 * runs its own little life (a swinging bell, spinning hands, a breathing paper stack).
 *
 * Units are screen pixels; local +z faces the camera. Built from primitives and canvas textures,
 * like everything else in the raid, so there is nothing to download.
 */

const FONT = 'Roboto, system-ui, sans-serif'

const roundedRect = (c, x, y, w, h, r) => {
    c.beginPath()
    c.moveTo(x + r, y)
    c.arcTo(x + w, y, x + w, y + h, r)
    c.arcTo(x + w, y + h, x, y + h, r)
    c.arcTo(x, y + h, x, y, r)
    c.arcTo(x, y, x + w, y, r)
    c.closePath()
}

/**
 * A disc made of a cylinder turned to face the camera shows its cap texture a quarter turn off;
 * this turns it back, so 12 is at the top of the clock and a badge's number stands upright.
 */
export const DISC_TEXTURE_TURN = Math.PI / 2
const uprightOnDisc = texture => {
    texture.center.set(0.5, 0.5)
    texture.rotation = DISC_TEXTURE_TURN
    return texture
}

/** A canvas texture that can be redrawn: `draw(context, width, height, count)`. */
const liveTexture = (width, height, draw) => {
    const canvas = document.createElement('canvas')
    canvas.width = width * 2
    canvas.height = height * 2
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    let shown = null
    return {
        texture,
        draw(count) {
            if (count === shown) return
            shown = count
            const context = canvas.getContext('2d')
            if (!context) return
            context.setTransform(2, 0, 0, 2, 0, 0)
            context.clearRect(0, 0, width, height)
            draw(context, width, height, count)
            texture.needsUpdate = true
        },
    }
}

const angryEyes = (c, cx, cy, spread, size) => {
    ;[-1, 1].forEach(side => {
        const x = cx + side * spread
        c.fillStyle = '#FFFFFF'
        c.beginPath()
        c.ellipse(x, cy, size, size * 0.75, 0, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#091540'
        c.beginPath()
        c.arc(x - side * size * 0.15, cy + size * 0.1, size * 0.42, 0, Math.PI * 2)
        c.fill()
        c.strokeStyle = '#091540'
        c.lineWidth = size * 0.35
        c.beginPath()
        c.moveTo(x - size * 1.1, cy - size * (side < 0 ? 1.4 : 0.8))
        c.lineTo(x + size * 1.1, cy - size * (side < 0 ? 0.8 : 1.4))
        c.stroke()
    })
}

/** Builds a model from parts and keeps every geometry, material and texture for `dispose`. */
const kit = () => {
    const owned = []
    const own = thing => {
        owned.push(thing)
        return thing
    }
    const standard = (color, extra = {}) =>
        own(new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, flatShading: true, ...extra }))
    const mesh = (geometry, material) => {
        const m = new Mesh(own(geometry), material)
        m.castShadow = true
        return m
    }
    return {
        own,
        standard,
        mesh,
        dispose() {
            owned.forEach(thing => thing.dispose && thing.dispose())
        },
    }
}

/* ------------------------------------------------------------------------------------------------ */

const buildInbox = () => {
    const k = kit()
    const group = new Group()
    const bodyMaterial = k.standard('#1D2B4F', { emissive: '#FFFFFF', emissiveIntensity: 0 })
    const face = liveTexture(240, 124, (c, w, h, count) => {
        c.fillStyle = '#1D2B4F'
        c.fillRect(0, 0, w, h)
        c.fillStyle = '#2F80ED'
        roundedRect(c, 8, 8, w - 16, h - 16, 12)
        c.fill()
        c.fillStyle = '#FFFFFF'
        c.font = `800 15px ${FONT}`
        c.textAlign = 'left'
        c.textBaseline = 'middle'
        c.fillText('INBOX', 20, 24)
        angryEyes(c, w / 2 - 22, 58, 26, 13)
        // The envelope mouth, and the count in a red badge.
        c.fillStyle = '#FFFFFF'
        roundedRect(c, w / 2 - 54, 80, 64, 30, 5)
        c.fill()
        c.strokeStyle = '#2F80ED'
        c.lineWidth = 3
        c.beginPath()
        c.moveTo(w / 2 - 52, 82)
        c.lineTo(w / 2 - 22, 98)
        c.lineTo(w / 2 + 8, 82)
        c.stroke()
        c.fillStyle = '#E53935'
        c.beginPath()
        c.arc(w - 50, h / 2 + 6, 30, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#FFFFFF'
        c.font = `900 ${count > 99 ? 20 : 28}px ${FONT}`
        c.textAlign = 'center'
        c.fillText(String(count), w - 50, h / 2 + 8)
    })
    k.own(face.texture)
    const faceMaterial = k.own(new MeshBasicMaterial({ map: face.texture }))
    const tray = k.mesh(new BoxGeometry(240, 124, 26), [
        bodyMaterial,
        bodyMaterial,
        bodyMaterial,
        bodyMaterial,
        faceMaterial,
        bodyMaterial,
    ])
    group.add(tray)
    // A stack of paper spilling out of the top, which breathes.
    const paper = k.standard('#FFFFFF')
    const stack = new Group()
    ;[0, 1, 2].forEach(i => {
        const sheet = k.mesh(new BoxGeometry(150 - i * 14, 26, 6), paper)
        sheet.position.set(-10 + i * 8, 62 + i * 4, 8 + i * 6)
        sheet.rotation.z = (i - 1) * 0.06
        stack.add(sheet)
    })
    group.add(stack)
    return {
        group,
        bodyMaterial,
        setCount: count => face.draw(count),
        animate: boss => {
            stack.position.y = Math.sin(boss.t * 3) * 3
            group.rotation.z = Math.sin(boss.t * 0.8) * 0.05
        },
        dispose: () => k.dispose(),
    }
}

const buildCalendar = () => {
    const k = kit()
    const group = new Group()
    const bodyMaterial = k.standard('#EDE7F6', { emissive: '#FFFFFF', emissiveIntensity: 0 })
    const face = liveTexture(210, 180, (c, w, h, count) => {
        c.fillStyle = '#FFFFFF'
        roundedRect(c, 0, 0, w, h, 14)
        c.fill()
        c.fillStyle = '#7E57C2'
        roundedRect(c, 0, 0, w, 40, 14)
        c.fill()
        c.fillRect(0, 20, w, 20)
        c.fillStyle = '#FFFFFF'
        c.font = `800 16px ${FONT}`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText('TODAY', w / 2, 21)
        // A week of slots, most of them booked.
        const cols = 7
        const rows = 4
        const cw = (w - 20) / cols
        const ch = (h - 60) / rows
        for (let r = 0; r < rows; r++)
            for (let col = 0; col < cols; col++) {
                const booked = (r * 3 + col * 5) % 4 !== 0
                c.fillStyle = booked ? 'rgba(126,87,194,0.28)' : 'rgba(9,21,64,0.06)'
                roundedRect(c, 10 + col * cw + 2, 50 + r * ch + 2, cw - 4, ch - 4, 4)
                c.fill()
            }
        angryEyes(c, w / 2, 78, 30, 12)
        c.fillStyle = '#7E57C2'
        c.beginPath()
        c.arc(w / 2, 132, 30, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#FFFFFF'
        c.font = `900 ${count > 99 ? 20 : 28}px ${FONT}`
        c.fillText(String(count), w / 2, 134)
    })
    k.own(face.texture)
    const faceMaterial = k.own(new MeshBasicMaterial({ map: face.texture }))
    const slab = k.mesh(new BoxGeometry(210, 180, 22), [
        bodyMaterial,
        bodyMaterial,
        bodyMaterial,
        bodyMaterial,
        faceMaterial,
        bodyMaterial,
    ])
    group.add(slab)
    const ringMaterial = k.standard('#4527A0', { metalness: 0.4 })
    const rings = [-66, -22, 22, 66].map(x => {
        const ring = k.mesh(new CylinderGeometry(5, 5, 30, 10), ringMaterial)
        ring.rotation.x = Math.PI / 2
        ring.position.set(x, 90, 8)
        group.add(ring)
        return ring
    })
    return {
        group,
        bodyMaterial,
        setCount: count => face.draw(count),
        animate: boss => {
            rings.forEach((ring, i) => {
                ring.position.y = 90 + Math.sin(boss.t * 4 + i) * 3
            })
        },
        dispose: () => k.dispose(),
    }
}

const buildBell = () => {
    const k = kit()
    const group = new Group()
    // The bell swings from its crown: everything hangs off a pivot at the top.
    const swing = new Group()
    swing.position.y = 70
    group.add(swing)
    const bodyMaterial = k.standard('#FFC107', {
        metalness: 0.55,
        roughness: 0.35,
        emissive: '#FFFFFF',
        emissiveIntensity: 0,
    })
    const darker = k.standard('#E0A800', { metalness: 0.6, roughness: 0.3 })
    const part = (geometry, material, y) => {
        const m = k.mesh(geometry, material)
        m.position.y = y - 70
        swing.add(m)
        return m
    }
    part(new SphereGeometry(44, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), bodyMaterial, 38)
    part(new CylinderGeometry(44, 84, 92, 28), bodyMaterial, -8)
    part(new CylinderGeometry(90, 90, 12, 28), darker, -58)
    part(new SphereGeometry(10, 12, 8), darker, 86)
    const clapper = part(new SphereGeometry(15, 14, 10), k.standard('#B28704', { metalness: 0.6 }), -74)
    // The badge: the count, red, upper right — like every notification you have ever ignored.
    const badgeTexture = liveTexture(80, 80, (c, w, h, count) => {
        c.fillStyle = '#E53935'
        c.beginPath()
        c.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2)
        c.fill()
        c.strokeStyle = '#FFFFFF'
        c.lineWidth = 5
        c.beginPath()
        c.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2)
        c.stroke()
        c.fillStyle = '#FFFFFF'
        c.font = `900 ${count > 99 ? 24 : 34}px ${FONT}`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText(String(count), w / 2, h / 2 + 2)
    })
    k.own(uprightOnDisc(badgeTexture.texture))
    const badge = k.mesh(new CylinderGeometry(30, 30, 8, 28), [
        k.standard('#B71C1C'),
        k.own(new MeshBasicMaterial({ map: badgeTexture.texture })),
        k.standard('#B71C1C'),
    ])
    badge.rotation.x = Math.PI / 2
    badge.position.set(66, 40, 60)
    group.add(badge)
    return {
        group,
        bodyMaterial,
        setCount: count => badgeTexture.draw(count),
        animate: boss => {
            swing.rotation.z = Math.sin(boss.t * 3.2) * 0.22
            clapper.position.x = -Math.sin(boss.t * 3.2 + 0.6) * 18
            badge.scale.setScalar(1 + Math.max(0, Math.sin(boss.t * 6)) * 0.08)
        },
        dispose: () => k.dispose(),
    }
}

const buildClock = () => {
    const k = kit()
    const group = new Group()
    const bodyMaterial = k.standard('#EF6C00', { emissive: '#FFFFFF', emissiveIntensity: 0 })
    const face = liveTexture(200, 200, (c, w, h, count) => {
        const r = w / 2
        c.fillStyle = '#FFFFFF'
        c.beginPath()
        c.arc(r, r, r - 2, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#3A2A1E'
        c.font = `800 18px ${FONT}`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        ;[12, 3, 6, 9].forEach((n, i) => {
            const a = -Math.PI / 2 + (Math.PI / 2) * i
            c.fillText(String(n), r + Math.cos(a) * (r - 22), r + Math.sin(a) * (r - 22))
        })
        for (let i = 0; i < 60; i++) {
            if (i % 15 === 0) continue
            const a = (Math.PI * 2 * i) / 60
            const long = i % 5 === 0
            c.fillRect(r + Math.cos(a) * (r - 9) - 1, r + Math.sin(a) * (r - 9) - 1, long ? 3 : 2, long ? 3 : 2)
        }
        c.font = `800 11px ${FONT}`
        c.fillStyle = '#EF6C00'
        c.fillText('DEADLINE', r, r - 40)
        // Today's count in a little window, like a date wheel.
        c.fillStyle = '#E53935'
        roundedRect(c, r - 26, r + 30, 52, 30, 6)
        c.fill()
        c.fillStyle = '#FFFFFF'
        c.font = `900 ${count > 99 ? 16 : 22}px ${FONT}`
        c.fillText(String(count), r, r + 46)
    })
    k.own(uprightOnDisc(face.texture))
    const disc = k.mesh(new CylinderGeometry(100, 100, 22, 40), [
        bodyMaterial,
        k.own(new MeshBasicMaterial({ map: face.texture })),
        bodyMaterial,
    ])
    disc.rotation.x = Math.PI / 2
    group.add(disc)
    const handMaterial = k.standard('#3A2A1E')
    const hand = (length, width) => {
        const pivot = new Group()
        pivot.position.z = 14
        const bar = k.mesh(new BoxGeometry(width, length, 4), handMaterial)
        bar.position.y = length / 2 - 8
        pivot.add(bar)
        group.add(pivot)
        return pivot
    }
    const minute = hand(84, 6)
    const hour = hand(56, 9)
    const bellMaterial = k.standard('#BF360C', { metalness: 0.4 })
    ;[-1, 1].forEach(side => {
        const dome = k.mesh(new SphereGeometry(28, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), bellMaterial)
        dome.rotation.x = Math.PI / 2
        dome.rotation.z = side * 0.5
        dome.position.set(side * 64, 86, 0)
        group.add(dome)
    })
    return {
        group,
        bodyMaterial,
        setCount: count => face.draw(count),
        animate: boss => {
            // The hands turn with the spiral it fires.
            minute.rotation.z = -boss.spiral
            hour.rotation.z = -boss.spiral / 12 - boss.t * 0.2
            group.rotation.z = Math.sin(boss.t * 9) * 0.015
        },
        dispose: () => k.dispose(),
    }
}

/** The Backlog keeps the original voxel boss, wrapped in the same interface. */
const buildBacklog = caption => {
    const model = buildBoss(caption)
    return {
        group: model.group,
        bodyMaterial: model.bodyMaterial,
        setCount: count => model.setCount(count),
        animate: (boss, ship) => model.lookAt(ship.x - boss.x, ship.y - boss.y),
        dispose: () => model.dispose(),
    }
}

export const buildRaidBossModel = (kind, caption) => {
    const model =
        kind === 'inbox'
            ? buildInbox()
            : kind === 'calendar'
              ? buildCalendar()
              : kind === 'bell'
                ? buildBell()
                : kind === 'clock'
                  ? buildClock()
                  : buildBacklog(caption)
    model.group.traverse(node => {
        if (node.isMesh) node.castShadow = true
    })
    return model
}
