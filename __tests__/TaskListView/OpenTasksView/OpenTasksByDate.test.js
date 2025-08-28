/**
 * @jest-environment jsdom
 */

import React from 'react'
import OpenTasksByDate from '../../../components/TaskListView/OpenTasksView/OpenTasksByDate'
import { OpenTasksViewInput } from '../../../__mocks__/MockData/TasksView/OpenTasksViewInput'
import store from '../../../redux/store'

import renderer from 'react-test-renderer'
import moment from 'moment'
import { setAmountTasksByProjects } from '../../../redux/actions'

let amounts = [{ open: 2, pending: 0, done: 0 }]
const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const date = moment()

describe('OpenTasksByDate component', () => {
    beforeEach(() => {
        store.dispatch(setAmountTasksByProjects(amounts))
    })
    describe('OpenTasksByDate snapshot test', () => {
        it('should render correctly', async () => {
            const tree = renderer.create(
                <OpenTasksByDate
                    projectId={dummyProjectId}
                    projectIndex={0}
                    taskList={OpenTasksViewInput[0]}
                    date={date}
                />
            )
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function filterTasksByDate snapshot test', () => {
        xit('should execute and render correctly', () => {
            const tree = renderer.create(
                <OpenTasksByDate
                    projectId={dummyProjectId}
                    projectIndex={0}
                    taskList={OpenTasksViewInput[0]}
                    date={date}
                />
            )
            expect(tree.toJSON()).toMatchSnapshot()

            const tasks = tree.getInstance().filterTasksByDate(OpenTasksViewInput[0], date, false)
            expect(tasks).toEqual([[],1])
        })
    })

    describe('Function updateProgressBar snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(
                <OpenTasksByDate
                    projectId={dummyProjectId}
                    projectIndex={0}
                    taskList={OpenTasksViewInput[0]}
                    date={date}
                />
            )
            expect(tree.toJSON()).toMatchSnapshot()

            let instance = tree.getInstance()
            // instance.state.amountTasksByProjects = [{ open: 2, pending: 0, done: 0 }]

            instance.updateProgressBar()
            expect(instance.state.progress).toEqual(0)
        })
    })
})
