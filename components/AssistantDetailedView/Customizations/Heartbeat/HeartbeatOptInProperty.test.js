import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import HeartbeatOptInProperty from './HeartbeatOptInProperty'
import {
    getAssistantHeartbeatOptIn,
    setAssistantHeartbeatOptIn,
} from '../../../../utils/backends/Assistants/assistantsFirestore'

jest.mock('../../../Icon', () => () => null)
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../../utils/backends/Assistants/assistantsFirestore', () => ({
    getAssistantHeartbeatOptIn: jest.fn(),
    setAssistantHeartbeatOptIn: jest.fn(),
}))

const assistant = { uid: 'assistant-1', heartbeatPrompt: 'Check in.', allowedTools: ['get_tasks'] }

async function render(state) {
    getAssistantHeartbeatOptIn.mockResolvedValue({ success: true, state })
    let component
    await act(async () => {
        component = renderer.create(<HeartbeatOptInProperty projectId="project-1" assistant={assistant} />)
    })
    return component
}
const checkbox = component => component.root.findByType(TouchableOpacity)
const texts = component => component.root.findAllByType(Text).map(node => node.props.children)

// NV-17: in a shared project a heartbeat runs as a member only after they confirmed it.
describe('HeartbeatOptInProperty', () => {
    beforeEach(() => jest.clearAllMocks())

    test('lets a member who never confirmed opt in', async () => {
        const component = await render('none')
        expect(checkbox(component).props.accessibilityState.checked).toBe(false)
        setAssistantHeartbeatOptIn.mockResolvedValue({ success: true, state: 'confirmed' })

        await act(async () => checkbox(component).props.onPress())

        expect(setAssistantHeartbeatOptIn).toHaveBeenCalledWith('project-1', 'assistant-1', true)
        expect(checkbox(component).props.accessibilityState.checked).toBe(true)
    })

    test('explains a configuration somebody changed since the confirmation, and re-confirms it', async () => {
        const component = await render('stale')
        expect(texts(component)).toContain('heartbeatOptInStale')
        expect(checkbox(component).props.accessibilityState.checked).toBe(false)
        setAssistantHeartbeatOptIn.mockResolvedValue({ success: true, state: 'confirmed' })

        await act(async () => checkbox(component).props.onPress())

        expect(setAssistantHeartbeatOptIn).toHaveBeenCalledWith('project-1', 'assistant-1', true)
    })

    test('lets a confirmed member opt out', async () => {
        const component = await render('confirmed')
        setAssistantHeartbeatOptIn.mockResolvedValue({ success: true, state: 'none' })

        await act(async () => checkbox(component).props.onPress())

        expect(setAssistantHeartbeatOptIn).toHaveBeenCalledWith('project-1', 'assistant-1', false)
        expect(checkbox(component).props.accessibilityState.checked).toBe(false)
    })

    test('renders nothing when the state cannot be read', async () => {
        getAssistantHeartbeatOptIn.mockRejectedValue(new Error('offline'))
        let component
        await act(async () => {
            component = renderer.create(<HeartbeatOptInProperty projectId="project-1" assistant={assistant} />)
        })
        expect(component.toJSON()).toBeNull()
    })
})
