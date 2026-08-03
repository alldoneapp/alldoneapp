import React from 'react'
import { Text, View } from 'react-native'
import renderer from 'react-test-renderer'

import { AssistantScheduleRows } from './AssistantScheduleTimeline'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: key => key,
    getDeviceLanguage: () => 'en',
}))
jest.mock('../../Header/DateHeader', () => 'DateHeader')
jest.mock('../../../styles/global', () => ({
    __esModule: true,
    default: { body1: {} },
    colors: { Text01: '#000000', Text03: '#999999', UtilityRed200: '#ff0000' },
}))
jest.mock('../../../UIComponents/FloatModals/DateFormatPickerModal', () => ({ getTimeFormat: () => 'HH:mm' }))
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../Tags/DateTag', () => 'DateTag')
jest.mock('../../../Tags/TaskRecurrence', () => 'TaskRecurrence')
jest.mock('../../../Tags/TaskTypeTag', () => 'TaskTypeTag')
jest.mock('../../../Tags/UserTag', () => 'UserTag')
jest.mock(
    '../../../AssistantDetailedView/Customizations/PreConfigTasks/AddPreConfigTaskWrapper',
    () => 'AddPreConfigTaskWrapper'
)

describe('AssistantScheduleRows', () => {
    const task = {
        id: 'scheduled-task-1',
        name: 'Prepare the weekly report',
        recurrence: 'weekly',
    }
    const occurrence = {
        id: 'scheduled-task-1:user-1:1',
        task,
        user: { uid: 'user-1', displayName: 'Karsten Wysk', photoURL: 'avatar.jpg' },
        userId: 'user-1',
        recurrence: 'weekly',
        timestamp: Date.UTC(2026, 7, 3, 7, 0),
        timezoneName: 'Europe/Berlin',
        status: null,
    }

    it('opens the existing preconfigured-task editor and keeps the tags in the task row', () => {
        const tree = renderer.create(
            <AssistantScheduleRows
                projectId="project-1"
                tasksProjectId="assistant-tasks-project"
                assistant={{ uid: 'assistant-1' }}
                occurrences={[occurrence]}
            />
        )

        const editorWrapper = tree.root.findByType('AddPreConfigTaskWrapper')
        expect(editorWrapper.props).toMatchObject({
            projectId: 'assistant-tasks-project',
            assistantId: 'assistant-1',
            task,
            adding: false,
            disabled: false,
        })

        const taskList = tree.root.findByProps({ testID: 'assistant-schedule-task-list' })
        const taskRow = tree.root.findByProps({ testID: 'assistant-schedule-task-row' })
        const leadingContent = tree.root.findByProps({ testID: 'assistant-schedule-task-leading-content' })
        const scheduleIcon = tree.root.findByProps({ testID: 'assistant-schedule-task-icon' })
        const tags = tree.root.findByProps({ testID: 'assistant-schedule-task-tags' })
        expect(taskList.props.style).toBeUndefined()
        expect(taskRow.findAllByType(View)).toContain(tags)
        expect(leadingContent.props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ alignItems: 'center' })])
        )
        expect(scheduleIcon.props.style).toMatchObject({
            width: 24,
            height: 24,
            alignItems: 'center',
            justifyContent: 'center',
        })
        expect(scheduleIcon.findByType('Icon').props).toMatchObject({
            name: 'clock',
            size: 20,
        })
        expect(tags.findAllByType('DateTag')).toHaveLength(1)
        expect(tags.findAllByType('TaskRecurrence')).toHaveLength(1)
        expect(tags.findAllByType('UserTag')).toHaveLength(1)
        expect(tags.findAllByType('TaskTypeTag').map(tag => tag.props)).toEqual([
            expect.objectContaining({ icon: 'fast-forward', text: 'Bypass workflow' }),
        ])

        const labels = tree.root.findAllByType(Text).map(node => node.props.children)
        expect(labels).not.toContain('Run now')
        expect(labels).not.toContain('Pause')
    })

    it('hides the default workflow mode tag', () => {
        const workflowOccurrence = {
            ...occurrence,
            task: { ...task, executionMode: 'workflow' },
        }
        const tree = renderer.create(
            <AssistantScheduleRows
                projectId="project-1"
                tasksProjectId="assistant-tasks-project"
                assistant={{ uid: 'assistant-1' }}
                occurrences={[workflowOccurrence]}
            />
        )

        expect(tree.root.findAllByType('TaskTypeTag')).toHaveLength(0)
    })
})
