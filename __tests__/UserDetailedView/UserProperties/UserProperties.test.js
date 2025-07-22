/**
 * @jest-environment jsdom
 */

import React from 'react'
import UserProperties from '../../../components/UserDetailedView/UserProperties/UserProperties'

import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { storeLoggedUserProjects, setProjectsUsers } from '../../../redux/actions'

describe('UserProperties component', () => {
    beforeEach(() => {
        store.dispatch([
            storeLoggedUserProjects([{ usersData: {} }]),
            setProjectsUsers([[{}]])
        ])
    })
    it('should render correctly', () => {
        const tree = renderer.create(<UserProperties projectIndex={0} user={{}} />).toJSON()
        expect(tree).toMatchSnapshot()
    })

    it('should unmount correctly', () => {
        // Given
        const tree = renderer.create(<UserProperties projectIndex={0} user={{}} />)
        const instance = tree.getInstance()
        const mockFn = jest.fn()
        instance.state.unsubscribe = mockFn
        // When
        tree.unmount()
        // Then
        expect(instance.state.unsubscribe).toBeCalledTimes(1)
    })

    it('should set False to showRoleModal after call hideRoleModal', () => {
        // Given
        const tree = renderer.create(<UserProperties projectIndex={0} user={{}} />)
        const instance = tree.getInstance()
        instance.state.showRoleModal = true
        // When
        instance.hideModal('showRoleModal')
        // Then
        expect(instance.state.showRoleModal).toEqual(false)
    })

    it('should call the dispatch after delete a user', () => {
        // Given
        const tree = renderer.create(<UserProperties projectIndex={0} user={{}} />)
        const instance = tree.getInstance()
        const mockFn = jest.fn()
        store.dispatch = mockFn
        // When
        instance.deleteUser()
        // Then
        expect(store.dispatch).toBeCalledTimes(1)
    })
})
