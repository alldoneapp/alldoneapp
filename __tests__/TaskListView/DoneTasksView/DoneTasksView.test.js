/**
 * @jest-environment jsdom
 */

import React from 'react'
import DoneTasksView from '../../../components/TaskListView/DoneTasksView/DoneTasksView'
import { DoneTasksViewInput } from '../../../__mocks__/MockData/TasksView/DoneTasksViewInput'

import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { storeCurrentUser, storeLoggedUserProjects } from '../../../redux/actions'

const userId = 'C08CK8x1I5YS2lxVixuLHaF3SrA3'
let loggedUserProjects = [
    { id: '-Asd', name: 'My project', color: '#0055ff' },
    { id: '-Asd2', name: 'My project 2', color: '#0055ff' },
]
let currentUser = { uid: userId, photoURL: 'http://path.to.photo', displayName: 'Chicho' }

describe('DoneTasksView component', () => {
    beforeAll(() => {
        store.dispatch([storeLoggedUserProjects(loggedUserProjects), storeCurrentUser(currentUser)])
    })

    describe('DoneTasksView snapshot test', () => {
        xit('should render correctly', async () => {

            const tree = renderer.create(<DoneTasksView taskList={DoneTasksViewInput} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function componentWillUnmount snapshot test', () => {
        xit('Unmount function should execute correctly', () => {
            const tree = renderer.create(<DoneTasksView taskList={DoneTasksViewInput} />)
            tree.unmount()
        })
    })

    describe('Function updateState snapshot test', () => {
        xit('should execute and render correctly', () => {
            const tree = renderer.create(<DoneTasksView taskList={DoneTasksViewInput} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
