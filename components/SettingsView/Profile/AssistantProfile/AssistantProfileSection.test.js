import React from 'react'
import { Text, TextInput, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

const mockState = { loggedUser: { uid: 'me' }, smallScreenNavigation: false }
const mockWatchers = { profile: null, revisions: null }

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => jest.fn(),
}))
jest.mock('../../../../utils/backends/AssistantProfile/assistantProfileFirestore', () => ({
    watchAssistantProfile: jest.fn((userId, onChange) => {
        mockWatchers.profile = onChange
        return () => {}
    }),
    watchAssistantProfileRevisions: jest.fn((userId, onChange) => {
        mockWatchers.revisions = onChange
        return () => {}
    }),
    saveAssistantProfileSettings: jest.fn(async () => ({})),
    requestAssistantProfileRefresh: jest.fn(async () => ({ alreadyRequested: false })),
}))
jest.mock('../../../AssistantProfile/AssistantProfileChangeModal', () => () => null)
jest.mock('../../../ProjectDetailedView/Wiki/ProjectWikiSettings', () => ({ ModelPicker: () => null }))
jest.mock('../../../WikiView/useKnowledgeBase', () => ({
    formatWikiDate: timestamp => (timestamp ? new Date(timestamp).toISOString().slice(0, 16) : ''),
}))
jest.mock('../../../Icon', () => () => null)
jest.mock('../../../UIControls/Button', () => {
    const { Text: MockText, TouchableOpacity: MockTouchable } = require('react-native')
    return ({ title, onPress, disabled }) => (
        <MockTouchable onPress={onPress} disabled={!!disabled}>
            <MockText>{title || ''}</MockText>
        </MockTouchable>
    )
})
jest.mock('../../../UIControls/Switch', () => {
    const { TouchableOpacity: MockTouchable } = require('react-native')
    return ({ active, disabled, activeSwitch, deactiveSwitch }) => (
        <MockTouchable
            testID="profile-switch"
            accessibilityState={{ checked: !!active }}
            disabled={!!disabled}
            onPress={active ? deactiveSwitch : activeSwitch}
        />
    )
})
jest.mock('../../../UIComponents/Spinner', () => () => null)
jest.mock(
    '../../../UIComponents/ModalShell/AppPopover',
    () =>
        ({ children }) =>
            children
)
jest.mock('../../../../redux/actions', () => ({ hideFloatPopup: () => ({}), showFloatPopup: () => ({}) }))
jest.mock('../../../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))
jest.mock('../../../../i18n/TranslationService', () => {
    const en = require('../../../../i18n/translations/en.json')
    return {
        translate: (key, values = {}) =>
            (en[key] !== undefined ? en[key] : key).replace(/%\{(\w+)\}/g, (_, name) =>
                values[name] !== undefined ? values[name] : ''
            ),
        useTranslator: () => {},
    }
})

import {
    requestAssistantProfileRefresh,
    saveAssistantProfileSettings,
} from '../../../../utils/backends/AssistantProfile/assistantProfileFirestore'
import AssistantProfileSection from './AssistantProfileSection'

const allText = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => [].concat(node.props.children).join(''))
        .join('\n')

const pressButton = (tree, title) =>
    tree.root
        .findAllByType(TouchableOpacity)
        .find(node => node.findAllByType(Text).some(text => [].concat(text.props.children).join('') === title))

async function renderWith(profile, revisions = []) {
    let tree
    await act(async () => {
        tree = renderer.create(<AssistantProfileSection />)
    })
    await act(async () => {
        mockWatchers.profile(profile)
        mockWatchers.revisions(revisions)
    })
    return tree
}

beforeEach(() => {
    jest.clearAllMocks()
})

describe('AssistantProfileSection', () => {
    it('shows a user the default has not reached yet as switched on', async () => {
        const tree = await renderWith(null)
        const text = allText(tree)
        expect(text).toContain('Assistant profile')
        expect(text).toContain('Switched on by default')
        expect(tree.root.findByProps({ testID: 'profile-switch' }).props.accessibilityState).toEqual({ checked: true })
    })

    it('saves an edited profile text, and only when it changed', async () => {
        const tree = await renderWith({ enabled: true, text: 'Old text', revision: 2 })
        const input = tree.root.findByProps({ testID: 'assistant-profile-text' })
        expect(input.props.value).toBe('Old text')
        expect(pressButton(tree, 'Save').props.disabled).toBe(true)

        await act(async () => input.props.onChangeText('New text'))
        await act(async () => pressButton(tree, 'Save').props.onPress())

        expect(saveAssistantProfileSettings).toHaveBeenCalledWith({ text: 'New text' })
    })

    it('switches the profile off and updates it on request', async () => {
        const tree = await renderWith({ enabled: true, text: 'Text', revision: 1, nextRunAt: Date.now() + 1000 })

        await act(async () => tree.root.findByProps({ testID: 'profile-switch' }).props.onPress())
        expect(saveAssistantProfileSettings).toHaveBeenCalledWith({ enabled: false })

        await act(async () => pressButton(tree, 'Update now').props.onPress())
        expect(requestAssistantProfileRefresh).toHaveBeenCalled()
        expect(allText(tree)).toContain('Update requested')
    })

    it('lists the recent versions with what changed', async () => {
        const tree = await renderWith({ enabled: true, text: 'Text', revision: 2 }, [
            { id: 'r000002', revision: 2, mode: 'run', summary: 'Added the launch date.', createdAt: Date.now() },
            { id: 'r000001', revision: 1, mode: 'user', summary: '', createdAt: Date.now() - 1000 },
        ])
        const text = allText(tree)
        expect(text).toContain('Recent changes')
        expect(text).toContain('Added the launch date.')
        expect(text).toContain('Updated automatically')
        expect(text).toContain('Edited by you')
    })

    it('saves a switched-off source and new instructions from the settings', async () => {
        const tree = await renderWith({ enabled: true, text: 'Text', revision: 1 })
        await act(async () => tree.root.findByProps({ testID: 'assistant-profile-settings-toggle' }).props.onPress())

        const notes = tree.root.findByProps({ testID: 'assistant-profile-source-notes' })
        await act(async () => notes.findByProps({ testID: 'profile-switch' }).props.onPress())
        expect(saveAssistantProfileSettings).toHaveBeenCalledWith({ sources: { notes: false } })

        const instructions = tree.root.findByProps({ testID: 'assistant-profile-instructions' })
        await act(async () => instructions.props.onChangeText('Leave out my family.'))
        await act(async () => pressButton(tree, 'Save instructions').props.onPress())
        expect(saveAssistantProfileSettings).toHaveBeenCalledWith({ instructions: 'Leave out my family.' })
        expect(tree.root.findAllByType(TextInput).length).toBeGreaterThan(1)
    })
})
