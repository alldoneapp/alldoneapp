import React from 'react'
import renderer from 'react-test-renderer'
import { StyleSheet } from 'react-native'

import TaskAssistantButton from './TaskAssistantButton'

jest.mock('../../UIControls/DvBotButton', () => 'DvBotButton')

describe('TaskAssistantButton', () => {
    test('renders the resolved-assistant predefined-task control for the inline task editor', () => {
        const task = {
            id: 'task-1',
            name: 'Prepare launch',
            assistantId: 'task-assistant',
        }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)
        const button = tree.root.findByType('DvBotButton')

        expect(button.props).toEqual(
            expect.objectContaining({
                projectId: 'project-1',
                assistantId: 'task-assistant',
                objectId: 'task-1',
                objectType: 'tasks',
                parentObject: task,
                resolveProjectAssistant: true,
                stopPressPropagation: true,
                hotkey: 'alt+a',
            })
        )
        expect(StyleSheet.flatten(button.props.style)).toEqual(
            expect.objectContaining({
                width: 24,
                height: 24,
                minHeight: 24,
                maxHeight: 24,
                marginRight: 0,
                padding: 0,
                paddingHorizontal: 0,
                paddingVertical: 0,
                borderWidth: 0,
            })
        )
    })

    test('allows the shared resolver to fall back when the task has no assistant', () => {
        const task = { id: 'task-1', name: 'Prepare launch' }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        expect(tree.root.findByType('DvBotButton').props.assistantId).toBe('')
        expect(tree.root.findByType('DvBotButton').props.resolveProjectAssistant).toBe(true)
    })

    test('preserves the disabled state from the inline task editor', () => {
        const tree = renderer.create(
            <TaskAssistantButton
                projectId="project-1"
                task={{ id: 'task-1', name: 'Prepare launch' }}
                disabled={true}
            />
        )
        const button = tree.root.findByType('DvBotButton')

        expect(button.props.disabled).toBe(true)
        expect(StyleSheet.flatten(button.props.style).opacity).toBe(0.5)
    })
})
