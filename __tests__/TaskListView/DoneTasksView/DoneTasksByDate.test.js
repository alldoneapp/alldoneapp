/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import moment from 'moment'

import DoneTasksByDate from '../../../components/TaskListView/DoneTasksView/DoneTasksByDate'

jest.mock('../../../components/TaskListView/Header/DateHeader', () => 'DateHeader')
jest.mock('../../../components/TaskListView/ParentTaskContainer', () => 'ParentTaskContainer')

const projectId = '-LcRVRo6mhbC0oXCcZ2F'
const today = moment().format('YYYYMMDD')
const earlier = '20190802'

const taskList = [
    { id: 'task-1', name: 'First done task' },
    { id: 'task-2', name: 'Second done task' },
]

const renderByDate = (props = {}) =>
    renderer.create(
        <DoneTasksByDate
            projectId={projectId}
            taskList={taskList}
            subtaskByTask={{}}
            dateFormated={today}
            estimation={30}
            {...props}
        />
    )

describe('DoneTasksByDate component', () => {
    it('renders one task container per completed task', () => {
        const tree = renderByDate()

        const containers = tree.root.findAllByType('ParentTaskContainer')
        expect(containers).toHaveLength(2)
        expect(containers[0].props.task).toBe(taskList[0])
        expect(containers[0].props.projectId).toBe(projectId)
    })

    it('marks the section as today and passes the header its totals', () => {
        const tree = renderByDate({ firstDateSection: true })

        const [header] = tree.root.findAllByType('DateHeader')
        expect(header.props.isToday).toBe(true)
        expect(header.props.dateText).toBe('TODAY')
        expect(header.props.amountTasks).toBe(2)
        expect(header.props.estimation).toBe(30)
        expect(header.props.firstDateSection).toBe(true)
    })

    it('formats an earlier day as a plain date', () => {
        const tree = renderByDate({ dateFormated: earlier })

        const [header] = tree.root.findAllByType('DateHeader')
        expect(header.props.isToday).toBe(false)
        expect(header.props.dateText).toBe('2019/08/02')
    })

    it('hands each task its own subtasks', () => {
        const subtasks = [{ id: 'subtask-1' }]
        const tree = renderByDate({ subtaskByTask: { 'task-2': subtasks } })

        const containers = tree.root.findAllByType('ParentTaskContainer')
        expect(containers[0].props.subtaskList).toEqual([])
        expect(containers[1].props.subtaskList).toBe(subtasks)
    })

    it('keeps an empty section for today but drops it for an earlier day', () => {
        expect(renderByDate({ taskList: [] }).toJSON()).not.toBeNull()
        expect(renderByDate({ taskList: [], dateFormated: earlier }).toJSON()).toBeNull()
    })
})
