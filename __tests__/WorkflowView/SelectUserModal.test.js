/**
 * @jest-environment jsdom
 */

import React from 'react'
import SelectUserModal from '../../components/WorkflowView/SelectUserModal'

import renderer from 'react-test-renderer'
import store from '../../redux/store'
import { storeLoggedUserProjects, setProjectsUsers } from '../../redux/actions'
jest.mock('react-tiny-popover')

describe('SelectUserModal component', () => {
    const projectIndex = '0'
    const currentUser = { uid: '1', displayName: 'asd' }
    const projects = [{ id: '2' }]
    store.dispatch([setProjectsUsers([[{ uid: '0', displayName: 'a' }]]), storeLoggedUserProjects(projects)])

    describe('SelectUserModal snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<SelectUserModal currentUser={currentUser} projectIndex={projectIndex} />)
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('SelectUserModal methods', () => {
        it('updateState correctly updates state', () => {
            const tree = renderer.create(<SelectUserModal currentUser={currentUser} projectIndex={projectIndex} />)
            const instance = tree.getInstance()
            instance.updateState()
            expect(instance.state.projectsUsers).toEqual([[{ uid: '0', displayName: 'a' }]])
            expect(instance.state.loggedUserProjects).toEqual([{ id: '2' }])
            expect(instance.state.loggedUser).toEqual({})
            expect(typeof instance.state.unsubscribe).toEqual('function')
        })

        it('componentWillUnmount correctly unsubscribe from store', () => {
            const tree = renderer.create(<SelectUserModal currentUser={currentUser} projectIndex={projectIndex} />)
            const instance = tree.getInstance()
            const originalFunc = instance.state.unsubscribe.bind(instance)
            instance.state.unsubscribe = jest.fn()
            instance.componentWillUnmount()
            expect(instance.state.unsubscribe.mock.calls.length).toEqual(1)
            originalFunc()
        })
    })
})
