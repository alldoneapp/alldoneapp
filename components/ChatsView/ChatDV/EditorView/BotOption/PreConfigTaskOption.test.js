import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'

import PreConfigTaskOption from './PreConfigTaskOption'
import { TASK_TYPE_PROMPT, TASK_TYPE_WEBHOOK } from '../../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import { generateTaskFromPreConfig } from '../../../../../utils/assistantHelper'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
}))
jest.mock('../../../../Icon', () => 'Icon')
jest.mock('../../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal', () => ({
    TASK_TYPE_PROMPT: 'prompt',
    TASK_TYPE_EXTERNAL_LINK: 'external-link',
    TASK_TYPE_WEBHOOK: 'webhook',
    TASK_TYPE_IFRAME: 'iframe',
}))
jest.mock('../../../../../utils/assistantHelper', () => ({
    generateTaskFromPreConfig: jest.fn(),
}))
jest.mock('../../../../../redux/actions', () => ({
    setAssistantEnabled: jest.fn(value => ({ type: 'assistant-enabled', value })),
}))

describe('PreConfigTaskOption prompt execution', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        generateTaskFromPreConfig.mockClear()
    })

    test('closes before handing a variable-free prompt to the current-object execution callback', () => {
        const callOrder = []
        const closeModal = jest.fn(() => callOrder.push('close'))
        const onSelectBotOption = jest.fn(() => callOrder.push('execute'))
        const task = {
            id: 'prompt-1',
            name: 'Prepare launch',
            prompt: 'Review the current task',
            variables: [],
            type: TASK_TYPE_PROMPT,
            aiModel: 'MODEL_TEST',
            aiTemperature: 'TEMPERATURE_NORMAL',
            aiSystemMessage: 'Be concise',
            taskMetadata: { source: 'predefined' },
            sendWhatsApp: true,
        }
        const tree = renderer.create(
            <PreConfigTaskOption
                task={task}
                closeModal={closeModal}
                selectTask={jest.fn()}
                onSelectBotOption={onSelectBotOption}
                projectId="project-1"
                assistantId="assistant-1"
            />
        )

        act(() => tree.root.findByType(TouchableOpacity).props.onPress())

        expect(callOrder).toEqual(['close', 'execute'])
        expect(onSelectBotOption).toHaveBeenCalledWith(
            'Review the current task',
            'Prepare launch',
            {
                model: 'MODEL_TEST',
                temperature: 'TEMPERATURE_NORMAL',
                systemMessage: 'Be concise',
            },
            { taskMetadata: { source: 'predefined', sendWhatsApp: true } }
        )
        expect(generateTaskFromPreConfig).not.toHaveBeenCalled()
    })

    test('keeps webhook tasks on their existing task-generation path', () => {
        const closeModal = jest.fn()
        const onSelectBotOption = jest.fn()
        const task = {
            id: 'webhook-1',
            name: 'Notify system',
            prompt: 'Send update',
            variables: [],
            type: TASK_TYPE_WEBHOOK,
            taskMetadata: { isWebhookTask: true, webhookUrl: 'https://example.com/hook' },
        }
        const tree = renderer.create(
            <PreConfigTaskOption
                task={task}
                closeModal={closeModal}
                selectTask={jest.fn()}
                onSelectBotOption={onSelectBotOption}
                projectId="project-1"
                assistantId="assistant-1"
            />
        )

        act(() => tree.root.findByType(TouchableOpacity).props.onPress())

        expect(closeModal).toHaveBeenCalledTimes(1)
        expect(onSelectBotOption).not.toHaveBeenCalled()
        expect(generateTaskFromPreConfig).toHaveBeenCalledWith(
            'project-1',
            'Notify system',
            'assistant-1',
            'Send update',
            { model: undefined, temperature: undefined, systemMessage: undefined },
            { isWebhookTask: true, webhookUrl: 'https://example.com/hook', sendWhatsApp: false }
        )
    })
})
