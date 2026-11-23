import React from 'react'
import { Provider } from 'react-redux'
import store from '../../../redux/store'
import { storeLoggedUser } from '../../../redux/actions'
import UserTasksHeader, { getFormattedName } from '../../../components/TaskListView/Header/UserTasksHeader'

import renderer from 'react-test-renderer'

describe('UserTasksHeader component', () => {
    // These snapshots show the simple sidebar; since AT-3122 a user without a stored mode gets "Anna on top".
    beforeEach(() => store.dispatch(storeLoggedUser({ sidebarNavigationMode: 'simple' })))

    describe('UserTasksHeader empty snapshot test', () => {
        it('should render correctly for basic header', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <UserTasksHeader headerText="Martina Muller" isName={true} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('should render correctly for header with caption', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <UserTasksHeader headerText="Done project task" headerCaption={'5 Open'} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('getFormattedName function test', () => {
        it('should correctly format a given name to display at the tasks view when the name does not end with s', () => {
            const name = getFormattedName('Martina')
            expect(name).toBe(`Martina's tasks`)
        })

        it('should correctly format a given name to display at the tasks view when the name ends with s', () => {
            const name = getFormattedName('Charles')
            expect(name).toBe(`Charles' tasks`)
        })
    })
})
