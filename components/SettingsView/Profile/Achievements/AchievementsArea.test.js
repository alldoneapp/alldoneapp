import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'
import moment from 'moment'

import AchievementsArea, { EmptyInboxOverview, getGridWidth } from './AchievementsArea'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, values = {}) => (values.date ? `${key} ${values.date}` : key),
}))

const flattenStyle = style =>
    []
        .concat(style)
        .flat(Infinity)
        .filter(Boolean)
        .reduce((merged, item) => ({ ...merged, ...item }), {})

// AT-2362: renders the card, reports `cardWidth` through its onLayout, and returns the
// centered activity-grid block together with the width available inside the card padding.
const renderGrid = cardWidth => {
    let tree
    renderer.act(() => {
        tree = renderer.create(<EmptyInboxOverview user={{ emptyInboxDays: [] }} />)
    })
    const card = tree.root.find(node => typeof node.props.onLayout === 'function')

    renderer.act(() => {
        card.props.onLayout({ nativeEvent: { layout: { width: cardWidth } } })
    })

    const grid = tree.root.find(node => flattenStyle(node.props.style).alignSelf === 'center')

    return { grid: flattenStyle(grid.props.style), contentWidth: cardWidth - 40 }
}

describe('AchievementsArea', () => {
    it('renders empty inbox achievement metrics and activity', () => {
        const tree = renderer.create(
            <AchievementsArea
                user={{
                    emptyInboxDays: [
                        moment().subtract(2, 'days').format('YYYY-MM-DD'),
                        moment().subtract(1, 'day').format('YYYY-MM-DD'),
                    ],
                }}
            />
        )
        const textValues = tree.root.findAllByType(Text).map(item => item.props.children)

        expect(textValues).toContain('Achievements')
        expect(textValues).toContain('Empty inbox')
        expect(textValues).toContain('Current streak')
        expect(textValues).toContain('Longest streak')
        expect(textValues).toContain('Total days')
        expect(textValues).toContain(2)
    })

    it('makes the card clickable when a profile-navigation handler is provided', () => {
        const onOpenAchievements = jest.fn()
        const tree = renderer.create(
            <EmptyInboxOverview user={{ emptyInboxDays: [] }} onOpenAchievements={onOpenAchievements} />
        )
        const card = tree.root.findByProps({ accessibilityRole: 'link' })

        card.props.onPress()

        expect(tree.root.findAllByProps({ children: 'View your achievements in Settings > Profile' })).toHaveLength(0)
        expect(onOpenAchievements).toHaveBeenCalledTimes(1)
    })

    it('centers the day grid inside a wide card instead of hugging its left edge (AT-2362)', () => {
        const { grid, contentWidth } = renderGrid(1400)

        // 53 weeks (the one-year cap) + the day-label column, i.e. narrower than the card.
        expect(grid.width).toBe(getGridWidth(53))
        expect(grid.width).toBeLessThan(contentWidth)
        expect(grid.alignSelf).toBe('center')
    })

    it('keeps the grid inside the card on narrow screens (AT-2362)', () => {
        const { grid, contentWidth } = renderGrid(320)

        expect(grid.width).toBeLessThanOrEqual(contentWidth)
        expect(grid.alignSelf).toBe('center')
    })
})
