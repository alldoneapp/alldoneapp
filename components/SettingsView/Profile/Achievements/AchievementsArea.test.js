import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'
import moment from 'moment'

import AchievementsArea, { EmptyInboxOverview, getGridWidth } from './AchievementsArea'
import { resetEmptyInboxCelebrationSessionMarkers } from './emptyInboxCelebrationMarker'

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

const renderOverview = (props = {}) => {
    let tree
    renderer.act(() => {
        tree = renderer.create(<EmptyInboxOverview user={{ uid: 'user-1', emptyInboxDays: [] }} {...props} />)
    })
    return tree
}

const todayDotsIn = tree => tree.root.findAllByProps({ testID: 'empty-inbox-today-dot' }, { deep: false })

describe('AchievementsArea', () => {
    beforeEach(() => {
        resetEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
    })

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

    // AT-2418 — the celebration is now the day's own cell being added to the grid, so the wiring
    // that matters is "which cell becomes the animated one, and when".
    describe('today’s dot (AT-2418)', () => {
        const todayKey = moment().format('YYYY-MM-DD')

        it('hands today’s cell to the animated dot when the board celebrates it', () => {
            const tree = renderOverview({
                user: { uid: 'user-1', emptyInboxDays: [todayKey] },
                celebrateNewDay: true,
            })

            expect(todayDotsIn(tree)).toHaveLength(1)
        })

        it('leaves every other cell a plain View', () => {
            // Exactly one cell may be replaced: the grid is 371 squares and the celebration is one
            // of them.
            const tree = renderOverview({
                user: {
                    uid: 'user-1',
                    emptyInboxDays: [todayKey, moment().subtract(1, 'day').format('YYYY-MM-DD')],
                },
                celebrateNewDay: true,
            })

            expect(todayDotsIn(tree)).toHaveLength(1)
        })

        it('does not touch the grid when there is nothing to celebrate', () => {
            const tree = renderOverview({
                user: { uid: 'user-1', emptyInboxDays: [moment().subtract(1, 'day').format('YYYY-MM-DD')] },
                celebrateNewDay: true,
            })

            expect(todayDotsIn(tree)).toHaveLength(0)
        })

        // The same overview renders in Settings → Profile. It shows the streak, it does not
        // celebrate, and it must not spend the once-per-day marker the board is waiting on.
        it('never celebrates in the profile card', () => {
            const profileCard = renderOverview({ user: { uid: 'user-1', emptyInboxDays: [todayKey] } })
            expect(todayDotsIn(profileCard)).toHaveLength(0)

            const board = renderOverview({
                user: { uid: 'user-1', emptyInboxDays: [todayKey] },
                celebrateNewDay: true,
            })
            expect(todayDotsIn(board)).toHaveLength(1)
        })

        it('celebrates a day only once, so a tab switch back does not replay it', () => {
            const firstVisit = renderOverview({
                user: { uid: 'user-1', emptyInboxDays: [todayKey] },
                celebrateNewDay: true,
            })
            expect(todayDotsIn(firstVisit)).toHaveLength(1)
            renderer.act(() => firstVisit.unmount())

            const secondVisit = renderOverview({
                user: { uid: 'user-1', emptyInboxDays: [todayKey] },
                celebrateNewDay: true,
            })

            expect(todayDotsIn(secondVisit)).toHaveLength(0)
        })

        it('ticks the current streak through the celebration, not the other metrics', () => {
            const tree = renderOverview({
                user: { uid: 'user-1', emptyInboxDays: [todayKey] },
                celebrateNewDay: true,
            })

            expect(tree.root.findAllByProps({ testID: 'empty-inbox-streak-value' }, { deep: false })).toHaveLength(1)
        })
    })
})
