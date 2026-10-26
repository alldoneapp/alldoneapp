import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

const mockState = {
    loggedUser: { uid: 'u1', gold: 50 },
    loggedUserProjectsMap: { p1: { id: 'p1', assistantId: 'anna' } },
    assistants: { anna: { uid: 'anna', displayName: 'Anna' } },
}

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../MyDayView/AssistantLine/useAssistantLineSwitch', () => ({
    useProjectAssistantLine: () => ({ assistantLineProps: { preferAssistantIdOverride: false } }),
}))
jest.mock('../AdminPanel/Assistants/assistantStateLookup', () => ({
    getAssistantFromState: (state, assistantId) => state.assistants[assistantId],
}))
jest.mock('../../utils/assistantHelper', () => ({ createBotQuickTopic: jest.fn() }))
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

import { createBotQuickTopic } from '../../utils/assistantHelper'
import WikiCorrectionForm from './WikiCorrectionForm'

const PAGE = { slug: 'kunden', title: 'Kunden' }

function textOf(node) {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (!node || !node.children) return ''
    return node.children.map(textOf).join('')
}

const mounted = []
function mount(onClose = jest.fn()) {
    let component
    act(() => {
        component = renderer.create(<WikiCorrectionForm projectId="p1" page={PAGE} onClose={onClose} />)
    })
    mounted.push(component)
    return component
}

const button = (component, title) =>
    component.root
        .findAllByType(TouchableOpacity)
        .find(node => node.findAllByType(Text).some(child => textOf(child.children) === title))

const type = (component, text) =>
    act(() => component.root.findByProps({ testID: 'wiki-correction-input' }).props.onChangeText(text))

afterEach(() => {
    act(() => mounted.splice(0).forEach(component => component.unmount()))
})

beforeEach(() => {
    jest.clearAllMocks()
    mockState.loggedUser.gold = 50
    mockState.loggedUserProjectsMap.p1.assistantId = 'anna'
})

describe('WikiCorrectionForm', () => {
    it("hands the member's correction to the project's assistant in a new chat", async () => {
        createBotQuickTopic.mockResolvedValue({ chatId: 'c1' })
        const onClose = jest.fn()
        const component = mount(onClose)
        expect(button(component, 'Send to assistant').props.disabled).toBe(true)

        type(component, '  Ansprechpartnerin ist Frau Brandt.  ')
        await act(async () => button(component, 'Send to assistant').props.onPress())

        expect(createBotQuickTopic).toHaveBeenCalledWith(
            mockState.assistants.anna,
            'Feedback on the wiki page "Kunden" (kunden): Ansprechpartnerin ist Frau Brandt.\nPlease adjust the page accordingly.',
            { projectId: 'p1', enableAssistant: true }
        )
        expect(onClose).toHaveBeenCalled()
    })

    it('does not start a paid run without Gold', async () => {
        mockState.loggedUser.gold = 0
        const component = mount()

        type(component, 'Falsch.')
        await act(async () => button(component, 'Send to assistant').props.onPress())

        expect(createBotQuickTopic).not.toHaveBeenCalled()
        expect(textOf(component.toJSON())).toContain('Not enough Gold')
    })

    it('keeps the text and says so when the chat could not be started', async () => {
        createBotQuickTopic.mockRejectedValue(new Error('offline'))
        const onClose = jest.fn()
        const component = mount(onClose)

        type(component, 'Falsch.')
        await act(async () => button(component, 'Send to assistant').props.onPress())

        expect(onClose).not.toHaveBeenCalled()
        expect(component.root.findByProps({ testID: 'wiki-correction-input' }).props.value).toBe('Falsch.')
        expect(textOf(component.toJSON())).toContain('Could not start the correction chat')
    })

    it('cannot send anything when the project has no assistant', () => {
        mockState.loggedUserProjectsMap.p1.assistantId = 'missing'
        const component = mount()

        type(component, 'Falsch.')

        expect(button(component, 'Send to assistant').props.disabled).toBe(true)
        expect(textOf(component.toJSON())).toContain('This project has no assistant.')
    })
})
