import React from 'react'
import renderer from 'react-test-renderer'
import moment from 'moment'
import { useDispatch, useSelector } from 'react-redux'

import AllProjectsEmptyInbox from './AllProjectsEmptyInbox'
import { resetEmptyInboxCelebrationSessionMarkers } from '../../SettingsView/Profile/Achievements/emptyInboxCelebrationMarker'
import NavigationService from '../../../utils/NavigationService'
import { navigateToSettings } from '../../../redux/actions'
import { DV_TAB_SETTINGS_PROFILE } from '../../../utils/TabNavigationConstants'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../redux/actions', () => ({
    navigateToSettings: jest.fn(options => ({ type: 'Navigate to settings', options })),
}))
jest.mock('./AllProjectsEmptyInboxAddTask', () => 'AllProjectsEmptyInboxAddTask')
jest.mock('./AllProjectsEmptyInboxTags', () => 'AllProjectsEmptyInboxTags')
jest.mock('./AllProjectsEmptyInboxText', () => 'AllProjectsEmptyInboxText')
jest.mock('./AllProjectsEmptyInboxPicture', () => 'AllProjectsEmptyInboxPicture')
jest.mock('../../SettingsView/Profile/Achievements/AchievementsArea', () => ({
    EmptyInboxOverview: 'EmptyInboxOverview',
}))

// The congrats headline now renders inside an Animated.View wrapper, so a flat scan of one node's
// children can no longer see it. Walk the tree instead of asserting on a single generation.
const renderedOrder = tree => {
    const types = []
    const visit = node => {
        if (!node || typeof node !== 'object') return
        types.push(node.type)
        ;(node.children || []).forEach(visit)
    }
    tree.root.children.forEach(visit)
    return types
}

describe('AllProjectsEmptyInbox', () => {
    // AT-2445: today is in the achievement days, i.e. the day has been earned and is waiting to be
    // celebrated — which is the state the board is in every time this block renders for real.
    const loggedUser = { uid: 'user-1', emptyInboxDays: ['2026-07-02', moment().format('YYYY-MM-DD')] }
    const dispatch = jest.fn()

    beforeEach(() => {
        jest.clearAllMocks()
        resetEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
        useDispatch.mockReturnValue(dispatch)
        useSelector.mockImplementation(selector => selector({ loggedUser }))
    })

    it('shows the achievement overview only when requested by the open-task view', () => {
        const genericEmptyInbox = renderer.create(<AllProjectsEmptyInbox />)
        expect(genericEmptyInbox.root.findAllByType('EmptyInboxOverview')).toHaveLength(0)

        const openTasksEmptyInbox = renderer.create(<AllProjectsEmptyInbox showEmptyInboxOverview />)
        const overview = openTasksEmptyInbox.root.findByType('EmptyInboxOverview')
        // react-native-web renders the container View as a host div, so order
        // the mocked children through the overview's rendered parent instead
        // of a 'View' node type lookup.
        const children = overview.parent.children

        expect(overview.props.user).toBe(loggedUser)
        overview.props.onOpenAchievements()
        const settingsOptions = {
            selectedNavItem: DV_TAB_SETTINGS_PROFILE,
            settingsScrollToTopToken: expect.any(Number),
        }
        expect(navigateToSettings).toHaveBeenCalledWith(settingsOptions)
        expect(dispatch).toHaveBeenCalledWith({
            type: 'Navigate to settings',
            options: settingsOptions,
        })
        expect(NavigationService.navigate).toHaveBeenCalledWith('SettingsView')
        expect(children[children.length - 2].type).toBe('EmptyInboxOverview')
        expect(children[children.length - 1].type).toBe('AllProjectsEmptyInboxPicture')
    })

    // AT-2306: adding a task is the primary action on this screen, so the button
    // sits directly under the congrats headline and the project list — which only
    // navigates — is demoted below it.
    it('puts the add-task button above the project list', () => {
        const emptyInbox = renderer.create(<AllProjectsEmptyInbox />)
        const order = renderedOrder(emptyInbox)

        expect(order.indexOf('AllProjectsEmptyInboxText')).toBeLessThan(order.indexOf('AllProjectsEmptyInboxAddTask'))
        expect(order.indexOf('AllProjectsEmptyInboxAddTask')).toBeLessThan(order.indexOf('AllProjectsEmptyInboxTags'))
    })

    /**
     * AT-2445 — the block, not just the achievement card, is what celebrates now.
     *
     * AT-2418 put the celebration on an 11px square at the far right of a 53-column year grid,
     * inside a card several blocks down the page. It is the right element to change and the wrong
     * place to be looked at, which is why this task reads "I still don't see an animation". The
     * congratulation itself is where the eye already is.
     */
    describe('the day celebration (AT-2445)', () => {
        it('decides the day once and hands the same run to the achievement card', () => {
            const tree = renderer.create(<AllProjectsEmptyInbox showEmptyInboxOverview celebrateNewDay />)
            const overview = tree.root.findByType('EmptyInboxOverview')

            // A run id, not a "please decide for yourself" flag: the confetti, the headline and the
            // card's dot are one event and must not each spend the day.
            expect(overview.props.celebrationRunId).toBe(1)
            expect(overview.props.celebrateNewDay).toBeUndefined()
        })

        // My Day renders this block WITHOUT the achievement card, and until now that meant clearing
        // your last task there celebrated nothing at all.
        it('celebrates without the achievement card', () => {
            const tree = renderer.create(<AllProjectsEmptyInbox celebrateNewDay />)

            expect(tree.root.findAllByType('EmptyInboxOverview')).toHaveLength(0)
            expect(tree.root.findAllByProps({ testID: 'empty-inbox-congrats-headline' }, { deep: false })).toHaveLength(
                1
            )
        })

        /**
         * The Done, Pending and Workflow all-projects boards render the same block. None of them is
         * an inbox-zero moment — an empty Done list means you have completed nothing today — and
         * letting them celebrate would let them SPEND the day, so the board that should have
         * celebrated would find it already gone.
         */
        it('does not spend the day from a board that is not an inbox', () => {
            const doneBoard = renderer.create(<AllProjectsEmptyInbox />)
            expect(doneBoard.root.findAllByType('EmptyInboxOverview')).toHaveLength(0)

            const openBoard = renderer.create(<AllProjectsEmptyInbox showEmptyInboxOverview celebrateNewDay />)

            expect(openBoard.root.findByType('EmptyInboxOverview').props.celebrationRunId).toBe(1)
        })

        // Under jest the motion is inert by convention, so nothing decorative is rendered and the
        // block is exactly the block a reload paints. A suite that wants the animated branch has to
        // opt out of that, the way `EmptyInboxCongratsCelebration.test.js` does.
        it('renders no confetti while the motion is inert', () => {
            const tree = renderer.create(<AllProjectsEmptyInbox showEmptyInboxOverview celebrateNewDay />)

            expect(tree.root.findAllByProps({ testID: 'empty-inbox-confetti' }, { deep: false })).toHaveLength(0)
        })
    })
})
