import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { hideGoldChain, hideGoldCoin, setTriggerGoldAnimation } from '../../../redux/actions'
import { coinLanded, expectCoins } from './goldCounterBridge'

// `GoldAnimationsContainer` is mounted by the root view AND by every detailed view, so several
// copies of this can be listening to the same trigger. Each trigger object flies exactly once.
const launched = new WeakSet()
let unavailable = false

/** True once the 3D coins failed to start on this device; the Lottie fallback takes over. */
export const goldCoinsUnavailable = () => unavailable

const centreOf = element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

// Where the coins land: the Gold icon, else the XP badge, else where the top bar's gold usually is —
// the same fallback chain as the Lottie `GoldChain`.
const findTarget = (smallScreenNavigation, sidebarExpanded) => {
    const gold = document.getElementById('goldArea')
    if (gold) return centreOf(gold)
    const xp = document.getElementById('xpArea')
    if (xp) return centreOf(xp)
    return { x: smallScreenNavigation ? 50 : sidebarExpanded ? 352 : 150, y: 43 }
}

/**
 * The 3D version of the gold reward: real coins fly from the completed task's checkbox into the Gold
 * counter, which counts up as each one lands (`goldCounterBridge`). Renders nothing itself; the
 * coins live on the shared full-app overlay in `goldCoinsOverlay.js`, loaded on first use.
 */
export default function GoldCoinFlight() {
    const dispatch = useDispatch()
    const goldEarnedData = useSelector(state => state.goldEarnedData)
    const active = useSelector(state => state.showGoldCoin || state.showGoldChain)
    const gold = useSelector(state => state.loggedUser.gold)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)

    useEffect(() => {
        if (!active || !goldEarnedData || launched.has(goldEarnedData)) return
        launched.add(goldEarnedData)
        const { goldEarned, checkBoxId } = goldEarnedData
        // The Lottie flags are not used on this path; clear them so the Gold icon stays visible.
        dispatch(hideGoldChain())
        dispatch(hideGoldCoin())
        const checkBox = checkBoxId && document.querySelector(`[check-box-id="${checkBoxId}"]`)
        if (!checkBox || !goldEarned) return
        const from = centreOf(checkBox)
        const to = findTarget(smallScreenNavigation, sidebarExpanded)
        expectCoins(gold, goldEarned)
        import(/* webpackChunkName: "gold-coins" */ './goldCoinsOverlay')
            .then(({ launchGoldCoins }) =>
                launchGoldCoins({ from, to, count: goldEarned, onLanded: () => coinLanded() })
            )
            .catch(error => {
                console.warn('[gold coins] Falling back to the 2D animation', error)
                unavailable = true
                for (let i = 0; i < goldEarned; i++) coinLanded()
                dispatch(setTriggerGoldAnimation(goldEarned, checkBoxId))
            })
    }, [goldEarnedData, active])

    return null
}
