import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Animated, StyleSheet } from 'react-native'

import EmptyInboxStreakValue from './EmptyInboxStreakValue'
import { STREAK_TICK_DELAY_MS } from './emptyInboxDotMotion'
import { colors } from '../../../styles/global'

const buildCelebration = ({ animated = true, celebrating = true } = {}) => ({
    land: new Animated.Value(1),
    burst: new Animated.Value(0),
    tick: new Animated.Value(0),
    animated,
    celebrating,
})

const renderValue = (celebration, value = 5) =>
    renderer.create(<EmptyInboxStreakValue value={value} celebration={celebration} style={{ fontSize: 20 }} />)

const displayedValue = tree =>
    tree.root.findByProps({ testID: 'empty-inbox-streak-value' }, { deep: false }).props.children

describe('EmptyInboxStreakValue', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('holds yesterday’s streak while the dot lands, then ticks up', () => {
        let tree
        act(() => {
            tree = renderValue(buildCelebration(), 5)
        })

        // The dot landing is what CAUSES the number to change; showing the new value from the first
        // frame would make the dot a decoration on a value that had already moved.
        expect(displayedValue(tree)).toBe(4)

        act(() => {
            jest.advanceTimersByTime(STREAK_TICK_DELAY_MS)
        })

        expect(displayedValue(tree)).toBe(5)
    })

    it('never shows a negative streak', () => {
        let tree
        act(() => {
            tree = renderValue(buildCelebration(), 1)
        })

        expect(displayedValue(tree)).toBe(0)
    })

    it('shows the value plainly when nothing is celebrating', () => {
        let tree
        act(() => {
            tree = renderValue(buildCelebration({ celebrating: false }), 5)
        })

        expect(displayedValue(tree)).toBe(5)
        expect(tree.root.findAllByProps({ testID: 'empty-inbox-streak-tick' }, { deep: false })).toHaveLength(0)
    })

    it('does not hold the value back under reduced motion', () => {
        let tree
        act(() => {
            tree = renderValue(buildCelebration({ animated: false }), 5)
        })

        expect(displayedValue(tree)).toBe(5)
        expect(tree.root.findAllByProps({ testID: 'empty-inbox-streak-tick' }, { deep: false })).toHaveLength(0)
    })

    // react-native-web renders Text as `display: inline`, and CSS transforms do not apply to inline
    // elements — a scale on the Text is silently dropped and the number simply never moves. The
    // scale therefore has to live on the wrapping View.
    it('puts the pop on a View and the colour flash on the Text', () => {
        const celebration = buildCelebration()
        let tree
        act(() => {
            tree = renderValue(celebration, 5)
        })

        const wrapper = tree.root.findByProps({ testID: 'empty-inbox-streak-tick' }, { deep: false })
        const wrapperStyle = StyleSheet.flatten(wrapper.props.style)
        const textStyle = StyleSheet.flatten(
            tree.root.findByProps({ testID: 'empty-inbox-streak-value' }, { deep: false }).props.style
        )

        expect(wrapperStyle.transform[0].scale.__getValue()).toBe(1)
        expect(textStyle.transform).toBeUndefined()

        celebration.tick.setValue(0.45)
        expect(wrapperStyle.transform[0].scale.__getValue()).toBeGreaterThan(1)

        celebration.tick.setValue(0.25)
        expect(textStyle.color.__getValue()).toContain(
            // The Animated colour interpolation resolves to an rgba() string, so compare on the
            // channels of the brand green rather than on the hex.
            [
                parseInt(colors.UtilityGreen200.slice(1, 3), 16),
                parseInt(colors.UtilityGreen200.slice(3, 5), 16),
                parseInt(colors.UtilityGreen200.slice(5, 7), 16),
            ].join(', ')
        )
    })
})
