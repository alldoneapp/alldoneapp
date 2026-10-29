import React from 'react'
import { Text, TextInput, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

const mockState = { loggedUser: { uid: 'me' }, smallScreenNavigation: false }
const mockWatchers = { knowledgeBase: null, runs: null }

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => jest.fn(),
}))
jest.mock('../../../utils/backends/KnowledgeBase/knowledgeBaseFirestore', () => ({
    watchKnowledgeBase: jest.fn((projectId, onChange) => {
        mockWatchers.knowledgeBase = onChange
        return () => {}
    }),
    watchKnowledgePages: jest.fn(() => () => {}),
    watchKnowledgeRuns: jest.fn((projectId, onChange) => {
        mockWatchers.runs = onChange
        return () => {}
    }),
    saveKnowledgeBaseSettings: jest.fn(),
    requestKnowledgeBaseRefresh: jest.fn(),
}))
jest.mock('../../Icon', () => () => null)
jest.mock('../../UIControls/Button', () => {
    const { Text: MockText, TouchableOpacity: MockTouchable } = require('react-native')
    return ({ title, onPress, disabled }) => (
        <MockTouchable onPress={onPress} disabled={!!disabled}>
            <MockText>{title || ''}</MockText>
        </MockTouchable>
    )
})
jest.mock('../../UIControls/Switch', () => {
    const { TouchableOpacity: MockTouchable } = require('react-native')
    return ({ active, disabled, activeSwitch, deactiveSwitch }) => (
        <MockTouchable
            testID="wiki-switch"
            accessibilityState={{ checked: !!active }}
            disabled={!!disabled}
            onPress={active ? deactiveSwitch : activeSwitch}
        />
    )
})
jest.mock('../../UIComponents/Spinner', () => () => null)
jest.mock(
    '../../UIComponents/ModalShell/AppPopover',
    () =>
        ({ children }) =>
            children
)
jest.mock('../../UIComponents/FloatModals/AssistantModelModal/AssistantModelModal', () => () => null)
jest.mock('../../../redux/actions', () => ({ hideFloatPopup: () => ({}), showFloatPopup: () => ({}) }))
jest.mock('../../../URLSystem/Projects/URLsProjects', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_PROJECT_DETAILS_WIKI: 'PROJECT_DETAILS_WIKI',
}))
jest.mock('../../TaskListView/Utils/TasksHelper', () => ({
    getUserInProject: (projectId, userId) => ({ displayName: userId === 'owner' ? 'Karsten' : userId }),
}))
jest.mock('../../WikiView/wikiLinks', () => ({ openProjectWiki: jest.fn() }))
jest.mock('../../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))
jest.mock('../../../i18n/TranslationService', () => {
    const en = require('../../../i18n/translations/en.json')
    return {
        translate: (key, values = {}) =>
            (en[key] !== undefined ? en[key] : key).replace(/%\{(\w+)\}/g, (_, name) =>
                values[name] !== undefined ? values[name] : ''
            ),
        useTranslator: () => {},
    }
})

import {
    requestKnowledgeBaseRefresh,
    saveKnowledgeBaseSettings,
} from '../../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import URLsProjects from '../../../URLSystem/Projects/URLsProjects'
import ProjectWikiSettings, { canManageWiki } from './ProjectWikiSettings'

const PROJECT = { id: 'p1', userIds: ['me', 'owner'] }

function textOf(node) {
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (!node || !node.children) return ''
    return node.children.map(textOf).join('')
}

const mounted = []
function mount(knowledgeBase, project = PROJECT) {
    let component
    act(() => {
        component = renderer.create(<ProjectWikiSettings project={project} />)
    })
    act(() => mockWatchers.knowledgeBase(knowledgeBase))
    mounted.push(component)
    return component
}

const wikiSwitch = component => component.root.findByProps({ testID: 'wiki-switch' })
const isSwitching = component => component.root.findAllByProps({ testID: 'project-wiki-switching' }).length > 0

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

const findButton = (component, title) =>
    component.root
        .findAllByType(TouchableOpacity)
        .find(node => node.findAllByType(Text).some(child => textOf(child.children) === title))

afterEach(() => {
    act(() => mounted.splice(0).forEach(component => component.unmount()))
})

beforeEach(() => {
    jest.clearAllMocks()
    saveKnowledgeBaseSettings.mockResolvedValue({ success: true })
})

describe('canManageWiki', () => {
    it('lets the paying member change a wiki that is on, and anyone once it is off or the payer left', () => {
        expect(canManageWiki(null, 'me', ['me'])).toBe(true)
        expect(canManageWiki({ enabled: false, ownerUserId: 'owner' }, 'me', ['me', 'owner'])).toBe(true)
        expect(canManageWiki({ enabled: true, ownerUserId: 'me' }, 'me', ['me'])).toBe(true)
        expect(canManageWiki({ enabled: true, ownerUserId: 'owner' }, 'me', ['me', 'owner'])).toBe(false)
        expect(canManageWiki({ enabled: true, ownerUserId: 'owner' }, 'me', ['me'])).toBe(true)
    })
})

describe('ProjectWikiSettings', () => {
    it('keeps the project details URL on the wiki tab', () => {
        mount(null)

        expect(URLsProjects.push).toHaveBeenCalledWith('PROJECT_DETAILS_WIKI', { projectId: 'p1', userId: 'me' }, 'p1')
    })

    it('switches a wiki on and says who pays for it', async () => {
        const component = mount(null)
        expect(textOf(component.toJSON())).toContain('The member who switches the wiki on pays')

        await act(async () => component.root.findByProps({ testID: 'wiki-switch' }).props.onPress())

        expect(saveKnowledgeBaseSettings).toHaveBeenCalledWith('p1', { enabled: true })
        expect(textOf(component.toJSON())).toContain('Saved')
    })

    it('moves the switch on the press and says the change is on its way', async () => {
        const call = deferred()
        saveKnowledgeBaseSettings.mockReturnValue(call.promise)
        const component = mount(null)

        act(() => {
            wikiSwitch(component).props.onPress()
        })

        // Before the function has answered: the switch is already on, with a pending note beside it.
        expect(wikiSwitch(component).props.accessibilityState.checked).toBe(true)
        expect(wikiSwitch(component).props.disabled).toBe(true)
        expect(isSwitching(component)).toBe(true)
        expect(textOf(component.toJSON())).toContain('Switching the wiki on…')

        // The transaction commits before the first build is queued, so the document usually agrees
        // before the call returns; from then on the wiki is on and nothing is pending any more.
        act(() => mockWatchers.knowledgeBase({ enabled: true, ownerUserId: 'me' }))
        expect(isSwitching(component)).toBe(false)
        expect(wikiSwitch(component).props.accessibilityState.checked).toBe(true)

        await act(async () => call.resolve({ success: true }))
        expect(textOf(component.toJSON())).toContain('Saved')
        expect(wikiSwitch(component).props.accessibilityState.checked).toBe(true)
    })

    it('keeps the switch where it was sent when the call answers before the document', async () => {
        const component = mount({ enabled: true, ownerUserId: 'me' })

        await act(async () => wikiSwitch(component).props.onPress())

        expect(saveKnowledgeBaseSettings).toHaveBeenCalledWith('p1', { enabled: false })
        expect(isSwitching(component)).toBe(false)
        expect(wikiSwitch(component).props.accessibilityState.checked).toBe(false)

        act(() => mockWatchers.knowledgeBase({ enabled: false, ownerUserId: 'me' }))
        expect(wikiSwitch(component).props.accessibilityState.checked).toBe(false)
    })

    it('puts the switch back when the change is refused', async () => {
        saveKnowledgeBaseSettings.mockRejectedValue({ code: 'permission-denied', message: 'Nope' })
        const component = mount(null)

        await act(async () => wikiSwitch(component).props.onPress())

        expect(wikiSwitch(component).props.accessibilityState.checked).toBe(false)
        expect(isSwitching(component)).toBe(false)
        expect(textOf(component.toJSON())).toContain('Nope')
    })

    it('locks every control of a wiki another member pays for', () => {
        const component = mount({ enabled: true, ownerUserId: 'owner' })
        const text = textOf(component.toJSON())

        expect(text).toContain('Paid by Karsten')
        expect(text).toContain('Only the member who pays for the wiki can change these settings.')
        expect(component.root.findByProps({ testID: 'wiki-switch' }).props.disabled).toBe(true)
        expect(component.root.findByProps({ testID: 'project-wiki-cap' }).props.editable).toBe(false)
        expect(component.root.findByProps({ testID: 'project-wiki-instructions' }).props.editable).toBe(false)
    })

    it('says when the wiki was switched on by default, and when it waits for its payer to come back', () => {
        const component = mount({ enabled: true, enabledBy: 'default', ownerUserId: 'owner', nextRunAt: 5 })
        let text = textOf(component.toJSON())
        expect(text).toContain('Paid by Karsten')
        expect(text).toContain('The wiki is on by default in projects of members who use Alldone.')
        expect(component.root.findAllByProps({ testID: 'project-wiki-paused-hint' })).toHaveLength(0)

        act(() =>
            mockWatchers.knowledgeBase({
                enabled: true,
                enabledBy: 'default',
                ownerUserId: 'owner',
                nextRunAt: null,
                lastRunStopReason: 'owner_inactive',
            })
        )
        text = textOf(component.toJSON())
        expect(text).toContain('Paused: the paying member has not used Alldone for 30 days.')

        act(() =>
            mockWatchers.knowledgeBase({
                enabled: true,
                ownerUserId: 'owner',
                nextRunAt: null,
                lastRunStopReason: 'project_archived',
            })
        )
        // AT-2893: archiving no longer pauses a wiki, so a leftover paused state announces nothing
        // (the default sweep resumes it).
        expect(component.root.findAllByProps({ testID: 'project-wiki-archived-hint' })).toHaveLength(0)
        expect(textOf(component.toJSON())).not.toContain('archived this project')

        // A wiki a member switched on themselves says neither.
        act(() => mockWatchers.knowledgeBase({ enabled: true, ownerUserId: 'owner', nextRunAt: 5 }))
        expect(component.root.findAllByProps({ testID: 'project-wiki-default-hint' })).toHaveLength(0)
        expect(component.root.findAllByProps({ testID: 'project-wiki-paused-hint' })).toHaveLength(0)
        expect(component.root.findAllByProps({ testID: 'project-wiki-archived-hint' })).toHaveLength(0)
    })

    it('only saves a monthly limit inside the allowed range', async () => {
        const component = mount({ enabled: true, ownerUserId: 'me', monthlyGoldCap: 500 })
        const cap = component.root.findByProps({ testID: 'project-wiki-cap' })
        expect(cap.props.value).toBe('500')

        act(() => cap.props.onChangeText('5'))
        expect(findButton(component, 'Save').props.disabled).toBe(true)
        act(() => cap.props.onChangeText('12.5'))
        expect(findButton(component, 'Save').props.disabled).toBe(true)

        act(() => cap.props.onChangeText('800'))
        await act(async () => findButton(component, 'Save').props.onPress())
        expect(saveKnowledgeBaseSettings).toHaveBeenCalledWith('p1', { monthlyGoldCap: 800 })
    })

    it('shows what this month cost so far', () => {
        // The month of `Date.now()`, which the test setup pins; a spend from another month counts nothing.
        const month = new Date(Date.now()).toISOString().slice(0, 7)
        const component = mount({ enabled: true, ownerUserId: 'me', monthlyGold: { month, spent: 42 } })

        expect(textOf(component.toJSON())).toContain('42 of 500 Gold spent this month')

        act(() =>
            mockWatchers.knowledgeBase({
                enabled: true,
                ownerUserId: 'me',
                monthlyGold: { month: '2000-01', spent: 42 },
            })
        )
        expect(textOf(component.toJSON())).toContain('0 of 500 Gold spent this month')
    })

    it('warns that the monthly limit is reached until a raised limit lets the wiki run again', () => {
        const month = new Date(Date.now()).toISOString().slice(0, 7)
        const pausedUntil = Date.now() + 5 * 24 * 60 * 60 * 1000
        const component = mount({
            enabled: true,
            ownerUserId: 'me',
            monthlyGoldCap: 500,
            monthlyGold: { month, spent: 506 },
            lastRunStopReason: 'monthly_cap',
            nextRunAt: pausedUntil,
        })

        expect(textOf(component.root.findByProps({ testID: 'project-wiki-cap-reached' }).children)).toContain(
            'The monthly Gold limit is reached. The wiki is paused until'
        )

        // Raising the limit makes the server schedule a run now, which ends the warning.
        act(() =>
            mockWatchers.knowledgeBase({
                enabled: true,
                ownerUserId: 'me',
                monthlyGoldCap: 1000,
                monthlyGold: { month, spent: 506 },
                lastRunStopReason: 'monthly_cap',
                nextRunAt: Date.now() - 1,
            })
        )
        expect(component.root.findAllByProps({ testID: 'project-wiki-cap-reached' })).toHaveLength(0)
    })

    // AT-2880: a run that had read the old limit paused the wiki although the payer had already
    // raised it. Saving that same limit resumes it on the server, so the button must be offered.
    it('lets the payer resume a wiki paused at a limit that is already above its spending', async () => {
        const month = new Date(Date.now()).toISOString().slice(0, 7)
        const component = mount({
            enabled: true,
            ownerUserId: 'me',
            monthlyGoldCap: 10000,
            monthlyGold: { month, spent: 5008 },
            lastRunStopReason: 'monthly_cap',
            nextRunAt: Date.now() + 5 * 24 * 60 * 60 * 1000,
        })

        expect(component.root.findAllByProps({ testID: 'project-wiki-cap-reached' })).toHaveLength(1)
        expect(textOf(component.root.findByProps({ testID: 'project-wiki-cap-already-raised' }).children)).toContain(
            "The limit is already above this month's spending"
        )
        expect(findButton(component, 'Save').props.disabled).toBe(false)

        await act(async () => findButton(component, 'Save').props.onPress())
        expect(saveKnowledgeBaseSettings).toHaveBeenCalledWith('p1', { monthlyGoldCap: 10000 })
    })

    it('keeps an unchanged limit unsaveable while the wiki is paused at it', () => {
        const month = new Date(Date.now()).toISOString().slice(0, 7)
        const component = mount({
            enabled: true,
            ownerUserId: 'me',
            monthlyGoldCap: 500,
            monthlyGold: { month, spent: 506 },
            lastRunStopReason: 'monthly_cap',
            nextRunAt: Date.now() + 5 * 24 * 60 * 60 * 1000,
        })

        expect(component.root.findAllByProps({ testID: 'project-wiki-cap-already-raised' })).toHaveLength(0)
        expect(findButton(component, 'Save').props.disabled).toBe(true)
    })

    it('saves the wiki rules', async () => {
        const component = mount({ enabled: true, ownerUserId: 'me', instructions: '' })
        const input = component.root.findByProps({ testID: 'project-wiki-instructions' })

        act(() => input.props.onChangeText('Eine Seite pro Kunde.'))
        await act(async () => findButton(component, 'Save instructions').props.onPress())

        expect(saveKnowledgeBaseSettings).toHaveBeenCalledWith('p1', { instructions: 'Eine Seite pro Kunde.' })
    })

    it('says why a save failed while offline', async () => {
        saveKnowledgeBaseSettings.mockRejectedValue({ code: 'offline' })
        const component = mount(null)

        await act(async () => component.root.findByProps({ testID: 'wiki-switch' }).props.onPress())

        expect(textOf(component.toJSON())).toContain('Changing the wiki settings needs an internet connection.')
    })

    it('requests an update and says when one was already on its way', async () => {
        requestKnowledgeBaseRefresh.mockResolvedValue({ alreadyRequested: true })
        const component = mount({ enabled: true, ownerUserId: 'owner' })

        // Anyone in the project may ask for an update; it is billed like the nightly run.
        await act(async () => findButton(component, 'Update now').props.onPress())

        expect(requestKnowledgeBaseRefresh).toHaveBeenCalledWith('p1')
        expect(textOf(component.toJSON())).toContain('An update was already requested.')
    })

    it('lists the recent runs with why they stopped', () => {
        const component = mount({ enabled: true, ownerUserId: 'me' })
        act(() =>
            mockWatchers.runs([
                {
                    id: 'r1',
                    status: 'stopped',
                    stopReason: 'monthly_cap',
                    startedAt: Date.UTC(2026, 9, 20, 1),
                    sources: 12,
                    changes: [{ type: 'updated', slug: 'kunden' }],
                    goldSpent: 30,
                },
            ])
        )

        const runs = textOf(component.root.findByProps({ testID: 'project-wiki-runs' }).children)
        expect(runs).toContain('Stopped · Monthly Gold limit reached · 12 sources · 1 changes · 30 Gold')
    })
})
