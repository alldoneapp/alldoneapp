import React from 'react'
import UserItem from '../../components/SidebarMenu/UserItem'
import store from '../../redux/store'
import { storeLoggedUserProjects, switchProject, setNavigationRoute } from '../../redux/actions'

import renderer from 'react-test-renderer'
jest.mock('../../utils/NavigationService')

const navigationMock = {
    closeDrawer: () => {},
}

describe('UserItem component', () => {
    const user = { uid: '1', photoURL: 'https://dummy.com/dummy.png', displayName: 'John' }

    describe('UserItem snapshot test', () => {
        it('should render correctly', () => {
            const user = {
                uid: '1',
                displayName: 'Jhon Doe',
                photoURL: 'https://dummy.com/dummy.png',
            }
            const userItem = new UserItem({ user: user })

            const tree = renderer
                .create(<userItem user={userItem} tasksAmount={10} navigation={navigationMock} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('test component methods call', () => {
        it('after call componentWillUnmount should render correctly', () => {
            const tree = renderer.create(<UserItem user={user} navigation={navigationMock} />)
            const instance = tree.getInstance()
            instance.componentWillUnmount()
        })

        it('after call updateState should render correctly', () => {
            const tree = renderer.create(<UserItem user={user} navigation={navigationMock} />)
            const instance = tree.getInstance()
            instance.updateState()
        })

        xit('should correctly handle navigation with browsing history', () => {
            const user = {
                uid: '1',
                displayName: 'Jhon Doe',
                photoURL: 'https://dummy.com/dummy.png',
            }
            const tree = renderer.create(<UserItem user={user} navigation={navigationMock} />)
            const instance = tree.getInstance()
            window.location = { pathname: '/down/the/rabbithole/with/alice', origin: 'https://wonderland.com' }
            window.hist = []
            history = {
                pushState: (state, title, url) => {
                    window.hist.push({ state: state, title: title, url: url })
                },
            }
            store.dispatch(setNavigationRoute('The Palace'))
            store.dispatch(switchProject(0))
            store.dispatch(storeLoggedUserProjects([{ name: 'Alice in Wonderland', id: '0' }]))
            instance.onPress()
            expect(window.hist[0]).toEqual({
                state: { projectId: '0', userId: user.uid },
                title: '',
                url: 'https://wonderland.com/down/1/rabbithole/with/alice',
            })
        })
    })
})
