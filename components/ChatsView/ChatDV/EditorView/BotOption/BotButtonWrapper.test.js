import React from 'react'
import renderer, { act } from 'react-test-renderer'

import BotButtonWrapper from './BotButtonWrapper'
import { resolveAssistantForProjectObject } from '../../../../AdminPanel/Assistants/assistantsHelper'
import { setAssistantForObject } from './objectAssistantHelper'
import { setObjectAssistantEnabled } from '../../../../../utils/assistantHelper'

const mockDispatch = jest.fn()
const mockState = {
    loggedUser: { gold: 10, noticeAboutTheBotBehavior: true },
    smallScreenNavigation: false,
    showNotificationAboutTheBotBehavior: false,
    projectAssistants: {},
    globalAssistants: [],
    defaultAssistant: {},
    loggedUserProjects: [],
    loggedUserProjectsMap: {},
}

jest.mock('react-redux', () => ({
    shallowEqual: jest.fn(),
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return ({ children, content, isOpen }) => (
        <React.Fragment>
            {children}
            {isOpen ? content : null}
        </React.Fragment>
    )
})
jest.mock('./BotButton', () => 'BotButton')
jest.mock('./BotButtonInModal', () => 'BotButtonInModal')
jest.mock('./BotOptionsModal', () => 'BotOptionsModal')
jest.mock('./RunOutOfGoldAssistantModal', () => 'RunOutOfGoldAssistantModal')
jest.mock('../../../../ModalsManager/modalsManager', () => ({
    isModalOpen: jest.fn(() => false),
    MENTION_MODAL_ID: 'mention-modal',
}))
jest.mock('../../../../AdminPanel/Assistants/assistantsHelper', () => ({
    resolveAssistantForProjectObject: jest.fn(),
}))
jest.mock('./objectAssistantHelper', () => ({ setAssistantForObject: jest.fn() }))
jest.mock('../../../../../utils/assistantHelper', () => ({ setObjectAssistantEnabled: jest.fn() }))
jest.mock('../../../../../redux/actions', () => ({
    setAssistantEnabled: jest.fn(value => ({ type: 'assistant-enabled', value })),
    setShowNotificationAboutTheBotBehavior: jest.fn(),
}))

describe('BotButtonWrapper object assistant default', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        resolveAssistantForProjectObject.mockReturnValue({
            uid: 'project-assistant',
            displayName: 'Project Anna',
        })
        setAssistantForObject.mockResolvedValue(true)
    })

    it('shows and assigns the project assistant on the one-click enable path', async () => {
        const setAssistantId = jest.fn()
        const updateObjectState = jest.fn()
        const tree = renderer.create(
            <BotButtonWrapper
                inModal={true}
                projectId="project-1"
                objectId="task-1"
                objectType="tasks"
                assistantId=""
                setAssistantId={setAssistantId}
                assistantEnabled={false}
                updateObjectState={updateObjectState}
            />
        )

        expect(tree.root.findByType('BotButtonInModal').props.assistantId).toBe('project-assistant')

        await act(async () => tree.root.findByType('BotButtonInModal').props.onPress())

        expect(setAssistantId).toHaveBeenCalledWith('project-assistant')
        expect(setAssistantForObject).toHaveBeenCalledWith('project-1', 'task-1', 'tasks', 'project-assistant', false)
        expect(setObjectAssistantEnabled).toHaveBeenCalledWith('project-1', 'task-1', 'tasks', true)
        expect(updateObjectState).toHaveBeenCalledWith({ isAssistantEnabled: true })
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'assistant-enabled', value: true })
    })

    it('preserves an explicit object assistant without writing it again', async () => {
        resolveAssistantForProjectObject.mockReturnValue({ uid: 'assigned-assistant' })
        const tree = renderer.create(
            <BotButtonWrapper
                inModal={true}
                projectId="project-1"
                objectId="note-1"
                objectType="notes"
                assistantId="assigned-assistant"
                assistantEnabled={false}
            />
        )

        await act(async () => tree.root.findByType('BotButtonInModal').props.onPress())

        expect(setAssistantForObject).not.toHaveBeenCalled()
        expect(setObjectAssistantEnabled).toHaveBeenCalledWith('project-1', 'note-1', 'notes', true)
    })

    it('uses the resolved fallback in the assistant options menu', () => {
        const tree = renderer.create(
            <BotButtonWrapper
                inModal={true}
                projectId="project-1"
                objectId="goal-1"
                objectType="goals"
                assistantId=""
                assistantEnabled={true}
            />
        )

        act(() => tree.root.findByType('BotButtonInModal').props.onPress())

        expect(tree.root.findByType('BotOptionsModal').props.assistantId).toBe('')
        expect(tree.root.findByType('BotButtonInModal').props.assistantId).toBe('project-assistant')
    })
})
