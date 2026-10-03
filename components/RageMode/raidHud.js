import { RAGE_LAYER_ATTRIBUTE } from './rageTargets'
import { HANGAR_ITEMS, MAX_BOMBS, MAX_CANNON_LEVEL } from './raidRun'
import { PICKUP_TYPES } from './raidPickups'

/**
 * The raid's on-screen chrome, as plain DOM inside the arena's own layers (the arena is not React):
 * the status pill, the special-weapon bar, the boss bar, short announcements, the hangar between
 * missions and the game-over card. Nothing here owns game state; the arena passes it in.
 */

export const NARROW_HUD_WIDTH = 460

/**
 * The width the user can actually SEE. On a phone a page that overflows sideways widens the layout
 * viewport (`innerWidth`) past the screen, and `position: fixed` + `left: 50%` would then centre an
 * overlay on a point off to the right, pushing ✕ off screen.
 */
export const visibleWidth = () =>
    Math.min(
        window.innerWidth,
        document.documentElement.clientWidth || Infinity,
        (window.visualViewport && window.visualViewport.width) || Infinity
    )
// Likewise the visible height: bottom-anchored bars measured from a taller layout viewport end up
// below the screen.
export const visibleHeight = () =>
    Math.min(window.innerHeight, (window.visualViewport && window.visualViewport.height) || Infinity)

const FONT = 'Roboto, system-ui, sans-serif'
const NAVY = '#091540'

export const pillElement = (tag, style = {}) => {
    const element = document.createElement(tag)
    Object.assign(element.style, style)
    return element
}

const stopPointer = element => {
    element.addEventListener('pointerdown', event => event.stopPropagation())
    return element
}

export const hudButton = (label, text, onClick) => {
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
        minWidth: '30px',
        height: '30px',
        borderRadius: '15px',
        font: `600 14px ${FONT}`,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 8px',
        boxSizing: 'border-box',
    })
    stopPointer(button)
    if (onClick)
        button.addEventListener('click', event => {
            event.stopPropagation()
            onClick()
        })
    return button
}

const wideButton = (text, primary, onClick) => {
    const button = hudButton(text, text, onClick)
    Object.assign(button.style, {
        height: 'auto',
        padding: '10px 16px',
        borderRadius: '16px',
        background: primary ? '#FFAE47' : 'rgba(255,255,255,0.14)',
        color: primary ? NAVY : '#FFFFFF',
        whiteSpace: 'nowrap',
    })
    return button
}

/**
 * A button that throws progress away asks twice: the first press turns it into "Sure? …" for a
 * few seconds, only a second press inside that window acts.
 */
const confirmingButton = (text, confirmText, onConfirm) => {
    let armed = false
    let timer = 0
    const button = wideButton(text, false, () => {
        if (armed) {
            clearTimeout(timer)
            armed = false
            button.textContent = text
            button.style.background = 'rgba(255,255,255,0.14)'
            onConfirm()
            return
        }
        armed = true
        button.textContent = confirmText
        button.style.background = '#E00000'
        timer = setTimeout(() => {
            armed = false
            button.textContent = text
            button.style.background = 'rgba(255,255,255,0.14)'
        }, 3000)
    })
    button.setAttribute('data-start-over', 'true')
    return button
}

const meter = (width, color) => {
    const track = pillElement('span', {
        display: 'inline-block',
        width,
        height: '8px',
        borderRadius: '4px',
        background: 'rgba(255,255,255,0.18)',
        overflow: 'hidden',
    })
    const fill = pillElement('span', {
        display: 'block',
        height: '100%',
        width: '100%',
        background: color,
        transition: 'width 200ms ease, background 200ms ease',
    })
    track.appendChild(fill)
    return { track, fill }
}

const fixedCentre = (zIndex, style) =>
    pillElement('div', {
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: String(zIndex),
        ...style,
    })

/**
 * Build every overlay. `actions` are the callbacks the buttons call: exit, toggleMute, bomb,
 * equip(id), buyHangar(id), launch, openGoldShop, playAgain.
 */
export const buildRaidHud = ({ strings, zIndex, touch, muted, narrow, actions }) => {
    const hud = fixedCentre(zIndex + 2, {
        top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        display: 'flex',
        alignItems: 'center',
        gap: narrow ? '6px' : '10px',
        padding: narrow ? '4px 4px 4px 10px' : '5px 5px 5px 14px',
        borderRadius: '20px',
        background: NAVY,
        boxShadow: '0 6px 24px rgba(9,21,64,0.35)',
        color: '#fff',
        font: `600 13px ${FONT}`,
        whiteSpace: 'nowrap',
        userSelect: 'none',
        pointerEvents: 'none',
    })
    hud.setAttribute(RAGE_LAYER_ATTRIBUTE, 'hud')
    const mission = pillElement('span', { letterSpacing: '0.04em', textTransform: 'uppercase' })
    const scoreValue = pillElement('span', { fontVariantNumeric: 'tabular-nums', color: '#FFCE8F' })
    scoreValue.title = strings.score
    const creditsValue = pillElement('span', { fontVariantNumeric: 'tabular-nums', color: '#9CF0C8' })
    creditsValue.title = strings.credits
    const shield = meter(narrow ? '44px' : '76px', '#4FC3F7')
    shield.track.title = strings.shield
    const bombsValue = pillElement('span', { fontVariantNumeric: 'tabular-nums' })
    bombsValue.title = strings.bombs
    const hint = pillElement('span', { color: 'rgba(255,255,255,0.6)', fontWeight: '400' })
    hint.textContent = strings.exitHint
    if (touch || narrow) hint.style.display = 'none'
    const greet = hudButton(strings.greet, '👋', actions.greet)
    // Only while there is progress to throw away.
    const restart = hudButton(strings.startOver, '↺', actions.requestStartOver)
    restart.style.display = 'none'
    restart.setAttribute('data-start-over', 'true')
    const mute = hudButton(muted ? strings.unmute : strings.mute, muted ? '🔇' : '🔊', actions.toggleMute)
    const exit = hudButton(strings.exit, '✕', actions.exit)
    // The combo: hidden until it is worth something, then ×1.5 … ×3 (×6 with a gold star).
    const comboValue = pillElement('span', {
        display: 'none',
        padding: '1px 7px',
        borderRadius: '9px',
        background: '#FF7043',
        color: '#FFFFFF',
        fontWeight: '800',
        fontVariantNumeric: 'tabular-nums',
        transition: 'transform 120ms ease',
    })
    comboValue.title = strings.combo
    hud.append(
        mission,
        scoreValue,
        comboValue,
        creditsValue,
        shield.track,
        bombsValue,
        hint,
        greet,
        restart,
        mute,
        exit
    )

    // The power-ups running, bottom left: an icon and a bar draining as it runs out.
    const buffBar = pillElement('div', {
        position: 'fixed',
        left: '16px',
        zIndex: String(zIndex + 2),
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: '6px',
        pointerEvents: 'none',
    })
    buffBar.setAttribute(RAGE_LAYER_ATTRIBUTE, 'buffs')
    const buffChips = new Map()
    const setBuffs = list => {
        const ids = new Set(list.map(buff => buff.id))
        buffChips.forEach((chip, id) => {
            if (!ids.has(id)) {
                chip.root.remove()
                buffChips.delete(id)
            }
        })
        list.forEach(buff => {
            let chip = buffChips.get(buff.id)
            if (!chip) {
                const type = PICKUP_TYPES[buff.id]
                const root = pillElement('div', {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 8px 4px 6px',
                    borderRadius: '14px',
                    background: NAVY,
                    boxShadow: '0 4px 16px rgba(9,21,64,0.3)',
                    color: '#FFFFFF',
                    font: `600 12px ${FONT}`,
                })
                root.setAttribute('data-buff', buff.id)
                const icon = pillElement('span', { fontSize: '16px' })
                icon.textContent = type.icon
                const track = pillElement('span', {
                    width: '54px',
                    height: '6px',
                    borderRadius: '3px',
                    background: 'rgba(255,255,255,0.18)',
                    overflow: 'hidden',
                })
                const fill = pillElement('span', { display: 'block', height: '100%', background: type.color })
                track.appendChild(fill)
                root.append(icon, track)
                buffBar.appendChild(root)
                chip = { root, fill }
                buffChips.set(buff.id, chip)
            }
            chip.fill.style.width = `${Math.max(0, Math.min(1, buff.share)) * 100}%`
        })
    }
    let shownCombo = 0
    const setCombo = (combo, multiplier) => {
        hud.dataset.combo = String(combo)
        if (multiplier <= 1) {
            comboValue.style.display = 'none'
            shownCombo = combo
            return
        }
        comboValue.style.display = 'inline-block'
        comboValue.textContent = `×${multiplier % 1 ? multiplier.toFixed(1) : multiplier}`
        if (combo !== shownCombo) {
            comboValue.style.transform = 'scale(1.25)'
            setTimeout(() => {
                comboValue.style.transform = 'scale(1)'
            }, 120)
        }
        shownCombo = combo
    }

    const help = fixedCentre(zIndex + 2, {
        padding: '8px 16px',
        borderRadius: '16px',
        background: 'rgba(9,21,64,0.8)',
        color: '#fff',
        font: `400 13px ${FONT}`,
        whiteSpace: narrow ? 'normal' : 'nowrap',
        maxWidth: 'calc(100vw - 32px)',
        boxSizing: 'border-box',
        textAlign: 'center',
        pointerEvents: 'none',
        transition: 'opacity 600ms ease',
    })
    help.setAttribute(RAGE_LAYER_ATTRIBUTE, 'help')
    help.textContent = touch ? strings.touchHelp : strings.desktopHelp

    // The special weapons you own, bottom centre: tap one, or press its number.
    const weaponBar = fixedCentre(zIndex + 2, {
        display: 'flex',
        gap: '6px',
        padding: '5px',
        borderRadius: '18px',
        background: NAVY,
        boxShadow: '0 6px 24px rgba(9,21,64,0.35)',
        userSelect: 'none',
        transition: 'opacity 300ms ease',
    })
    weaponBar.setAttribute(RAGE_LAYER_ATTRIBUTE, 'weapons')
    stopPointer(weaponBar)

    // On touch there is no Space bar: a big bomb button sits bottom right, under the thumb.
    const bombButton = hudButton(strings.bomb, '💣', actions.bomb)
    Object.assign(bombButton.style, {
        position: 'fixed',
        right: '16px',
        zIndex: String(zIndex + 2),
        width: '58px',
        height: '58px',
        borderRadius: '29px',
        fontSize: '24px',
        background: NAVY,
        boxShadow: '0 6px 24px rgba(9,21,64,0.35)',
        display: touch ? 'flex' : 'none',
    })
    bombButton.setAttribute(RAGE_LAYER_ATTRIBUTE, 'bomb')

    const bossBar = fixedCentre(zIndex + 2, {
        top: 'calc(env(safe-area-inset-top, 0px) + 56px)',
        width: 'min(420px, calc(100vw - 32px))',
        display: 'none',
        flexDirection: 'column',
        gap: '4px',
        color: '#fff',
        font: `700 12px ${FONT}`,
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

    const toast = pillElement('div', {
        position: 'fixed',
        top: '36%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: String(zIndex + 3),
        padding: '12px 22px',
        borderRadius: '18px',
        background: NAVY,
        color: '#FFFFFF',
        font: `800 20px ${FONT}`,
        boxShadow: '0 10px 40px rgba(9,21,64,0.45)',
        opacity: '0',
        transition: 'opacity 250ms ease',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        maxWidth: 'calc(100vw - 32px)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    })
    toast.setAttribute(RAGE_LAYER_ATTRIBUTE, 'toast')

    let toastTimer = 0
    const showToast = (text, seconds = 1.8) => {
        toast.textContent = text
        toast.style.opacity = '1'
        clearTimeout(toastTimer)
        toastTimer = setTimeout(() => {
            toast.style.opacity = '0'
        }, seconds * 1000)
    }

    const update = run => {
        mission.textContent = narrow ? `🔥 ${run.mission}` : `🔥 ${strings.mission.replace('{n}', run.mission)}`
        scoreValue.textContent = `★ ${run.score.toLocaleString()}`
        creditsValue.textContent = `💳 ${run.credits.toLocaleString()}`
        const share = run.shield / run.maxShield
        shield.fill.style.width = `${share * 100}%`
        shield.fill.style.background = share > 0.5 ? '#4FC3F7' : share > 0.25 ? '#FFAE47' : '#E00000'
        bombsValue.textContent = `💣 ${run.bombs}`
        bombButton.textContent = `💣${run.bombs}`
        Object.assign(hud.dataset, {
            mission: String(run.mission),
            score: String(run.score),
            credits: String(run.credits),
            shield: String(run.shield),
            bombs: String(run.bombs),
        })
    }

    const setMuted = isMuted => {
        mute.textContent = isMuted ? '🔇' : '🔊'
        mute.title = isMuted ? strings.unmute : strings.mute
        mute.setAttribute('aria-label', mute.title)
    }

    const renderWeapons = (weapons, owned, equipped) => {
        weaponBar.textContent = ''
        weapons.forEach((weapon, index) => {
            if (!owned.has(weapon.id)) return
            const label = strings.weapons && strings.weapons[weapon.id] ? strings.weapons[weapon.id].name : weapon.id
            const chip = hudButton(`${label} (${index + 1})`, weapon.icon, () => actions.equip(weapon.id))
            chip.setAttribute('data-weapon', weapon.id)
            Object.assign(chip.style, {
                width: '38px',
                height: '34px',
                borderRadius: '13px',
                fontSize: '18px',
                padding: '0',
                background: weapon.id === equipped ? '#FFAE47' : 'rgba(255,255,255,0.12)',
            })
            weaponBar.appendChild(chip)
        })
        // The Gold weapon shop, reachable in the middle of a mission too (B on a keyboard).
        const shop = hudButton(`${strings.shop} (B)`, '🛒', actions.openGoldShop)
        shop.setAttribute('data-shop', 'true')
        Object.assign(shop.style, {
            width: '38px',
            height: '34px',
            borderRadius: '13px',
            fontSize: '17px',
            padding: '0',
            background: 'rgba(255,255,255,0.12)',
        })
        weaponBar.appendChild(shop)
        hud.dataset.weapon = equipped
    }

    // Everything bottom-anchored is placed against the VISIBLE height, which may be shorter than
    // the layout viewport on a phone.
    const layout = () => {
        const centre = `${visibleWidth() / 2}px`
        ;[hud, help, weaponBar, bossBar, toast].forEach(node => {
            node.style.left = centre
        })
        const height = visibleHeight()
        weaponBar.style.top = `calc(${height}px - env(safe-area-inset-bottom, 0px) - 60px)`
        help.style.top = `calc(${height}px - env(safe-area-inset-bottom, 0px) - 70px)`
        help.style.transform = 'translate(-50%, -100%)'
        bombButton.style.top = `calc(${height}px - env(safe-area-inset-bottom, 0px) - 136px)`
        buffBar.style.bottom = 'auto'
        buffBar.style.top = `calc(${height}px - env(safe-area-inset-bottom, 0px) - 18px)`
        buffBar.style.transform = 'translateY(-100%)'
    }
    layout()

    let canStartOver = false
    const hangar = buildHangar({ strings, zIndex: zIndex + 4, actions })
    const gameOver = buildGameOver({ strings, zIndex: zIndex + 4, actions, canStartOver: () => canStartOver })
    const setCanStartOver = value => {
        canStartOver = !!value
        restart.style.display = canStartOver ? 'flex' : 'none'
        hud.dataset.saved = canStartOver ? 'true' : 'false'
    }

    return {
        elements: [hud, help, weaponBar, bombButton, buffBar, bossBar, toast, hangar.element, gameOver.element],
        hud,
        help,
        weaponBar,
        bossBar,
        bossLabel,
        bossFill,
        hangar,
        gameOver,
        showToast,
        update,
        setMuted,
        setCanStartOver,
        setBuffs,
        setCombo,
        renderWeapons,
        layout,
        dispose() {
            clearTimeout(toastTimer)
        },
    }
}

const panel = zIndex => {
    const backdrop = pillElement('div', {
        position: 'fixed',
        inset: '0',
        zIndex: String(zIndex),
        display: 'none',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(9,21,64,0.35)',
        padding: 'calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 16px)',
        boxSizing: 'border-box',
    })
    stopPointer(backdrop)
    const card = pillElement('div', {
        width: '100%',
        maxWidth: '460px',
        maxHeight: '100%',
        overflowY: 'auto',
        background: NAVY,
        color: '#FFFFFF',
        borderRadius: '22px',
        boxShadow: '0 12px 48px rgba(9,21,64,0.5)',
        font: `400 14px ${FONT}`,
        padding: '20px 20px 14px',
        boxSizing: 'border-box',
    })
    backdrop.appendChild(card)
    return { backdrop, card }
}

const itemStatus = (strings, item, run) => {
    if (item.id === 'repair') return `${Math.round(run.shield)} / ${run.maxShield}`
    if (item.id === 'bomb') return `${run.bombs} / ${MAX_BOMBS}`
    if (item.id === 'cannon') return `${run.cannonLevel} / ${MAX_CANNON_LEVEL}`
    return `${run.maxShield}`
}

/**
 * Between missions: the debrief, the credits you have, what they buy, the Gold weapon shop, and the
 * button that launches the next mission.
 */
const buildHangar = ({ strings, zIndex, actions }) => {
    const { backdrop, card } = panel(zIndex)
    backdrop.setAttribute(RAGE_LAYER_ATTRIBUTE, 'hangar')
    let current = null

    const render = () => {
        if (!current) return
        const { run, debrief, message } = current
        card.textContent = ''
        const title = pillElement('div', { font: `800 20px ${FONT}`, marginBottom: '4px' })
        title.textContent = `🏁 ${strings.missionComplete.replace('{n}', debrief.mission)}`
        const summary = pillElement('div', { color: 'rgba(255,255,255,0.75)', marginBottom: '12px' })
        summary.textContent = strings.debrief
            .replace('{kills}', debrief.kills.toLocaleString())
            .replace('{credits}', debrief.credits.toLocaleString())
        const heading = pillElement('div', { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' })
        const label = pillElement('div', { font: `700 16px ${FONT}`, flex: '1' })
        label.textContent = `🛠️ ${strings.hangar}`
        const balance = pillElement('div', { color: '#9CF0C8', fontWeight: '700' })
        balance.textContent = `💳 ${run.credits.toLocaleString()} ${strings.credits}`
        heading.append(label, balance)
        card.append(title, summary, heading)

        HANGAR_ITEMS.forEach((item, index) => {
            const text = strings.hangarItems[item.id]
            const row = pillElement('div', {
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 0',
                borderTop: index ? '1px solid rgba(255,255,255,0.1)' : 'none',
            })
            row.setAttribute('data-hangar-item', item.id)
            const icon = pillElement('div', { fontSize: '24px', width: '32px', textAlign: 'center' })
            icon.textContent = item.icon
            const body = pillElement('div', { flex: '1', minWidth: '0' })
            const name = pillElement('div', { fontWeight: '600' })
            name.textContent = `${text.name} · ${itemStatus(strings, item, run)}`
            const description = pillElement('div', { color: 'rgba(255,255,255,0.65)', fontSize: '12px' })
            description.textContent = text.description
            body.append(name, description)
            if (message && message.id === item.id) {
                const note = pillElement('div', { fontSize: '12px', marginTop: '3px', color: '#FF8A80' })
                note.textContent = message.text
                body.appendChild(note)
            }
            let action
            if (!item.available(run)) {
                action = pillElement('span', { color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontWeight: '600' })
                action.textContent = strings.maxed
            } else {
                action = wideButton(`💳 ${item.price(run)}`, run.credits >= item.price(run), () =>
                    actions.buyHangar(item.id)
                )
                action.style.padding = '7px 12px'
            }
            row.append(icon, body, action)
            card.appendChild(row)
        })

        const footer = pillElement('div', {
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            justifyContent: 'flex-end',
            marginTop: '14px',
        })
        const gold = wideButton(`🪙 ${strings.goldWeapons}`, false, actions.openGoldShop)
        const restart = confirmingButton(`↺ ${strings.startOver}`, strings.startOverConfirm, actions.startOver)
        const leave = wideButton(strings.exit, false, actions.exit)
        const launch = wideButton(`🚀 ${strings.launchMission.replace('{n}', run.mission + 1)}`, true, actions.launch)
        launch.setAttribute('data-launch', 'true')
        footer.append(gold, restart, leave, launch)
        card.appendChild(footer)
    }

    return {
        element: backdrop,
        show(state) {
            current = state
            render()
            backdrop.style.display = 'flex'
        },
        update(state) {
            current = { ...current, ...state }
            render()
        },
        hide() {
            backdrop.style.display = 'none'
            current = null
        },
        isOpen: () => backdrop.style.display !== 'none',
    }
}

/** The game-over card: score, best, and "play again" / "exit". */
const buildGameOver = ({ strings, zIndex, actions, canStartOver }) => {
    const { backdrop, card } = panel(zIndex)
    backdrop.setAttribute(RAGE_LAYER_ATTRIBUTE, 'gameover')
    card.style.textAlign = 'center'
    card.style.maxWidth = '340px'
    const title = pillElement('div', { font: `800 22px ${FONT}`, marginBottom: '10px' })
    title.textContent = `💥 ${strings.gameOver}`
    const scoreLine = pillElement('div', { font: `700 30px ${FONT}`, color: '#FFCE8F' })
    const missionLine = pillElement('div', { color: 'rgba(255,255,255,0.7)', marginTop: '2px' })
    const bestLine = pillElement('div', { color: 'rgba(255,255,255,0.7)', marginTop: '4px' })
    const newBest = pillElement('div', { color: '#9CF0C8', fontWeight: '700', marginTop: '6px', display: 'none' })
    newBest.textContent = `🏆 ${strings.newHighscore}`
    const buttons = pillElement('div', { display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' })
    const restart = confirmingButton(`↺ ${strings.startOver}`, strings.startOverConfirm, actions.startOver)
    buttons.style.flexWrap = 'wrap'
    // Spend the Gold on a better weapon before the next go.
    const shop = wideButton(`🪙 ${strings.goldWeapons}`, false, actions.openGoldShop)
    shop.setAttribute('data-shop', 'true')
    buttons.append(
        wideButton(strings.playAgain, true, actions.playAgain),
        shop,
        restart,
        wideButton(strings.exit, false, actions.exit)
    )
    card.append(title, scoreLine, missionLine, bestLine, newBest, buttons)
    return {
        element: backdrop,
        show({ score, best, isNew, mission }) {
            scoreLine.textContent = score.toLocaleString()
            missionLine.textContent = strings.mission.replace('{n}', mission)
            bestLine.textContent = `${strings.best}: ${best.toLocaleString()}`
            newBest.style.display = isNew ? 'block' : 'none'
            restart.style.display = canStartOver() ? 'flex' : 'none'
            backdrop.style.display = 'flex'
        },
        update({ best, isNew }) {
            bestLine.textContent = `${strings.best}: ${best.toLocaleString()}`
            newBest.style.display = isNew ? 'block' : 'none'
        },
        hide() {
            backdrop.style.display = 'none'
        },
        isOpen: () => backdrop.style.display !== 'none',
    }
}
