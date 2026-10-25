import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'
import moment from 'moment'

import AchievementsArea, { EmptyInboxOverview, getGridWidth } from './AchievementsArea'
import { resetEmptyInboxCelebrationSessionMarkers } from './emptyInboxCelebrationMarker'
import { CELEBRATION_CLAIM_SETTLE_MS } from './useTodayEmptyInboxCelebration'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, values = {}) =>
        values.date ? `${key} ${values.date}` : values.time ? `${key} ${values.time}` : key,
}))
// AT-2461: the card reports today's inbox-zero time in the user's own time format, which lives
// behind the redux store. Mocking the module keeps this suite a leaf, the way every other suite
// that reaches `getTimeFormat` already does.
jest.mock('../../../UIComponents/FloatModals/DateFormatPickerModal', () => ({ getTimeFormat: () => 'HH:mm' }))

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
        // AT-2445: `Date` stays real — the suite reads "today" through moment.
        jest.useFakeTimers({ doNotFake: ['Date', 'performance'] })
    })

    afterEach(() => {
        jest.useRealTimers()
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
            // AT-2445: a day is only spent once its run has been on screen long enough to be seen.
            // Tabbing away mid-run hands it back, so a "tab switch" has to actually let it play.
            renderer.act(() => jest.advanceTimersByTime(CELEBRATION_CLAIM_SETTLE_MS))
            renderer.act(() => firstVisit.unmount())

            const secondVisit = renderOverview({
                user: { uid: 'user-1', emptyInboxDays: [todayKey] },
                celebrateNewDay: true,
            })

            expect(todayDotsIn(secondVisit)).toHaveLength(0)
        })

        /**
         * AT-2461 — on a day that has been cleared the card names the time instead of explaining the
         * squares. The grid legend never changes and is the only line on this card that is not about
         * the user, so on the one day it is worth saying something, it says that.
         */
        describe('today’s inbox-zero time (AT-2461)', () => {
            const LEGEND = 'Empty inbox achievement description'
            // Built from the local start of day so the rendered time is the same string in every
            // timezone a CI runner might have.
            const reachedAt = moment().startOf('day').add(18, 'hours').add(34, 'minutes')
            const textsIn = tree => tree.root.findAllByType(Text).map(item => item.props.children)

            it('reports when the inbox was cleared on the all-projects board', () => {
                const tree = renderOverview({
                    user: { uid: 'user-1', emptyInboxDays: [todayKey], lastDayEmptyInbox: reachedAt.valueOf() },
                    celebrateNewDay: true,
                })
                const texts = textsIn(tree)

                expect(texts).toContain('Empty inbox reached today at 18:34')
                expect(texts).not.toContain(LEGEND)
            })

            // The same card renders in Settings → Profile, where the sentence is just as true.
            // That copy still must not celebrate, so this also pins that naming the time does not
            // quietly spend the once-per-day marker the board is waiting on.
            it('reports it in the profile card too, without celebrating', () => {
                const tree = renderOverview({
                    user: { uid: 'user-1', emptyInboxDays: [todayKey], lastDayEmptyInbox: reachedAt.valueOf() },
                })

                expect(textsIn(tree)).toContain('Empty inbox reached today at 18:34')
                expect(todayDotsIn(tree)).toHaveLength(0)
            })

            it('keeps the grid legend on a day that has not been reached', () => {
                const yesterday = moment().subtract(1, 'day')
                const tree = renderOverview({
                    user: {
                        uid: 'user-1',
                        emptyInboxDays: [yesterday.format('YYYY-MM-DD')],
                        lastDayEmptyInbox: yesterday.startOf('day').add(9, 'hours').valueOf(),
                    },
                })
                const texts = textsIn(tree)

                expect(texts).toContain(LEGEND)
                expect(texts.some(text => String(text).startsWith('Empty inbox reached today at'))).toBe(false)
            })

            // The line must never be empty, and it must never invent a time: an account with no
            // recorded moment falls all the way back to the copy that shipped before this.
            it('keeps the grid legend when no time was ever recorded', () => {
                const tree = renderOverview({ user: { uid: 'user-1', emptyInboxDays: [todayKey] } })

                expect(textsIn(tree)).toContain(LEGEND)
            })
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
