/**
 * AT-2503 browser harness — the Undo notification's show/hide animation, actually moving.
 *
 * Drives the REAL `useUndoActionBarMotion` and the REAL `undoActionBarStyles` on a node wired
 * exactly the way `UndoActionBar` wires them: the variant style and the nudge composed onto one
 * `Animated.View`, the message fade on the text inside it, the countdown line absolutely positioned
 * along its bottom edge.
 *
 * `UndoActionBar` itself is not mounted, for the same reason `at2495` does not mount
 * `ProjectHeader`: the component's job above the motion is a Firestore listener, a redux selector
 * and a Cloud Function call, none of which exist here and none of which AT-2503 touched. Everything
 * this task changed is the real module.
 *
 * Jest can see none of what is checked here, and there are four separate reasons:
 *
 *   1. `__mocks__/react-native.js` replaces `Animated.timing` with a no-op, so no jest test in this
 *      repo has ever watched one of these variants advance by a single frame. The jest suites
 *      assert the LIFECYCLE (does the banner survive its own dismissal?) and the GEOMETRY (do the
 *      keyframes land at rest?); whether the browser then paints that geometry is a different
 *      question and this is the only place it is asked.
 *   2. jsdom computes no layout, so the countdown line — whose entire behaviour is a painted width
 *      shrinking — has no observable width there at all.
 *   3. `transformOrigin` is a react-native-web passthrough. If RNW ever stopped forwarding it the
 *      line would silently start collapsing towards its own middle instead of draining, and every
 *      jest assertion about it would still pass.
 *   4. `prefers-reduced-motion` is a real media query. Under jest it is a mocked boolean.
 */
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Animated, Text, View } from 'react-native'

import undoActionBarStyles from '../../components/Undo/undoActionBarStyles'
import useUndoActionBarMotion from '../../components/Undo/undoActionBarMotion'

function Banner() {
    const [visible, setVisible] = useState(false)
    // Stands in for `${actionId}|${status}|${error}` — bumping it is what a status flip does.
    const [content, setContent] = useState(0)
    // Stands in for the `busy` gate on the auto-hide timer.
    const [countdownActive, setCountdownActive] = useState(true)

    const motion = useUndoActionBarMotion({
        visible,
        contentKey: `action|${content}`,
        countdownKey: `action|${content}`,
        countdownActive: visible && countdownActive,
    })

    window.__show = () => setVisible(true)
    window.__hide = () => setVisible(false)
    window.__flipContent = () => setContent(value => value + 1)
    window.__setCountdownActive = setCountdownActive

    if (!motion.rendered) return <View style={undoActionBarStyles.viewport} />

    return (
        <View pointerEvents="box-none" style={undoActionBarStyles.viewport}>
            <Animated.View
                style={[undoActionBarStyles.container, motion.containerStyle]}
                pointerEvents={motion.exiting ? 'none' : 'auto'}
                dataSet={{ undoAnimation: motion.variantId, undoAnimationPhase: motion.phase }}
                nativeID="undo-banner"
            >
                <Animated.Text numberOfLines={2} style={[undoActionBarStyles.message, motion.messageStyle]}>
                    Moved task
                </Animated.Text>
                <Text style={undoActionBarStyles.action}>Undo</Text>
                {motion.showCountdown && (
                    <Animated.View
                        pointerEvents="none"
                        aria-hidden={true}
                        style={[undoActionBarStyles.countdown, motion.countdownStyle]}
                        nativeID="undo-countdown"
                    />
                )}
            </Animated.View>
        </View>
    )
}

/**
 * Forces the next pick. The picker takes `Math.random` by default, so patching it here exercises
 * the REAL selection path — including the no-repeat rule, which the runner has to account for when
 * it computes the fraction that lands on the variant it wants.
 */
window.__setRandom = value => {
    Math.random = () => value
}

/**
 * Reads what the browser has actually painted. `getBoundingClientRect` reports the TRANSFORMED box,
 * which is what makes the countdown's `scaleX` measurable at all, and the computed `transform`
 * matrix is decomposed so a variant's travel, scale and rotation can each be checked separately.
 */
window.__measure = () => {
    const node = document.getElementById('undo-banner')
    if (!node) return { present: false }

    const style = window.getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    const matrix = style.transform && style.transform !== 'none' ? style.transform : null

    let translateX = 0
    let translateY = 0
    let scale = 1
    let rotation = 0
    if (matrix) {
        const parts = matrix
            .replace(/^matrix(3d)?\(/, '')
            .replace(/\)$/, '')
            .split(',')
            .map(Number)
        if (parts.length === 6) {
            const [a, b, , , tx, ty] = parts
            translateX = tx
            translateY = ty
            scale = Math.sqrt(a * a + b * b)
            rotation = (Math.atan2(b, a) * 180) / Math.PI
        }
    }

    const countdown = document.getElementById('undo-countdown')
    const message = node.querySelector('div[dir], span') || node.firstElementChild

    return {
        present: true,
        variant: node.dataset.undoAnimation,
        phase: node.dataset.undoAnimationPhase,
        opacity: Number(style.opacity),
        hasTransform: !!matrix,
        translateX: Math.round(translateX * 100) / 100,
        translateY: Math.round(translateY * 100) / 100,
        scale: Math.round(scale * 1000) / 1000,
        rotation: Math.round(rotation * 100) / 100,
        width: Math.round(rect.width),
        messageOpacity: message ? Number(window.getComputedStyle(message).opacity) : null,
        countdownPresent: !!countdown,
        // Whether the attribute made it onto the DOM node at all — react-native-web forwards
        // `aria-hidden` but silently drops the legacy accessibility props, and only a browser can
        // tell those two cases apart.
        countdownAriaHidden: countdown ? countdown.getAttribute('aria-hidden') : null,
        // The painted width, i.e. after scaleX. This is the drain.
        countdownWidth: countdown ? Math.round(countdown.getBoundingClientRect().width) : null,
        countdownOrigin: countdown ? window.getComputedStyle(countdown).transformOrigin : null,
    }
}

const root = createRoot(document.getElementById('root'))
root.render(<Banner />)
window.__ready = true
