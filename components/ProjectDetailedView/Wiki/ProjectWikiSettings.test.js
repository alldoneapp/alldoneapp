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
        <MockTouchable testID="wiki-switch" disabled={!!disabled} onPress={active ? deactiveSwitch : activeSwitch} />
    )
})
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

    it('locks every control of a wiki another member pays for', () => {
        const component = mount({ enabled: true, ownerUserId: 'owner' })
        const text = textOf(component.toJSON())

        expect(text).toContain('Paid by Karsten')
        expect(text).toContain('Only the member who pays for the wiki can change these settings.')
        expect(component.root.findByProps({ testID: 'wiki-switch' }).props.disabled).toBe(true)
        expect(component.root.findByProps({ testID: 'project-wiki-cap' }).props.editable).toBe(false)
        expect(component.root.findByProps({ testID: 'project-wiki-instructions' }).props.editable).toBe(false)
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
