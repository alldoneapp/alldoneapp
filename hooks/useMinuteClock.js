import { useEffect, useState } from 'react'

import { subscribePageVisible } from '../utils/appResume'

const ONE_MINUTE = 60 * 1000
// Fire just after the minute turns, so a value read at the tick is already the new minute.
const TICK_SLACK_MS = 250

/** Milliseconds from `nowMs` to just after the next full minute. */
export const msUntilNextMinute = nowMs => ONE_MINUTE - (nowMs % ONE_MINUTE) + TICK_SLACK_MS

/**
 * The current time, refreshed at every full minute and whenever the page becomes visible again
 * (tab shown, window focused, frozen page thawed, bfcache restore: `utils/appResume.js` coalesces
 * those). For displays that derive "from now on" figures (AT-3136 time to work): a browser
 * throttles or freezes timers in a hidden tab, so the visible-again refresh is what makes the value
 * right the moment the user looks again.
 *
 * One chained timeout per mounted hook, re-aligned to the wall clock at every tick (a late tick
 * after a sleep does not drift), cleared on unmount.
 */
export default function useMinuteClock() {
    const [nowMs, setNowMs] = useState(() => Date.now())

    useEffect(() => {
        let timer = null
        let disposed = false

        const tick = () => {
            if (disposed) return
            clearTimeout(timer)
            const current = Date.now()
            setNowMs(current)
            timer = setTimeout(tick, msUntilNextMinute(current))
        }

        // The first render's time may be stale by the time this effect runs (deferred mount).
        tick()
        const unsubscribe = subscribePageVisible(tick)

        return () => {
            disposed = true
            clearTimeout(timer)
            unsubscribe()
        }
    }, [])

    return nowMs
}
