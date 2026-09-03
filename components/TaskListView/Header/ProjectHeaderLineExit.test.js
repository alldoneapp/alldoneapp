import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import ProjectHeader from './ProjectHeader'
import { SWEEP_LEAD_MS, SWEEP_TOTAL_MS } from '../OpenTasksView/projectCompletedSweepMotion'
import { DISSOLVE_MASK_IMAGE, DISSOLVE_MASK_SIZE, SPARK_COUNT } from '../OpenTasksView/projectLineDisintegration'

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: jest.fn() }))
jest.mock('../../../redux/store', () => ({ getState: () => ({ loggedUserProjectsMap: {} }) }))
jest.mock('../../../redux/actions', () => ({ setSelectedNavItem: jest.fn(() => ({ type: 'noop' })) }))
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('./ProjectAndUserData', () => 'ProjectAndUserData')
jest.mock('./TagsArea', () => 'TagsArea')
jest.mock('../../RootView/RootSectionNavigation', () => 'RootSectionNavigation')

/**
 * AT-2495 (second pass) — the WIRING, which is where this feature can most easily be broken without
 * any of the unit suites noticing.
 *
 * `ProjectHeader` owns the run, because the same sequence drives two things on two different nodes:
 * the sweep overlay INSIDE the row, and the mask that erases the row itself. Three ways to get that
 * wrong, all of which look fine in isolation:
 *
 *   • masking the wrong node, so the overlay survives the dissolve or the bottom rule does;
 *   • rendering the particle layer INSIDE the masked node, where the mask erases the very dust it
 *     is shedding;
 *   • leaving the mask on for headers that are not celebrating anything — every other board in the
 *     app renders this component, and a permanent compositing layer on each of them is a real cost.
 *
 * jsdom lays nothing out, so the row's height is handed in through `onLayout` by hand, and
 * `__mocks__/react-native.js` stubs `Animated.timing`, so what is driven here is the schedule.
 */

const PROJECT = 'project-a'
const PROJECT_COLOR = '#2F80ED'
const ROW_HEIGHT = 57

const findAll = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false })
const countOf = (tree, testID) => findAll(tree, testID).length
const rawStyle = node => Object.assign({}, ...[].concat(node.props.style).filter(Boolean))

describe('the project line leaving the board (AT-2495)', () => {
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

    const header = props => <ProjectHeader projectIndex={0} projectId={PROJECT} {...props} />

    // `deep: false`: react-native-web's Animated.View matches both as the composite element and as
    // the host View it renders, which silently doubles every count.
    const lineNode = tree => findAll(tree, 'project-line')[0]

    const mount = async props => {
        let tree
        await act(async () => {
            tree = renderer.create(header(props))
        })
        // The measurement the row gets from layout in a browser.
        await act(async () => {
            lineNode(tree).props.onLayout({ nativeEvent: { layout: { height: ROW_HEIGHT, width: 900 } } })
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

        expect(rawStyle(lineNode(tree)).maskImage).toBeUndefined()
        expect(countOf(tree, 'project-line-disintegration')).toBe(0)
        expect(countOf(tree, 'project-completed-sweep')).toBe(0)
    })

    it('costs every other board in the app nothing — no run id, no exit, ever', async () => {
        // Chats, contacts, notes, goals, done and pending all render this component and pass neither
        // prop. A mask left on for them would be a permanent compositing layer per project row.
        const tree = await mount({ completedSweepLineWillLeave: true })
        await advance(SWEEP_TOTAL_MS + 500)

        expect(rawStyle(lineNode(tree)).maskImage).toBeUndefined()
        expect(countOf(tree, 'project-line-disintegration')).toBe(0)
    })

    it('sweeps in place when the line is staying, and never masks it', async () => {
        const tree = await mount({ completedSweepRunId: 1, completedSweepLineWillLeave: false })

        expect(countOf(tree, 'project-completed-sweep')).toBe(1)

        await advance(SWEEP_LEAD_MS + 50)
        expect(rawStyle(lineNode(tree)).maskImage).toBeUndefined()
        expect(countOf(tree, 'project-line-disintegration')).toBe(0)
    })

    describe('when the line is leaving', () => {
        it('masks the row itself — the sweep overlay and the bottom rule go with it', async () => {
            const tree = await mount({ completedSweepRunId: 1, completedSweepLineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 50)

            const line = lineNode(tree)
            const style = rawStyle(line)
            expect(style.maskImage).toBe(DISSOLVE_MASK_IMAGE)
            expect(style.WebkitMaskImage).toBe(DISSOLVE_MASK_IMAGE)
            expect(style.maskSize).toBe(DISSOLVE_MASK_SIZE)
            expect(style.height.__getValue()).toBe(ROW_HEIGHT)

            // The whole line is inside the masked node: the sweep's coloured wash, the header
            // content and the 1px bottom rule. Masking anything inner would leave one of them
            // hanging in the air after the rest had gone.
            expect(line.findAllByProps({ testID: 'project-completed-sweep' }).length).toBeGreaterThan(0)
        })

        it('sheds its dust and sparks OUTSIDE the mask, or they would be erased by it', async () => {
            const tree = await mount({ completedSweepRunId: 1, completedSweepLineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 50)

            expect(countOf(tree, 'project-line-disintegration')).toBe(1)
            expect(countOf(tree, 'project-line-disintegration-spark')).toBe(SPARK_COUNT)
            // The particle layer must NOT be a descendant of the masked row.
            expect(lineNode(tree).findAllByProps({ testID: 'project-line-disintegration' })).toHaveLength(0)
        })

        it('hands the particles the project colour the sweep has just crossed the row in', async () => {
            const tree = await mount({ completedSweepRunId: 1, completedSweepLineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 50)

            const armColours = findAll(tree, 'project-line-disintegration-spark-arm').map(
                arm => rawStyle(arm).backgroundColor
            )
            expect(armColours).toContain(PROJECT_COLOR)
        })

        it('freezes the particle layer at the height the row had, not at the height it is collapsing to', async () => {
            const tree = await mount({ completedSweepRunId: 1, completedSweepLineWillLeave: true })
            await advance(SWEEP_LEAD_MS + 50)

            const layerStyle = StyleSheet.flatten(findAll(tree, 'project-line-disintegration')[0].props.style)
            expect(layerStyle.height).toBe(ROW_HEIGHT)
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

            expect(rawStyle(lineNode(tree)).maskImage).toBeUndefined()
            expect(countOf(tree, 'project-line-disintegration')).toBe(0)
            expect(countOf(tree, 'project-completed-sweep')).toBe(0)
        })
    })
})
