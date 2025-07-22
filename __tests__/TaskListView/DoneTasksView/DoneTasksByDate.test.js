/**
 * @jest-environment jsdom
 */

import React from 'react'
import DoneTasksByDate from '../../../components/TaskListView/DoneTasksView/DoneTasksByDate'
import { DoneTasksViewInput } from '../../../__mocks__/MockData/TasksView/DoneTasksViewInput'

import renderer from 'react-test-renderer'
import moment from 'moment'

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const date = moment(1564735497020)

describe('DoneTasksByDate component', () => {
    describe('DoneTasksByDate snapshot test', () => {
        it('should render correctly', async () => {
            const tree = renderer.create(
                <DoneTasksByDate projectId={dummyProjectId} taskList={DoneTasksViewInput[0]} date={date} />
            )
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function filterTasksByDate snapshot test', () => {
        xit('should execute and render correctly', () => {
            const tree = renderer.create(
                <DoneTasksByDate projectId={dummyProjectId} taskList={DoneTasksViewInput[0]} date={date} />
            )
            expect(tree.toJSON()).toMatchSnapshot()

            const tasks = tree.getInstance().filterTasksByDate(DoneTasksViewInput[0], date, false)
            expect(tasks).toEqual(DoneTasksViewInput[0])
        })
    })
})
