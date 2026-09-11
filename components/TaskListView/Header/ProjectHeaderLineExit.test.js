import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo, StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import ProjectHeader from './ProjectHeader'
import ProjectSection from '../ProjectSection'
import { SWEEP_LEAD_MS, SWEEP_TOTAL_MS } from '../OpenTasksView/projectCompletedSweepMotion'
import { DISSOLVE_MASK_IMAGE, DISSOLVE_MASK_SIZE, SPARK_COUNT } from '../OpenTasksView/projectLineDisintegration'
import { PROJECT_COLOR_RED, PROJECT_COLOR_SYSTEM } from '../../../Themes/Modern/ProjectColors'

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: jest.fn() }))
jest.mock('../../../redux/store', () => ({ getState: () => ({ loggedUserProjectsMap: {} }) }))
jest.mock('../../../redux/actions', () => ({ setSelectedNavItem: jest.fn(() => ({ type: 'noop' })) }))
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('./ProjectAndUserData', () => 'ProjectAndUserData')
jest.mock('./TagsArea', () => 'TagsArea')
jest.mock('../../RootView/RootSectionNavigation', () => 'RootSectionNavigation')

/**
 * AT-2495 / AT-2535 — the WIRING, which is where this feature can most easily be broken without any
 * of the unit suites noticing.
 *
 * `ProjectSection` owns the run, because the same sequence drives two things on two different nodes:
 * the sweep overlay across the full card, and the mask that erases that rounded card. Three ways
 * to get that wrong, all of which look fine in isolation:
 *
 *   • masking the old 57px header, so the new card body survives the dissolve;
 *   • rendering the particle layer INSIDE the masked node, where the mask erases the very dust it
 *     is shedding;
 *   • leaving the card's bottom spacing static, so the last 28px disappears as a jump.
 *
 * jsdom lays nothing out, so the card's height is handed in through `onLayout` by hand, and
 * `__mocks__/react-native.js` stubs `Animated.timing`, so what is driven here is the schedule.
 */

const PROJECT = 'project-a'
const PROJECT_COLOR = PROJECT_COLOR_RED
const PROJECT_LINE_COLOR = PROJECT_COLOR_SYSTEM[PROJECT_COLOR].PROJECT_ITEM_ACTIVE
const CARD_HEIGHT = 96
const CARD_BOTTOM_SPACING = 28

const findAll = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false })
const countOf = (tree, testID) => findAll(tree, testID).length
const rawStyle = node => Object.assign({}, ...[].concat(node.props.style).filter(Boolean))

describe('the project card leaving the board (AT-2535)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.useFakeTimers()
        window.matchMedia = jest.fn(() => ({
            matches: false,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            addListener: jest.fn(),
            removeListener: jest.fn(),
        }))
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        useSelector.mockImplementation(selector =>
            selector({
                currentUser: { uid: 'u1' },
                loggedUser: { uid: 'u1' },
                selectedSidebarTab: 'tasks',
                smallScreenNavigation: false,
                smallScreenNavSidebarCollapsed: false,
                loggedUserProjectsMap: { [PROJECT]: { color: PROJECT_COLOR } },
            })
        )
        process.env.NODE_ENV = 'development'
    })

    afterEach(() => {
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
        jest.clearAllMocks()
    })

    const card = (props = {}) => (
        <ProjectSection
            projectColor={PROJECT_COLOR}
            style={{ marginBottom: CARD_BOTTOM_SPACING }}
            completedSweepRunId={props.completedSweepRunId}
            completedSweepLineWillLeave={props.completedSweepLineWillLeave}
        >
            <ProjectHeader projectIndex={0} projectId={PROJECT} />
            <View testID="project-card-body" style={{ height: CARD_HEIGHT - 57 }} />
        </ProjectSection>
    )

    // `deep: false`: react-native-web's Animated.View matches both as the composite element and as
    // the host View it renders, which silently doubles every count.
    const lineNode = tree => findAll(tree, 'project-line')[0]
    const cardNode = tree => findAll(tree, 'project-section')[0]

    const mount = async props => {
        let tree
        await act(async () => {
            tree = renderer.create(card(props))
        })
        // The measurement the complete rounded card gets from layout in a browser.
        await act(async () => {
            cardNode(tree).props.onLayout({ nativeEvent: { layout: { height: CARD_HEIGHT, width: 900 } } })
        })
        return tree
    }

    const advance = async ms => {
        await act(async () => {
            jest.advanceTimersByTime(ms)
        })
    }

    it('renders an ordinary header with no mask and no particles', async () => {
        const tree = await mount()

        expect(rawStyle(cardNode(tree)).maskImage).toBeUndefined()
        expect(countOf(tree, 'project-line-disintegration')).toBe(0)
        expect(countOf(tree, 'project-completed-sweep')).toBe(0)
    })

    it('costs every other board in the app nothing — no run id, no exit, ever', async () => {
        // Chats, contacts, notes, goals, done and pending all render this component and pass neither
        // prop. A mask left on for them would be a permanent compositing layer per project card.
        const tree = await mount({ completedSweepLineWillLeave: true })
        await advance(SWEEP_TOTAL_MS + 500)

        expect(rawStyle(cardNode(tree)).maskImage).toBeUndefined()
        expect(countOf(tree, 'project-line-disintegration')).toBe(0)
    })

    it('sweeps in place when the line is staying, and never masks it', async () => {
        const tree = await mount({ completedSweepRunId: 1, completedSweepLineWillLeave: false })

        expect(countOf(tree, 'project-completed-sweep')).toBe(1)
        const overlayStyle = rawStyle(findAll(tree, 'project-completed-sweep')[0])
        expect(overlayStyle).toMatchObject({ top: 0, right: 0, bottom: 0, left: 0, borderRadius: 12 })
        expect(rawStyle(findAll(tree, 'project-completed-sweep-accent')[0]).backgroundColor).toBe(PROJECT_LINE_COLOR)

        await advance(SWEEP_LEAD_MS + 50)
        expect(rawStyle(cardNode(tree)).maskImage).toBeUndefined()
        expect(countOf(tree, 'project-line-disintegration')).toBe(0)
    })

    describe('when the line is leaving', () => {
        it('masks the complete card — header, body and sweep overlay go with it', async () => {
            const tree = await mount({ completedSweepRunId: 1, completedSweepLineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 50)

            const card = cardNode(tree)
            const style = rawStyle(card)
            expect(style.maskImage).toBe(DISSOLVE_MASK_IMAGE)
            expect(style.WebkitMaskImage).toBe(DISSOLVE_MASK_IMAGE)
            expect(style.maskSize).toBe(DISSOLVE_MASK_SIZE)
            expect(style.height.__getValue()).toBe(CARD_HEIGHT)
            expect(style.marginBottom.__getValue()).toBe(CARD_BOTTOM_SPACING)

            // The whole card is inside the masked node: the sweep, header and body. Masking the old
            // header node would leave the rounded card surface hanging after its content had gone.
            expect(card.findAllByProps({ testID: 'project-completed-sweep' }).length).toBeGreaterThan(0)
            expect(card.findAllByProps({ testID: 'project-card-body' })).toHaveLength(1)
        })

        it('sheds its dust and sparks OUTSIDE the mask, or they would be erased by it', async () => {
            const tree = await mount({ completedSweepRunId: 1, completedSweepLineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 50)

            expect(countOf(tree, 'project-line-disintegration')).toBe(1)
            expect(countOf(tree, 'project-line-disintegration-spark')).toBe(SPARK_COUNT)
            // The particle layer must NOT be a descendant of the masked card.
            expect(cardNode(tree).findAllByProps({ testID: 'project-line-disintegration' })).toHaveLength(0)
        })

        it('uses the exact visible project-line colour for the sweep and particles', async () => {
            const tree = await mount({ completedSweepRunId: 1, completedSweepLineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 50)

            const lineSurface = lineNode(tree).findAll(node => rawStyle(node).backgroundColor)[0]
            const lineStyle = rawStyle(lineSurface)
            const accentColor = rawStyle(findAll(tree, 'project-completed-sweep-accent')[0]).backgroundColor
            const armColours = findAll(tree, 'project-line-disintegration-spark-arm').map(
                arm => rawStyle(arm).backgroundColor
            )

            expect(lineStyle.backgroundColor).toBe(PROJECT_LINE_COLOR)
            expect(accentColor).toBe(lineStyle.backgroundColor)
            expect(armColours).toContain(lineStyle.backgroundColor)
            expect(lineStyle.backgroundColor).not.toBe(PROJECT_COLOR)
        })

        it('freezes the particle layer at the full card height, not the height it is collapsing to', async () => {
            const tree = await mount({ completedSweepRunId: 1, completedSweepLineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 50)

            const layerStyle = StyleSheet.flatten(findAll(tree, 'project-line-disintegration')[0].props.style)
            expect(layerStyle.height).toBe(CARD_HEIGHT)
            expect(layerStyle.position).toBe('absolute')
        })

        it('stands down completely under reduced motion', async () => {
            AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
            window.matchMedia = jest.fn(query => ({
                matches: query.includes('reduce'),
                addEventListener: jest.fn(),
                removeEventListener: jest.fn(),
                addListener: jest.fn(),
                removeListener: jest.fn(),
            }))

            const tree = await mount({ completedSweepRunId: 1, completedSweepLineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 500)

            expect(rawStyle(cardNode(tree)).maskImage).toBeUndefined()
            expect(countOf(tree, 'project-line-disintegration')).toBe(0)
            expect(countOf(tree, 'project-completed-sweep')).toBe(0)
        })
    })
})
