import { useCallback, useLayoutEffect, useRef } from 'react'
import { useReducedMotion } from '../UIComponents/Ghosts/ghostAnimation'

// One moving target, rather than restarting a browser smooth-scroll for every token.
export default function useAnnaChatScroll(scroll, content, visible) {
    const reducedMotion = useReducedMotion()
    const follow = useRef(true)
    const frame = useRef(null)
    const initialized = useRef(false)
    const lastTop = useRef(0)
    const lastTouch = useRef(null)
    const cancel = useCallback(() => {
        if (frame.current !== null) cancelAnimationFrame(frame.current)
        frame.current = null
    }, [])
    const stop = useCallback(() => {
        follow.current = false
        cancel()
    }, [cancel])
    const update = useCallback(() => {
        const element = scroll.current
        if (!follow.current || !element || !visible || !element.clientHeight) return
        if (reducedMotion || !initialized.current) {
            element.scrollTop = element.scrollHeight
            lastTop.current = element.scrollTop
            initialized.current = true
            return
        }
        if (frame.current !== null) return
        let previousTime
        const tick = time => {
            frame.current = null
            if (!follow.current || !element.isConnected) return
            const target = Math.max(0, element.scrollHeight - element.clientHeight)
            const distance = target - element.scrollTop
            const elapsed = Math.min(64, previousTime === undefined ? 16 : time - previousTime)
            previousTime = time
            const step = Math.max(1, Math.abs(distance) * (1 - Math.exp(-elapsed / 65)))
            element.scrollTop = Math.abs(distance) <= 2 ? target : element.scrollTop + Math.sign(distance) * step
            lastTop.current = element.scrollTop
            if (Math.abs(target - element.scrollTop) >= 1) frame.current = requestAnimationFrame(tick)
        }
        frame.current = requestAnimationFrame(tick)
    }, [scroll, reducedMotion, visible])

    useLayoutEffect(() => {
        // Observe both: streamed markdown/images resize content, keyboards and the composer
        // resize the viewport. Neither necessarily changes a message prop.
        update()
        if (typeof ResizeObserver === 'undefined') return cancel
        const observer = new ResizeObserver(update)
        if (scroll.current) observer.observe(scroll.current)
        if (content.current) observer.observe(content.current)
        return () => {
            observer.disconnect()
            cancel()
        }
    }, [scroll, content, update, cancel])

    return {
        reducedMotion,
        follow,
        update,
        stop,
        latest: useCallback(() => {
            follow.current = true
            update()
        }, [update]),
        onScroll: useCallback(() => {
            const element = scroll.current
            if (!element) return false
            // Our own frames never move upwards. A reader can take over even inside
            // the bottom tolerance, before the next streamed layout arrives.
            const gap = element.scrollHeight - element.scrollTop - element.clientHeight
            // A shorter replacement may clamp scrollTop upwards while still at the bottom.
            if (gap <= 2) follow.current = true
            else if (element.scrollTop < lastTop.current - 1) stop()
            else if (frame.current === null)
                follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
            lastTop.current = element.scrollTop
            return follow.current
        }, [scroll, stop]),
        onWheel: useCallback(
            event => {
                if (event.deltaY < 0) stop()
            },
            [stop]
        ),
        onTouchStart: useCallback(event => {
            lastTouch.current = event.touches[0]?.clientY
        }, []),
        onTouchMove: useCallback(
            event => {
                const y = event.touches[0]?.clientY
                if (lastTouch.current !== null && y > lastTouch.current) stop()
                lastTouch.current = y
            },
            [stop]
        ),
        onKeyDown: useCallback(
            event => {
                if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) stop()
            },
            [stop]
        ),
    }
}
