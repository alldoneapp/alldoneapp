import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

const mockState = {
    loggedUser: { uid: 'u1', gold: 50 },
    loggedUserProjectsMap: { p1: { id: 'p1', assistantId: 'anna' } },
    assistants: {},
}

const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState), useDispatch: () => mockDispatch }))
jest.mock('../MyDayView/AssistantLine/useAssistantLineSwitch', () => ({
    useProjectAssistantLine: () => ({ assistantLineProps: { preferAssistantIdOverride: false } }),
}))
jest.mock('../AdminPanel/Assistants/assistantStateLookup', () => ({
    getAssistantFromState: (state, assistantId) => state.assistants[assistantId],
}))
jest.mock('../../utils/backends/Chats/chatsComments', () => ({ createObjectMessage: jest.fn() }))
jest.mock('../../redux/actions', () => ({ setTriggerBotSpinner: trigger => ({ type: 'triggerBotSpinner', trigger }) }))
jest.mock('../UIControls/Button', () => {
    const { Text: MockText, TouchableOpacity: MockTouchable } = require('react-native')
    return ({ title, onPress, disabled }) => (
        <MockTouchable onPress={onPress} disabled={!!disabled}>
            <MockText>{title}</MockText>
        </MockTouchable>
    )
})
jest.mock('../../i18n/TranslationService', () => {
    const en = require('../../i18n/translations/en.json')
    return {
        translate: (key, values = {}) =>
            (en[key] !== undefined ? en[key] : key).replace(/%\{(\w+)\}/g, (_, name) =>
                values[name] !== undefined ? values[name] : ''
            ),
    }
})

import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import ArtifactAssistantForm, { canAssistantEditArtifacts } from './ArtifactAssistantForm'

let ARTIFACT

function textOf(node) {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (!node || !node.children) return ''
    return node.children.map(textOf).join('')
}

const mounted = []
function mount(onClose = jest.fn(), onSent) {
    let component
    act(() => {
        component = renderer.create(
            <ArtifactAssistantForm projectId="p1" artifact={ARTIFACT} onClose={onClose} onSent={onSent} />
        )
    })
    mounted.push(component)
    return component
}

const button = (component, title) =>
    component.root
        .findAllByType(TouchableOpacity)
        .find(node => node.findAllByType(Text).some(child => textOf(child.children) === title))

const type = (component, text) =>
    act(() => component.root.findByProps({ testID: 'artifact-assistant-input' }).props.onChangeText(text))

afterEach(() => {
    act(() => mounted.splice(0).forEach(component => component.unmount()))
})

beforeEach(() => {
    jest.clearAllMocks()
    ARTIFACT = { id: 'a1', title: 'Sales dashboard', assistantId: '' }
    mockState.loggedUser.gold = 50
    mockState.assistants = { anna: { uid: 'anna', displayName: 'Anna', allowedTools: ['create_note', 'artifacts'] } }
})

describe('ArtifactAssistantForm', () => {
    it("posts the requested change into the artifact's chat for the project's assistant", async () => {
        createObjectMessage.mockResolvedValue('comment-1')
        const onClose = jest.fn()
        const onSent = jest.fn()
        const component = mount(onClose, onSent)
        expect(button(component, 'Send to assistant').props.disabled).toBe(true)

        type(component, '  Add a chart per month.  ')
        await act(async () => button(component, 'Send to assistant').props.onPress())

        expect(createObjectMessage).toHaveBeenCalledWith(
            'p1',
            'a1',
            'Add a chart per month.',
            'artifacts',
            null,
            null,
            null,
            false,
            true,
            'anna'
        )
        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'triggerBotSpinner',
            trigger: expect.objectContaining({ projectId: 'p1', chatId: 'a1' }),
        })
        expect(onSent).toHaveBeenCalled()
        expect(onClose).not.toHaveBeenCalled()
    })

    it("asks the assistant already chosen for the artifact's chat", async () => {
        createObjectMessage.mockResolvedValue('comment-1')
        mockState.assistants.designer = { uid: 'designer', displayName: 'Designer', allowedTools: ['artifacts'] }
        ARTIFACT.assistantId = 'designer'
        const component = mount()
        type(component, 'Use the brand colours.')
        await act(async () => button(component, 'Send to assistant').props.onPress())
        expect(createObjectMessage.mock.calls[0][9]).toBe('designer')
    })

    it('says how to fix it when the assistant may not edit artifacts', () => {
        mockState.assistants.anna.allowedTools = ['create_note']
        const component = mount()

        type(component, 'Add a chart.')

        expect(button(component, 'Send to assistant').props.disabled).toBe(true)
        expect(textOf(component.toJSON())).toContain('Anna cannot edit artifacts yet.')
    })

    it('does not start a paid run without Gold', async () => {
        mockState.loggedUser.gold = 0
        const component = mount()
        type(component, 'Add a chart.')
        await act(async () => button(component, 'Send to assistant').props.onPress())
        expect(createObjectMessage).not.toHaveBeenCalled()
        expect(textOf(component.toJSON())).toContain('Not enough Gold')
    })

    it('keeps the text and says so when the chat could not be started', async () => {
        createObjectMessage.mockRejectedValue(new Error('Sign in before sending a comment.'))
        const onClose = jest.fn()
        const component = mount(onClose)
        type(component, 'Add a chart.')
        await act(async () => button(component, 'Send to assistant').props.onPress())
        expect(onClose).not.toHaveBeenCalled()
        expect(component.root.findByProps({ testID: 'artifact-assistant-input' }).props.value).toBe('Add a chart.')
        expect(textOf(component.toJSON())).toContain('Could not start the chat. Please try again.')
        expect(mockDispatch).toHaveBeenLastCalledWith({ type: 'triggerBotSpinner', trigger: null })
    })

    it('only refuses when the tool list is known and lacks the permission', () => {
        expect(canAssistantEditArtifacts({ allowedTools: ['artifacts'] })).toBe(true)
        expect(canAssistantEditArtifacts({ allowedTools: [] })).toBe(false)
        expect(canAssistantEditArtifacts({})).toBe(true)
    })
})
