import React from 'react'
import { Text, View } from 'react-native'
import renderer from 'react-test-renderer'

import { AssistantScheduleRows } from './AssistantScheduleTimeline'
import AiStepCheckBox from '../../TaskItem/TaskPresentation/CheckBoxContainer/AiStepCheckBox'
import PreConfigTaskGeneratorWrapper from './PreConfigTaskGeneratorWrapper'

const mockRunTask = jest.fn()

let mockState

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: key => key,
    getDeviceLanguage: () => 'en',
}))
jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('../../Header/DateHeader', () => 'DateHeader')
jest.mock('../../../styles/global', () => ({
    __esModule: true,
    default: { body1: {} },
    colors: { Text01: '#000000', Text03: '#999999', UtilityRed200: '#ff0000' },
}))
jest.mock('../../../UIComponents/FloatModals/DateFormatPickerModal', () => ({ getTimeFormat: () => 'HH:mm' }))
jest.mock('../../../Tags/DateTag', () => 'DateTag')
jest.mock('../../../Tags/TaskRecurrence', () => 'TaskRecurrence')
jest.mock('../../../Tags/TaskTypeTag', () => 'TaskTypeTag')
jest.mock('../../../Tags/UserTag', () => 'UserTag')
jest.mock('../../../Tags/TaskSummarizeTags', () => 'TaskSummarizeTags')
jest.mock(
    '../../../AssistantDetailedView/Customizations/PreConfigTasks/AddPreConfigTaskWrapper',
    () => 'AddPreConfigTaskWrapper'
)
jest.mock('./PreConfigTaskGeneratorWrapper', () => {
    const React = require('react')
    return props => props.children({ onPress: mockRunTask, running: false, disabled: props.disabled })
})
jest.mock('../../TaskItem/TaskPresentation/CheckBoxContainer/AiStepCheckBox', () => 'AiStepCheckBox')

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

    beforeEach(() => {
        mockState = {
            isMiddleScreen: false,
            smallScreenNavigation: false,
            smallScreenNavSidebarCollapsed: false,
        }
        mockRunTask.mockClear()
    })

    const renderRows = (occurrenceToRender = occurrence) =>
        renderer.create(
            <AssistantScheduleRows
                projectId="project-1"
                tasksProjectId="assistant-tasks-project"
                assistant={{ uid: 'assistant-1' }}
                occurrences={[occurrenceToRender]}
            />
        )

    const expandTags = tree => {
        const preventDefault = jest.fn()
        const stopPropagation = jest.fn()

        renderer.act(() => {
            tree.root.findByType('TaskSummarizeTags').props.onPress({ preventDefault, stopPropagation })
        })

        expect(preventDefault).toHaveBeenCalled()
        expect(stopPropagation).toHaveBeenCalled()
    }

    const getExpandedTagOrder = tree =>
        tree.root
            .findByProps({ testID: 'assistant-schedule-task-expanded-tags' })
            .findAll(node => node.type === View && node.props.testID?.startsWith('assistant-schedule-task-tag-'))
            .map(node => node.props.testID.replace('assistant-schedule-task-tag-', ''))

    it('opens the existing preconfigured-task editor and keeps the tags in the task row', () => {
        const tree = renderRows()

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
        const playButton = tree.root.findByProps({ testID: 'assistant-schedule-task-play-button' })
        const executionWrapper = tree.root.findByType(PreConfigTaskGeneratorWrapper)
        const tags = tree.root.findByProps({ testID: 'assistant-schedule-task-tags' })
        expect(taskList.props.style).toBeUndefined()
        expect(taskRow.findAllByType(View)).toContain(tags)
        expect(leadingContent.props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ alignItems: 'center' })])
        )
        expect(playButton.props.style).toMatchObject({
            width: 24,
            height: 24,
            alignItems: 'center',
            justifyContent: 'center',
        })
        expect(executionWrapper.props).toMatchObject({
            projectId: 'project-1',
            task,
            assistant: { uid: 'assistant-1' },
            disabled: false,
            skipNavigation: true,
        })
        expect(playButton.findByType(AiStepCheckBox).props.running).toBe(false)
        expect(playButton.props.accessibilityLabel).toBe('Run now')
        playButton.props.onPress()
        expect(mockRunTask).toHaveBeenCalledTimes(1)
        expect(tags.findByType('DateTag').props).toMatchObject({
            date: '09:00 CEST',
            icon: 'clock',
            disabled: true,
        })
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
        const tree = renderRows(workflowOccurrence)

        expect(tree.root.findAllByType('TaskTypeTag')).toHaveLength(0)
    })

    it.each([
        ['desktop', {}, { ...occurrence, status: 'failed' }, 5],
        ['tablet', { isMiddleScreen: true }, occurrence, 4],
        ['mobile', { smallScreenNavigation: true }, { ...occurrence, task: { ...task, executionMode: 'workflow' } }, 3],
        [
            'collapsed-sidebar mobile',
            { smallScreenNavSidebarCollapsed: true },
            { ...occurrence, task: { ...task, executionMode: 'workflow' } },
            3,
        ],
    ])('applies the normal collapse limit on %s layouts', (layout, stateOverrides, occurrenceToRender, amountTags) => {
        mockState = { ...mockState, ...stateOverrides }
        const tree = renderRows(occurrenceToRender)

        expect(tree.root.findByType('TaskSummarizeTags').props.amountTags).toBe(amountTags)
        expect(tree.root.findAllByProps({ testID: 'assistant-schedule-task-expanded-tags' })).toHaveLength(0)
    })

    it('counts bypass workflow and every other collapsed tag, then expands them in their normal order', () => {
        mockState.isMiddleScreen = true
        const tree = renderRows()

        expect(tree.root.findByType('TaskSummarizeTags').props.amountTags).toBe(4)

        expandTags(tree)

        expect(getExpandedTagOrder(tree)).toEqual(['time', 'recurrence', 'bypass-workflow', 'user'])
        expect(tree.root.findByProps({ testID: 'assistant-schedule-task-expanded-tags' }).props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ flexWrap: 'wrap' })])
        )
        expect(tree.root.findByType('TaskTypeTag').props).toMatchObject({
            icon: 'fast-forward',
            text: 'Bypass workflow',
            iconOnly: false,
        })
        expect(tree.root.findByType('UserTag').props.onlyPhoto).toBe(false)
    })

    it.each([
        ['mobile navigation', { smallScreenNavigation: true }],
        ['collapsed mobile sidebar', { smallScreenNavSidebarCollapsed: true }],
    ])('renders bypass workflow and assignee as icon-only tags on %s', (layout, stateOverrides) => {
        mockState = { ...mockState, ...stateOverrides }
        const tree = renderRows()

        expect(tree.root.findByType('TaskSummarizeTags').props.amountTags).toBe(4)

        expandTags(tree)

        expect(tree.root.findByType('TaskTypeTag').props).toMatchObject({
            icon: 'fast-forward',
            text: 'Bypass workflow',
            iconOnly: true,
        })
        expect(tree.root.findByType('UserTag').props).toMatchObject({
            user: occurrence.user,
            onlyPhoto: true,
        })
        expect(getExpandedTagOrder(tree)).toEqual(['time', 'recurrence', 'bypass-workflow', 'user'])
    })

    it('includes the failure tag last in the collapsed count and expanded order', () => {
        const tree = renderRows({ ...occurrence, status: 'failed' })

        expect(tree.root.findByType('TaskSummarizeTags').props.amountTags).toBe(5)

        expandTags(tree)

        expect(getExpandedTagOrder(tree)).toEqual(['time', 'recurrence', 'bypass-workflow', 'user', 'needs-attention'])
    })

    it('keeps two tags visible at the normal mobile boundary', () => {
        mockState.smallScreenNavigation = true
        const tree = renderRows({
            ...occurrence,
            task: { ...task, executionMode: 'workflow' },
            user: null,
            userId: null,
        })

        expect(tree.root.findAllByType('TaskSummarizeTags')).toHaveLength(0)
        expect(
            tree.root.findAll(node => node.type === View && node.props.testID === 'assistant-schedule-task-tag-time')
        ).toHaveLength(1)
        expect(
            tree.root.findAll(
                node => node.type === View && node.props.testID === 'assistant-schedule-task-tag-recurrence'
            )
        ).toHaveLength(1)
    })

    it('uses the normal measured-width collapse rule on wide layouts', () => {
        const tree = renderRows()

        renderer.act(() => {
            tree.root.findByProps({ testID: 'assistant-schedule-task-row' }).props.onLayout({
                nativeEvent: { layout: { width: 600 } },
            })
        })
        renderer.act(() => {
            tree.root.findByProps({ testID: 'assistant-schedule-task-tags' }).props.onLayout({
                nativeEvent: { layout: { width: 421 } },
            })
        })

        expect(tree.root.findByType('TaskSummarizeTags').props.amountTags).toBe(4)
    })
})
