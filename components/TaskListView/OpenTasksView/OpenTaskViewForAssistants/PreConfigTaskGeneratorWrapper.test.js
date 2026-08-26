import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import PreConfigTaskGeneratorWrapper from './PreConfigTaskGeneratorWrapper'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'

let mockState
const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return ({ children }) => <>{children}</>
})
jest.mock('../../../../redux/actions', () => ({
    hideFloatPopup: () => ({ type: 'hide-float-popup' }),
    showFloatPopup: () => ({ type: 'show-float-popup' }),
}))
jest.mock('../../../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../../../../utils/assistantHelper', () => ({ generateTaskFromPreConfig: jest.fn() }))
jest.mock(
    '../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal',
    () => 'RunOutOfGoldAssistantModal'
)
jest.mock(
    '../../../UIComponents/FloatModals/PreConfigTaskGeneratorModal/PreConfigTaskGeneratorModal',
    () => 'PreConfigTaskGeneratorModal'
)
jest.mock('../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal', () => ({
    TASK_TYPE_PROMPT: 'prompt',
    TASK_TYPE_WEBHOOK: 'webhook',
    TASK_TYPE_IFRAME: 'iframe',
}))
jest.mock('../../../ModalsManager/modalsManager', () => ({
    isModalOpen: jest.fn(() => false),
    MENTION_MODAL_ID: 'mention-modal',
}))
jest.mock('./PreConfigTaskButton', () => 'PreConfigTaskButton')

describe('PreConfigTaskGeneratorWrapper custom execution control', () => {
    const task = {
        id: 'scheduled-task-1',
        name: 'Prepare report',
        type: 'prompt',
        prompt: 'Prepare the report',
        variables: [],
        aiModel: 'model-1',
        aiReasoningEffort: 'high',
        aiSystemMessage: 'Be concise',
        taskMetadata: { source: 'schedule' },
        executionMode: 'direct',
        sendWhatsApp: true,
    }

    beforeEach(() => {
        jest.clearAllMocks()
        mockState = {
            loggedUser: { gold: 100 },
            preConfigTaskExecuting: null,
        }
    })

    it('delegates a custom play control to the existing task generator without opening the task', () => {
        const tree = renderer.create(
            <PreConfigTaskGeneratorWrapper
                projectId="project-1"
                task={task}
                assistant={{ uid: 'assistant-1' }}
                skipNavigation
            >
                {props => <TouchableOpacity testID="play-task" {...props} />}
            </PreConfigTaskGeneratorWrapper>
        )
        const stopPropagation = jest.fn()

        tree.root.findByProps({ testID: 'play-task' }).props.onPress({ stopPropagation })

        expect(stopPropagation).toHaveBeenCalledTimes(1)
        expect(generateTaskFromPreConfig).toHaveBeenCalledWith(
            'project-1',
            'Prepare report',
            'assistant-1',
            'Prepare the report',
            {
                model: 'model-1',
                reasoningEffort: 'high',
                systemMessage: 'Be concise',
            },
            {
                source: 'schedule',
                sendWhatsApp: true,
                executionMode: 'direct',
            },
            { skipNavigation: true }
        )
    })

    it('passes the running state through and blocks duplicate execution', () => {
        mockState.preConfigTaskExecuting = task.name
        const tree = renderer.create(
            <PreConfigTaskGeneratorWrapper
                projectId="project-1"
                task={task}
                assistant={{ uid: 'assistant-1' }}
                skipNavigation
            >
                {props => <TouchableOpacity testID="play-task" {...props} />}
            </PreConfigTaskGeneratorWrapper>
        )
        const button = tree.root.findByProps({ testID: 'play-task' })

        expect(button.props.running).toBe(true)
        expect(button.props.disabled).toBe(true)
        button.props.onPress()
        expect(generateTaskFromPreConfig).not.toHaveBeenCalled()
    })

    it('acquires once for repeated popup opens and releases when the task control unmounts', () => {
        const taskWithVariables = { ...task, variables: [{ name: 'customer' }] }
        const tree = renderer.create(
            <PreConfigTaskGeneratorWrapper
                projectId="project-1"
                task={taskWithVariables}
                assistant={{ uid: 'assistant-1' }}
                skipNavigation
            >
                {props => <TouchableOpacity testID="play-task" {...props} />}
            </PreConfigTaskGeneratorWrapper>
        )
        const button = tree.root.findByProps({ testID: 'play-task' })

        act(() => {
            button.props.onPress()
            button.props.onPress()
        })

        expect(mockDispatch.mock.calls.filter(([action]) => action.type === 'show-float-popup')).toHaveLength(1)

        act(() => tree.unmount())

        expect(mockDispatch.mock.calls.filter(([action]) => action.type === 'hide-float-popup')).toHaveLength(1)
    })
})
