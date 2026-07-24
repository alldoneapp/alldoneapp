/**
 * @jest-environment jsdom
 */

import React from 'react'
import OpenTasksView from '../../../components/TaskListView/OpenTasksView/OpenTasksView'
import { OpenTasksViewInput } from '../../../__mocks__/MockData/TasksView/OpenTasksViewInput'

import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { setAmountTasksByProjects, storeCurrentUser, storeLoggedUserProjects } from '../../../redux/actions'
import { DefaultAmountTasks } from '../../../__mocks__/MockData/TasksView/DefaultAmountTasks'

const userId = 'C08CK8x1I5YS2lxVixuLHaF3SrA3'
let loggedUserProjects = [
    { id: '-Asd', name: 'My project', color: '#0055ff' },
    { id: '-Asd2', name: 'My project 2', color: '#0055ff' },
]
let currentUser = { uid: userId, photoURL: 'http:path.to.photo', displayName: 'Chicho' }

describe('OpenTasksView component', () => {
    beforeEach(() => {
        store.dispatch([
            storeLoggedUserProjects(loggedUserProjects),
            storeCurrentUser(currentUser),
            store.dispatch(setAmountTasksByProjects(DefaultAmountTasks)),
        ])
    })

    describe('OpenTasksView snapshot test', () => {
        xit('should render correctly', async () => {
            const tree = renderer.create(<OpenTasksView taskList={OpenTasksViewInput} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function componentWillUnmount snapshot test', () => {
        xit('Unmount function should execute correctly', () => {
            const tree = renderer.create(<OpenTasksView taskList={OpenTasksViewInput} />)
            tree.unmount()
        })
    })

    describe('Function updateState snapshot test', () => {
        xit('should execute and render correctly', () => {
            const tree = renderer.create(<OpenTasksView taskList={OpenTasksViewInput} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
