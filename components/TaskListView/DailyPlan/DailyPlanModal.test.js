/**
 * @jest-environment jsdom
 */

import React from 'react'
import moment from 'moment'
import renderer, { act } from 'react-test-renderer'

import { DailyPlanDialog } from './DailyPlanModal'
import DailyPlanEntry, { getOpenPlannedKey, summarizeAppliedPlan } from './DailyPlanEntry'

let mockState
let mockSizing = { width: 640, maxHeight: 700, isSheet: false }

jest.mock('react-redux', () => ({
    useStore: () => ({ getState: () => mockState }),
    useSelector: selector => selector(mockState),
    useDispatch: () => jest.fn(),
    shallowEqual: (a, b) => a === b,
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        getNormalAndGuideProjectsSortedBySortedAndWithProjectInFocusAtTheTop: () => ['product', 'client', 'home'],
    },
}))
// Key plus its parameters, so the tests can read the numbers the UI shows.
jest.mock('../../../i18n/TranslationService', () => ({
    translate: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
}))
jest.mock('../../../hooks/useModalSizing', () => ({ __esModule: true, default: () => mockSizing }))
jest.mock('../../UIComponents/ModalShell/WorkspaceModal', () => ({
    __esModule: true,
    default: ({ children }) => children,
}))
jest.mock('../../UIComponents/ModalShell/AppPopover', () => ({ __esModule: true, default: ({ children }) => children }))
jest.mock('../../../utils/backends/Tasks/dailyPlan', () => ({
    applyDailyPlan: jest.fn(),
    getLocalPlanDateKey: () => '2026-11-23',
    undoDailyPlan: jest.fn(),
    watchDailyPlan: () => () => {},
    watchDailyPlanUndoStatus: () => () => {},
}))
jest.mock('../../UIControls/Button', () => {
    const React = require('react')
    const { Text, TouchableOpacity } = require('react-native')
    return props =>
        React.createElement(
            TouchableOpacity,
            { onPress: props.onPress, disabled: props.disabled, testID: props.testID },
            React.createElement(Text, null, props.title)
        )
})

const today = moment().startOf('day').add(8, 'hours').valueOf()
let sortIndex = 10000
const task = (id, fields = {}) => ({
    id,
    name: `Task ${id}`,
    dueDate: today,
    priority: 'none',
    timesPostponed: 0,
    estimations: { [-1]: 60 },
    sortIndex: sortIndex--,
    parentId: null,
    done: false,
    inDone: false,
    ...fields,
})

const readyView = meetingMinutes => ({
    status: 'ready',
    workingHours: { start: '09:00', end: '18:00', isDefault: false },
    windowMinutes: 540,
    meetingMinutes,
    freeMinutes: 540 - meetingMinutes,
})

const buildState = openTasksMap => ({
    loggedUser: {
        uid: 'u1',
        projectIds: ['product', 'client', 'home'],
        guideProjectIds: [],
        archivedProjectIds: [],
        templateProjectIds: [],
        inFocusTaskId: null,
        inFocusTaskProjectId: null,
    },
    loggedUserProjectsMap: {
        product: { name: 'Product', color: '#123456' },
        client: { name: 'Client', color: '#654321' },
        home: { name: 'Home' },
    },
    smallScreenNavigation: false,
    taskPriorityFilters: [],
    openTasksMap,
})

// Normal day: 9–18, 1h 30m meetings → time to work 7h 30m, plan up to 6h.
const normalDay = () => ({
    product: {
        must: task('must', { priority: 'must_do' }),
        a: task('a'),
        b: task('b', { priority: 'should_do', estimations: { [-1]: 30 } }),
        unknown: task('unknown', { estimations: {} }),
        meeting: task('meeting', { calendarData: { start: { dateTime: 'x' }, end: { dateTime: 'y' } } }),
    },
    client: {
        c1: task('c1', { priority: 'could_do' }),
        c2: task('c2', { timesPostponed: 1 }),
        old: task('old', { timesPostponed: 7, priority: 'do_later' }),
    },
    home: {
        h1: task('h1'),
        goal: task('goal', { parentGoalId: 'g', timesPostponed: 3, priority: 'do_later' }),
    },
})

const render = (props = {}) => {
    let tree
    act(() => {
        tree = renderer.create(
            <DailyPlanDialog
                meetingView={readyView(90)}
                onClose={jest.fn()}
                onApplied={jest.fn()}
                applyPlan={jest.fn()}
                {...props}
            />
        )
    })
    return tree
}
const byId = (tree, testID) =>
    tree.root.find(
        node =>
            (node.props.testID === testID && typeof node.type !== 'string' && node.props.onPress !== undefined) ||
            (node.props.testID === testID && node.type === 'div')
    )
const findAll = (tree, testID) => tree.root.findAll(node => node.props.testID === testID)
const exists = (tree, testID) => findAll(tree, testID).length > 0
const press = (tree, testID) => {
    const node = findAll(tree, testID).find(candidate => typeof candidate.props.onPress === 'function')
    if (!node) throw new Error(`No pressable ${testID}`)
    act(() => node.props.onPress())
}
const textOf = (tree, testID) => {
    const nodes = findAll(tree, testID)
    if (!nodes.length) throw new Error(`No ${testID}`)
    const collect = node => (typeof node === 'string' ? node : (node.children || []).map(collect).join(''))
    return collect(nodes[0])
}
const params = (text, key) => {
    const match = text.match(new RegExp(`${key} (\\{[^}]*\\})`))
    return match ? JSON.parse(match[1]) : null
}
const rowOrder = (tree, projectId) =>
    findAll(tree, `daily-plan-project-${projectId}`)[0]
        .findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('daily-plan-row-'))
        .map(node => node.props.testID.replace('daily-plan-row-', ''))
        .filter((key, index, list) => list.indexOf(key) === index)

beforeEach(() => {
    mockSizing = { width: 640, maxHeight: 700, isSheet: false }
    mockState = buildState(normalDay())
})

describe('DailyPlanDialog — review', () => {
    it('shows one cross-project capacity and project groups with subtotals in sidebar order', () => {
        const tree = render()
        expect(textOf(tree, 'daily-plan-time-to-work')).toBe('7h 30m')
        const planned = params(textOf(tree, 'daily-plan-capacity'), 'dailyPlan planned of budget')
        expect(planned.budget).toBe('6h')
        // Must (60) always; then should b (30), could c1 (60), then by fit: c2 (postponed once, 60),
        // a, unknown (30 assumed), h1 by list order: exactly the 6h budget.
        expect(textOf(tree, 'daily-plan-planned')).toBe('6h')
        expect(planned.count).toBe(7)
        expect(textOf(tree, 'daily-plan-equation')).toContain('dailyPlan meetings not planned {"count":1}')
        expect(textOf(tree, 'daily-plan-equation')).toContain('dailyPlan unknown estimates {"count":1}')

        const projects = tree.root
            .findAll(
                node => typeof node.props.testID === 'string' && /^daily-plan-project-[a-z]+$/.test(node.props.testID)
            )
            .map(node => node.props.testID)
            .filter((id, index, list) => list.indexOf(id) === index)
        expect(projects).toEqual(['daily-plan-project-product', 'daily-plan-project-client', 'daily-plan-project-home'])
        expect(textOf(tree, 'daily-plan-per-project-line')).toBe('Product 3h · 4 + Client 2h · 2 + Home 1h · 1')

        expect(params(textOf(tree, 'daily-plan-project-subtotal-product'), 'dailyPlan project subtotal')).toEqual({
            count: 4,
            duration: '3h',
        })
        expect(params(textOf(tree, 'daily-plan-project-subtotal-client'), 'dailyPlan project subtotal')).toEqual({
            count: 2,
            duration: '2h',
        })
        expect(params(textOf(tree, 'daily-plan-project-subtotal-home'), 'dailyPlan project subtotal')).toEqual({
            count: 1,
            duration: '1h',
        })
        // Within a project: Must, then Should, then the rest by fit.
        expect(rowOrder(tree, 'product')).toEqual(['product:must', 'product:b', 'product:a', 'product:unknown'])
        // Not today stays collapsed until opened.
        expect(exists(tree, 'daily-plan-row-client:old')).toBe(false)
        press(tree, 'daily-plan-later-toggle-client')
        expect(exists(tree, 'daily-plan-row-client:old')).toBe(true)
    })

    it('remove, add back, re-prioritise, re-estimate and reset keep every figure consistent', () => {
        const tree = render()
        press(tree, 'daily-plan-toggle-product:a')
        expect(textOf(tree, 'daily-plan-planned')).toBe('5h')
        expect(params(textOf(tree, 'daily-plan-project-subtotal-product'), 'dailyPlan project subtotal')).toEqual({
            count: 3,
            duration: '2h',
        })
        expect(textOf(tree, 'daily-plan-remaining')).toContain('dailyPlan left in plan {"duration":"1h"}')

        press(tree, 'daily-plan-later-toggle-home')
        press(tree, 'daily-plan-toggle-home:goal')
        expect(params(textOf(tree, 'daily-plan-project-subtotal-home'), 'dailyPlan project subtotal')).toEqual({
            count: 2,
            duration: '2h',
        })
        expect(textOf(tree, 'daily-plan-planned')).toBe('6h')

        // Should → Could moves the row after Must and Should rows.
        press(tree, 'daily-plan-tier-product:b')
        expect(textOf(tree, 'daily-plan-tier-product:b')).toContain('dailyPlan tier short could')
        // Estimate cycles 30 → 60 for the unknown one; it is no longer flagged.
        press(tree, 'daily-plan-estimate-product:unknown')
        expect(textOf(tree, 'daily-plan-estimate-product:unknown')).toBe('1h')
        expect(textOf(tree, 'daily-plan-equation')).not.toContain('dailyPlan unknown estimates')
        expect(textOf(tree, 'daily-plan-planned')).toBe('6h 30m')
        expect(exists(tree, 'daily-plan-overload')).toBe(true)

        press(tree, 'daily-plan-reset')
        expect(textOf(tree, 'daily-plan-planned')).toBe('6h')
        expect(exists(tree, 'daily-plan-overload')).toBe(false)
    })

    it('search finds tasks across projects, including the collapsed Not today lists', () => {
        const tree = render()
        act(() => findAll(tree, 'daily-plan-search')[0].props.onChangeText('old'))
        expect(exists(tree, 'daily-plan-row-client:old')).toBe(true)
        expect(exists(tree, 'daily-plan-project-product')).toBe(false)
        // Subtotals still describe the whole project.
        expect(params(textOf(tree, 'daily-plan-project-subtotal-client'), 'dailyPlan project subtotal').count).toBe(2)
    })
})

describe('DailyPlanDialog — overload', () => {
    it('never drops your Must tasks; suggestions close the gap, or keep everything', () => {
        mockState = buildState({
            product: {
                m1: task('m1', { priority: 'must_do', estimations: { [-1]: 120 } }),
                m2: task('m2', { priority: 'must_do', estimations: { [-1]: 120 } }),
            },
            client: { s: task('s', { priority: 'should_do', estimations: { [-1]: 30 } }) },
        })
        const tree = render({ meetingView: readyView(330) }) // free 3h 30m, budget 2h 48m
        expect(textOf(tree, 'daily-plan-overload')).toContain('dailyPlan must alone over {"duration":"4h"}')
        expect(exists(tree, 'daily-plan-row-product:m1')).toBe(true)
        expect(exists(tree, 'daily-plan-row-product:m2')).toBe(true)

        press(tree, 'daily-plan-keep-all')
        expect(exists(tree, 'daily-plan-overload')).toBe(false)
        expect(textOf(tree, 'daily-plan-remaining')).toContain('dailyPlan over by')
    })

    it('moves a suggested task out of today with one tap', () => {
        mockState = buildState({
            product: {
                m: task('m', { priority: 'must_do', estimations: { [-1]: 120 } }),
                s: task('s', { priority: 'should_do', estimations: { [-1]: 60 } }),
                c: task('c', { priority: 'could_do', estimations: { [-1]: 30 } }),
            },
        })
        const tree = render({ meetingView: readyView(300) }) // budget 3h 12m → s + c are proposed? m120+s60=180, c30 → 210 > 192
        press(tree, 'daily-plan-later-toggle-product')
        press(tree, 'daily-plan-toggle-product:c')
        expect(exists(tree, 'daily-plan-overload')).toBe(true)
        press(tree, 'daily-plan-suggestion-product:c')
        expect(exists(tree, 'daily-plan-overload')).toBe(false)
        expect(textOf(tree, 'daily-plan-planned')).toBe('3h')
    })
})

describe('DailyPlanDialog — missing calendar', () => {
    const noCalendar = {
        status: 'noCalendar',
        workingHours: { start: '09:00', end: '18:00', isDefault: true },
        windowMinutes: 540,
    }

    it('capacity follows the assumed meetings at once; the selection only on Re-propose, keeping edits', () => {
        const tree = render({ meetingView: noCalendar })
        expect(exists(tree, 'daily-plan-provisional')).toBe(true)
        expect(textOf(tree, 'daily-plan-time-to-work')).toBe('9h')
        // Budget 80% of 9h = 7h 12m: everything except the Do later tasks (6h) fits.
        expect(textOf(tree, 'daily-plan-planned')).toBe('6h')
        expect(params(textOf(tree, 'daily-plan-capacity'), 'dailyPlan planned of budget').budget).toBe('7h 12m')
    })

    it('re-proposes around the user’s edits', () => {
        const tree = render({ meetingView: noCalendar })
        press(tree, 'daily-plan-toggle-home:h1') // the user removes h1
        const before = textOf(tree, 'daily-plan-planned')
        press(tree, 'daily-plan-assume-180')
        expect(textOf(tree, 'daily-plan-time-to-work')).toBe('6h')
        expect(textOf(tree, 'daily-plan-planned')).toBe(before) // selection unchanged until Re-propose
        expect(exists(tree, 'daily-plan-repropose')).toBe(true)
        press(tree, 'daily-plan-repropose')
        expect(exists(tree, 'daily-plan-repropose')).toBe(false)
        expect(exists(tree, 'daily-plan-overload')).toBe(false)
        expect(findAll(tree, 'daily-plan-row-home:h1').length).toBe(0) // still out (Not today collapsed)
        // 6h × 80% = 4h 48m: Must, b, c1, c2, a fit (4h 30m); unknown no longer does.
        expect(textOf(tree, 'daily-plan-planned')).toBe('4h 30m')
        expect(textOf(tree, 'daily-plan-remaining')).toContain('dailyPlan left in plan {"duration":"18m"}')
    })

    it('waits for a loading calendar but lets the user plan without it', () => {
        const tree = render({ meetingView: { ...readyView(0), status: 'calendarLoading' } })
        expect(exists(tree, 'daily-plan-loading')).toBe(true)
        press(tree, 'daily-plan-skip-calendar')
        expect(exists(tree, 'daily-plan-provisional')).toBe(true)
    })
})

describe('DailyPlanDialog — postpone confirmation and apply', () => {
    it('groups destination first, project second; Someday and protected work are opt-in; reconciles', () => {
        const tree = render()
        press(tree, 'daily-plan-next')
        expect(exists(tree, 'daily-plan-postpone')).toBe(true)
        const reconciliation = params(textOf(tree, 'daily-plan-reconciliation'), 'dailyPlan reconciliation')
        // 9 tasks due (the meeting is not part of the plan): 7 planned, 2 not today: old (Someday) and goal (protected).
        expect(reconciliation).toEqual({ planned: 7, postponed: 0, stays: 2, all: 9 })
        expect(exists(tree, 'daily-plan-destination-someday')).toBe(true)
        expect(exists(tree, 'daily-plan-destination-3m')).toBe(true)

        press(tree, 'daily-plan-destination-expand-someday')
        press(tree, 'daily-plan-destination-project-someday-client')
        expect(params(textOf(tree, 'daily-plan-reconciliation'), 'dailyPlan reconciliation')).toEqual({
            planned: 7,
            postponed: 1,
            stays: 1,
            all: 9,
        })
        const total = textOf(tree, 'daily-plan-reconcile-total')
        expect(total).toContain('7')
        expect(total).toContain('9')
    })

    it('applies the reviewed decisions once and reports back', async () => {
        const applyPlan = jest.fn(() => Promise.resolve({ actionId: 'a1', skipped: [] }))
        const onApplied = jest.fn()
        const onClose = jest.fn()
        const tree = render({ applyPlan, onApplied, onClose })
        press(tree, 'daily-plan-toggle-client:c2')
        press(tree, 'daily-plan-next')
        press(tree, 'daily-plan-destination-tick-someday')
        await act(async () => {
            findAll(tree, 'daily-plan-apply')
                .find(node => node.props.onPress)
                .props.onPress()
        })
        expect(applyPlan).toHaveBeenCalledTimes(1)
        const tasks = applyPlan.mock.calls[0][0]
        const byKey = Object.fromEntries(tasks.map(item => [`${item.projectId}:${item.taskId}`, item]))
        expect(tasks).toHaveLength(9)
        expect(byKey['product:must']).toMatchObject({ decision: 'plan', priority: 'must_do', estimateMinutes: 60 })
        expect(byKey['product:a']).toMatchObject({ decision: 'plan', priority: 'should_do' })
        expect(byKey['client:c2']).toMatchObject({ decision: 'postpone', confirmSomeday: false })
        expect(byKey['client:old']).toMatchObject({ decision: 'postpone', confirmSomeday: true })
        expect(byKey['home:goal']).toEqual({
            projectId: 'home',
            taskId: 'goal',
            isObservedTask: false,
            decision: 'keep',
        })
        expect(byKey['product:meeting']).toBeUndefined()
        expect(onApplied).toHaveBeenCalledWith(
            { actionId: 'a1', skipped: [] },
            { plannedCount: 6, plannedMinutes: 300 }
        )
        expect(onClose).toHaveBeenCalled()
    })

    it('keeps the dialog open with a clear message when offline', async () => {
        const offline = Object.assign(new Error('x'), { code: 'offline' })
        const onClose = jest.fn()
        const tree = render({ applyPlan: jest.fn(() => Promise.reject(offline)), onClose })
        press(tree, 'daily-plan-next')
        await act(async () => {
            findAll(tree, 'daily-plan-apply')
                .find(node => node.props.onPress)
                .props.onPress()
        })
        expect(textOf(tree, 'daily-plan-error')).toBe('dailyPlan offline')
        expect(onClose).not.toHaveBeenCalled()
    })
})

describe('DailyPlanDialog — responsive and empty', () => {
    it('uses the modal sizing (full-width sheet on phones) and wraps long names', () => {
        mockSizing = { width: 358, maxHeight: 600, isSheet: true }
        const tree = render()
        const card = findAll(tree, 'daily-plan-modal')[0]
        const style = [].concat(card.props.style).reduce((all, item) => ({ ...all, ...(item || {}) }), {})
        expect(style).toMatchObject({ width: 358, maxHeight: 600 })
        expect(card.props.dataSet).toEqual({ adPopup: 'true' })
    })

    it('says so when nothing is due today', () => {
        mockState = buildState({})
        const tree = render()
        expect(exists(tree, 'daily-plan-empty')).toBe(true)
    })
})

describe('applied plan summary (Today pill)', () => {
    it('counts planned tasks still open per project and sums minutes', () => {
        const plan = {
            planned: [
                { key: 'product:a', projectId: 'product', minutes: 60 },
                { key: 'product:b', projectId: 'product', minutes: 30 },
                { key: 'client:c', projectId: 'client', minutes: 45 },
            ],
        }
        const endOfDay = moment().endOf('day').valueOf()
        const openTasksMap = {
            product: { a: task('a'), b: task('b', { done: true }) },
            client: { c: task('c', { dueDate: endOfDay + 1000 }) },
        }
        const key = getOpenPlannedKey(openTasksMap, plan.planned, 'u1', endOfDay)
        expect(key).toBe('client=0|product=1')
        const summary = summarizeAppliedPlan(plan, { product: 1, client: 0 }, ['product', 'client'])
        expect(summary).toMatchObject({ count: 3, minutes: 135, left: 1 })
        expect(
            summary.projects.map(project => [project.projectId, project.count, project.minutes, project.left])
        ).toEqual([
            ['product', 2, 90, 1],
            ['client', 1, 45, 0],
        ])
    })
})

// AT-3136 keeps the All projects line one fixed-height row on mobile (merged with AT-3142).
describe('DailyPlanEntry — full and compact', () => {
    const meetingView = { status: 'ready', meetingMinutes: 0, meetingCount: 0, workingHours: {} }
    const texts = root => root.findAllByType(require('react-native').Text).map(node => node.props.children)

    it('shows the labelled button next to the time display on desktop', () => {
        const root = renderer.create(<DailyPlanEntry meetingView={meetingView} />).root
        expect(root.findAllByProps({ testID: 'daily-plan-open' }).length).toBeGreaterThan(0)
        expect(texts(root)).toContain('dailyPlan plan my day')
    })

    it('is an unlabelled round icon button with an accessibility label in the compact row', () => {
        const root = renderer.create(<DailyPlanEntry meetingView={meetingView} compact />).root
        const button = root.findAllByProps({ testID: 'daily-plan-open' })[0]
        expect(button.props.accessibilityLabel).toBe('dailyPlan plan my day')
        expect(texts(root)).not.toContain('dailyPlan plan my day')
    })

    it('renders nothing without a meeting view', () => {
        expect(renderer.create(<DailyPlanEntry meetingView={null} compact />).toJSON()).toBeNull()
    })
})
