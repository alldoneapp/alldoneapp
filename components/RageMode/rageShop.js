import { RAGE_LAYER_ATTRIBUTE } from './rageTargets'

/**
 * The weapon shop panel: plain DOM inside the arena's own layers (the arena is not React). It shows
 * the Gold balance and every weapon with its price, and walks a purchase through
 * buy → confirm → buying… → owned (or a readable failure). Buying always needs the confirm step:
 * Gold can be bought with real money.
 *
 * It owns no data. `getState()` returns `{ owned: Set, equipped, gold, pending, confirm, message }`
 * and the callbacks change it; the panel only renders.
 */

const formatGold = value =>
    typeof value === 'number' && Number.isFinite(value) ? Math.floor(value).toLocaleString() : '—'

const button = (text, primary, onClick) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = text
    Object.assign(element.style, {
        border: 'none',
        borderRadius: '14px',
        padding: '7px 14px',
        font: '600 13px Roboto, system-ui, sans-serif',
        cursor: 'pointer',
        background: primary ? '#FFAE47' : 'rgba(255,255,255,0.14)',
        color: primary ? '#091540' : '#FFFFFF',
        whiteSpace: 'nowrap',
    })
    element.addEventListener('click', event => {
        event.stopPropagation()
        onClick()
    })
    element.addEventListener('pointerdown', event => event.stopPropagation())
    return element
}

export const buildShop = ({ strings, weapons, zIndex, getState, onBuy, onConfirm, onCancel, onEquip, onClose }) => {
    const backdrop = document.createElement('div')
    backdrop.setAttribute(RAGE_LAYER_ATTRIBUTE, 'shop')
    Object.assign(backdrop.style, {
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
    backdrop.addEventListener('pointerdown', event => {
        event.stopPropagation()
        if (event.target === backdrop) onClose()
    })

    const panel = document.createElement('div')
    Object.assign(panel.style, {
        width: '100%',
        maxWidth: '440px',
        maxHeight: '100%',
        overflowY: 'auto',
        background: '#091540',
        color: '#FFFFFF',
        borderRadius: '20px',
        boxShadow: '0 12px 48px rgba(9,21,64,0.5)',
        font: '400 14px Roboto, system-ui, sans-serif',
        padding: '18px 18px 10px',
        boxSizing: 'border-box',
    })
    backdrop.appendChild(panel)

    const render = () => {
        const state = getState()
        panel.textContent = ''

        const header = document.createElement('div')
        Object.assign(header.style, { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' })
        const title = document.createElement('div')
        title.textContent = `🛒 ${strings.shopTitle}`
        Object.assign(title.style, { font: '700 17px Roboto, system-ui, sans-serif', flex: '1' })
        const close = button('✕', false, onClose)
        close.setAttribute('aria-label', strings.close)
        header.append(title, close)

        const balance = document.createElement('div')
        balance.textContent = `🪙 ${formatGold(state.gold)} ${strings.gold}`
        Object.assign(balance.style, { color: '#FFCE8F', fontWeight: '600', marginBottom: '12px' })
        panel.append(header, balance)

        weapons.forEach((weapon, index) => {
            const text = (strings.weapons && strings.weapons[weapon.id]) || { name: weapon.id, description: '' }
            const owned = state.owned.has(weapon.id)
            const row = document.createElement('div')
            row.setAttribute('data-weapon', weapon.id)
            Object.assign(row.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 0',
                borderTop: index ? '1px solid rgba(255,255,255,0.1)' : 'none',
            })
            const icon = document.createElement('div')
            icon.textContent = weapon.icon
            Object.assign(icon.style, { fontSize: '26px', width: '34px', textAlign: 'center' })
            const body = document.createElement('div')
            body.style.flex = '1'
            body.style.minWidth = '0'
            const name = document.createElement('div')
            name.textContent = `${text.name}  ·  ${index + 1}`
            name.style.fontWeight = '600'
            const description = document.createElement('div')
            description.textContent = text.description
            Object.assign(description.style, { color: 'rgba(255,255,255,0.65)', fontSize: '12px', marginTop: '2px' })
            body.append(name, description)
            if (state.message && state.message.id === weapon.id) {
                const message = document.createElement('div')
                message.textContent = state.message.text
                Object.assign(message.style, {
                    fontSize: '12px',
                    marginTop: '4px',
                    color: state.message.tone === 'error' ? '#FF8A80' : '#9CF0C8',
                })
                body.appendChild(message)
            }

            const actions = document.createElement('div')
            Object.assign(actions.style, { display: 'flex', gap: '6px', alignItems: 'center' })
            if (owned) {
                if (state.equipped === weapon.id) {
                    const chip = document.createElement('span')
                    chip.textContent = `✓ ${strings.equipped}`
                    Object.assign(chip.style, { color: '#9CF0C8', fontWeight: '600', fontSize: '13px' })
                    actions.appendChild(chip)
                } else actions.appendChild(button(strings.equip, false, () => onEquip(weapon.id)))
            } else if (state.pending === weapon.id) {
                const busy = document.createElement('span')
                busy.textContent = strings.buying
                busy.style.fontSize = '13px'
                actions.appendChild(busy)
            } else if (state.confirm === weapon.id) {
                actions.append(
                    button(strings.confirmBuy.replace('{price}', weapon.price), true, () => onConfirm(weapon.id)),
                    button(strings.cancel, false, onCancel)
                )
            } else {
                actions.appendChild(button(`🪙 ${weapon.price}`, true, () => onBuy(weapon.id)))
            }
            row.append(icon, body, actions)
            panel.appendChild(row)
        })
    }

    return {
        element: backdrop,
        render,
        open() {
            render()
            backdrop.style.display = 'flex'
        },
        close() {
            backdrop.style.display = 'none'
        },
        isOpen: () => backdrop.style.display !== 'none',
    }
}
