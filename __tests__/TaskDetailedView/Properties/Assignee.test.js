/**
 * @jest-environment jsdom
 */

import React from 'react'
import Assignee from '../../../components/TaskDetailedView/Properties/Assignee'
import store from '../../../redux/store'
import { setAssignee } from '../../../redux/actions'

import renderer from 'react-test-renderer'

const dummyTask = { id: '-Asd', title: 'My task', done: false }
const dummyUser = { id: '-Asd1', photoURL: 'http:path.to.photo', displayName: 'Chicho', workflow: [] }

describe('Assignee component', () => {
    const assignee = { displayName: 'Awesomeness Maximus', photoUrl: 'tooAwesomeForIt' }

    describe('Assignee snapshot test', () => {
        it('should render correctly', () => {
            store.dispatch(setAssignee(assignee))
            const tree = renderer.create(<Assignee assignee={assignee} task={dummyTask} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Assignee methods', () => {
        it('should show the assignee picker', () => {
            store.dispatch(setAssignee(assignee))
            const tree = renderer.create(<Assignee assignee={assignee} task={dummyTask} />)
            const instance = tree.getInstance()
            instance.onSelectUser(dummyUser)
            expect(store.getState().assignee).toEqual(dummyUser)
        })

        it('should update state on store updates', () => {
            const tree = renderer.create(<Assignee assignee={assignee} task={dummyTask} />)
            const instance = tree.getInstance()

            instance.updateState()
            expect(instance.state.assignee).toEqual(dummyUser)
        })
    })
})
