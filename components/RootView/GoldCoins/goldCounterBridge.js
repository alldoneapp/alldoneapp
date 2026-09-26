/**
 * Lets the Gold counter count up coin by coin while the coins fly in, before the server has
 * confirmed the reward — then hands back to the real balance.
 *
 * The balance on the user document only changes once `earnGoldSecondGen` has run, which can be
 * before, during or after the flight. So the counter shows `base + landed` while coins are still in
 * the air (`base` is the balance when the first coin launched), and afterwards whichever is higher
 * of that and the real balance, until the real balance has caught up — or, if the reward never
 * arrives, until `SETTLE_MS` after the last landing, when it falls back to the real balance.
 */

export const SETTLE_MS = 15000

let state = null
const listeners = new Set()
const landingListeners = new Set()
const notify = () => listeners.forEach(listener => listener())

export function expectCoins(currentGold, count, now = Date.now()) {
    if (!state) state = { base: Number(currentGold) || 0, expected: 0, landed: 0, settleAt: 0 }
    state.expected += count
    state.settleAt = now + SETTLE_MS
    notify()
}

export function coinLanded(now = Date.now()) {
    if (!state) return
    state.landed = Math.min(state.expected, state.landed + 1)
    state.settleAt = now + SETTLE_MS
    notify()
    // Re-render once the settle window has passed, in case the server never confirms.
    if (state.landed >= state.expected && typeof setTimeout === 'function') setTimeout(notify, SETTLE_MS + 50)
    landingListeners.forEach(listener => listener())
}

/** The number the counter should show, given the real balance. */
export function getDisplayedGold(realGold, now = Date.now()) {
    const real = Number(realGold) || 0
    if (!state) return real
    if (now > state.settleAt || (state.landed >= state.expected && real >= state.base + state.expected)) {
        state = null
        return real
    }
    if (state.landed < state.expected) return state.base + state.landed
    return Math.max(real, state.base + state.landed)
}

export const subscribeToGoldCounter = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export const subscribeToCoinLandings = listener => {
    landingListeners.add(listener)
    return () => landingListeners.delete(listener)
}

export const __resetGoldCounter = () => {
    state = null
}
