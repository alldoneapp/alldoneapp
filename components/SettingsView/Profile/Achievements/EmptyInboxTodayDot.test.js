import React from 'react'
import renderer from 'react-test-renderer'
import { Animated, StyleSheet } from 'react-native'

import EmptyInboxTodayDot from './EmptyInboxTodayDot'
import { colors } from '../../../styles/global'

const CELL_SIZE = 11
const CELL_GAP = 3
const CELL_RADIUS = 2

const buildCelebration = ({ animated = true, celebrating = true } = {}) => ({
    land: new Animated.Value(celebrating ? 0 : 1),
    burst: new Animated.Value(0),
    tick: new Animated.Value(0),
    animated,
    celebrating,
})

const renderDot = celebration =>
    renderer.create(
        <EmptyInboxTodayDot
            celebration={celebration}
            size={CELL_SIZE}
            gap={CELL_GAP}
            radius={CELL_RADIUS}
            accessibilityLabel="Empty inbox reached on August 24, 2026"
        />
    )

// An Animated.View matches both as the composite element and as the host View it renders, which
// silently doubles every count (AT-2404 learned this the hard way).
const countOf = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false }).length

describe('EmptyInboxTodayDot', () => {
    it('keeps the exact layout box of the plain grid cell', () => {
        // The grid measures its own intrinsic width to centre itself (AT-2362). A celebrating cell
        // that occupied one pixel more or less would shift the whole grid under the animation.
        const style = StyleSheet.flatten(
            renderDot(buildCelebration()).root.findByProps({ testID: 'empty-inbox-today-dot' }, { deep: false }).props
                .style
        )

        expect(style.width).toBe(CELL_SIZE)
        expect(style.height).toBe(CELL_SIZE)
        expect(style.marginBottom).toBe(CELL_GAP)
        expect(style.borderRadius).toBe(CELL_RADIUS)
    })

    it('paints the grey square underneath the green fill', () => {
        // This is what makes the pop read as the dot being ADDED rather than a green square
        // flashing out of the card background.
        const tree = renderDot(buildCelebration())
        const baseStyle = StyleSheet.flatten(
            tree.root.findByProps({ testID: 'empty-inbox-dot-base' }, { deep: false }).props.style
        )
        const fillStyle = StyleSheet.flatten(
            tree.root.findByProps({ testID: 'empty-inbox-dot-fill' }, { deep: false }).props.style
        )

        expect(baseStyle.backgroundColor).toBe(colors.Grey200)
        expect(fillStyle.backgroundColor).toBe(colors.UtilityGreen200)
    })

    it('renders the burst layers while a run is playing', () => {
        const tree = renderDot(buildCelebration())

        expect(countOf(tree, 'empty-inbox-dot-halo')).toBe(1)
        expect(countOf(tree, 'empty-inbox-dot-ring')).toBe(1)
        expect(countOf(tree, 'empty-inbox-dot-spark')).toBe(6)
        expect(countOf(tree, 'empty-inbox-dot-fill')).toBe(1)
    })

    it('drops every decorative layer once the run has settled', () => {
        const tree = renderDot(buildCelebration({ celebrating: false }))

        expect(countOf(tree, 'empty-inbox-dot-halo')).toBe(0)
        expect(countOf(tree, 'empty-inbox-dot-ring')).toBe(0)
        expect(countOf(tree, 'empty-inbox-dot-spark')).toBe(0)
        // The dot itself stays — at rest it IS the achieved cell.
        expect(countOf(tree, 'empty-inbox-dot-fill')).toBe(1)
    })

    it('renders no ring or sparks under reduced motion', () => {
        // They are pure motion and carry no information; the green fill carries all of it.
        const tree = renderDot(buildCelebration({ animated: false }))

        expect(countOf(tree, 'empty-inbox-dot-halo')).toBe(0)
        expect(countOf(tree, 'empty-inbox-dot-ring')).toBe(0)
        expect(countOf(tree, 'empty-inbox-dot-spark')).toBe(0)
        expect(countOf(tree, 'empty-inbox-dot-fill')).toBe(1)
    })

    it('keeps the achieved cell accessible', () => {
        const root = renderDot(buildCelebration()).root.findByProps(
            { testID: 'empty-inbox-today-dot' },
            { deep: false }
        )

        expect(root.props.accessible).toBe(true)
        expect(root.props.accessibilityLabel).toBe('Empty inbox reached on August 24, 2026')
    })

    it('scales the fill from nothing through an overshoot and back to exactly 1', () => {
        const celebration = buildCelebration()
        const tree = renderDot(celebration)
        const scaleOf = () =>
            StyleSheet.flatten(
                tree.root.findByProps({ testID: 'empty-inbox-dot-fill' }, { deep: false }).props.style
            ).transform[0].scale.__getValue()

        expect(scaleOf()).toBe(0)

        celebration.land.setValue(0.4)
        expect(scaleOf()).toBeGreaterThan(1)

        // Resting at exactly 1 is what lets a settled cell be pixel-identical to a plain one.
        celebration.land.setValue(1)
        expect(scaleOf()).toBe(1)
    })

    it('keeps the expanding layers outside the fill that is scaling from zero', () => {
        // A ring nested inside the node scaling from 0 would be squashed to nothing exactly when it
        // is meant to be expanding.
        const tree = renderDot(buildCelebration())
        const fill = tree.root.findByProps({ testID: 'empty-inbox-dot-fill' }, { deep: false })

        expect(fill.findAllByProps({ testID: 'empty-inbox-dot-ring' }, { deep: false })).toHaveLength(0)
        expect(fill.findAllByProps({ testID: 'empty-inbox-dot-spark' }, { deep: false })).toHaveLength(0)
    })
})
