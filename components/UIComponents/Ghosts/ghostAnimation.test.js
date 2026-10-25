import { StyleSheet as WebStyleSheet } from 'react-native-web'
import { createSheet } from 'react-native-web/dist/exports/StyleSheet/dom'

import { ghostShimmerStyles } from './ghostAnimation'
import { GHOST_DEFAULT_ROWS, GHOST_MAX_ROWS, resolveGhostRowCount } from './ghostRowCount'

/**
 * AT-2382 — the shimmer is the one part of the ghost system that can fail completely
 * silently: react-native-web compiles `animationKeyframes` at StyleSheet.create time, and
 * a step it cannot serialize is emitted as a rule the browser simply drops. No warning, no
 * error, no test failure — just a ghost that sits still. So assert against the CSS text
 * react-native-web actually produces, not against the style object we handed it.
 */
describe('ghost shimmer stylesheet', () => {
    const compiledCss = () => {
        // Touching the style registers its rules in react-native-web's sheet.
        void ghostShimmerStyles.sweep
        void WebStyleSheet
        return createSheet().getTextContent()
    }

    it('emits a real gradient background rather than dropping the property', () => {
        expect(compiledCss()).toContain('background-image: linear-gradient')
    })

    it('emits keyframes that actually move the highlight band across the block', () => {
        const css = compiledCss()

        // The regression this pins: `transform: [{ translateX: '-140%' }]` (the normal
        // react-native transform form) serializes to the literal string "[object Object]"
        // inside a keyframe step. Both endpoints must be real CSS transform functions.
        expect(css).toContain('transform: translateX(-140%)')
        expect(css).toContain('transform: translateX(340%)')
        expect(css).not.toContain('transform: [object Object]')
    })
})

describe('resolveGhostRowCount', () => {
    it('matches the batch that was requested', () => {
        expect(resolveGhostRowCount(4)).toBe(4)
    })

    it('caps a large or unbounded batch so the ghost never fills the viewport', () => {
        expect(resolveGhostRowCount(15)).toBe(GHOST_MAX_ROWS)
        expect(resolveGhostRowCount(Infinity)).toBe(GHOST_MAX_ROWS)
    })

    it('falls back when the batch size is unknown', () => {
        // Number(null) is 0 and Number(undefined) is NaN; both mean "unknown" here, and a
        // naive numeric coercion would silently turn the first one into zero ghost rows.
        expect(resolveGhostRowCount(undefined)).toBe(GHOST_DEFAULT_ROWS)
        expect(resolveGhostRowCount(null)).toBe(GHOST_DEFAULT_ROWS)
        expect(resolveGhostRowCount(0)).toBe(GHOST_DEFAULT_ROWS)
        expect(resolveGhostRowCount(-3)).toBe(GHOST_DEFAULT_ROWS)
        expect(resolveGhostRowCount('nonsense')).toBe(GHOST_DEFAULT_ROWS)
    })

    it('honours a caller-supplied fallback and cap', () => {
        expect(resolveGhostRowCount(undefined, { fallback: 2 })).toBe(2)
        expect(resolveGhostRowCount(10, { max: 3 })).toBe(3)
    })

    it('never renders zero rows once a caller has decided to show ghosts', () => {
        expect(resolveGhostRowCount(1)).toBe(1)
        expect(resolveGhostRowCount(undefined, { fallback: 0 })).toBe(1)
    })
})
