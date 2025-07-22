/**
 * @jest-environment jsdom
 */

import React from 'react'
import USerDetailedView from '../../components/UserDetailedView/UserDetailedView'
import store from '../../redux/store'
import { setSelectedNavItem, storeLoggedUserProjects } from '../../redux/actions'

import renderer from 'react-test-renderer'
import { DV_TAB_USER_STATISTICS } from '../../utils/TabNavigationConstants'

describe('USerDetailedView component', () => {
    describe('USerDetailedView snapshot test', () => {
        const navigation = {
            getParam: param => {
                switch (param) {
                    case 'contact':
                        return { displayName: 'a b' }
                    case 'projectIndex':
                        return 0
                    default:
                        return {}
                }
            },
        }
        const projects = [{ name: 'Build a Stairway To Heaven', id: '0', usersData: {} }]

        it('should render correctly', () => {
            store.dispatch([storeLoggedUserProjects(projects), setSelectedNavItem(DV_TAB_USER_STATISTICS)])
            const tree = renderer.create(<USerDetailedView navigation={navigation} />).toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should unmount correctly', () => {
            store.dispatch([storeLoggedUserProjects(projects), setSelectedNavItem(DV_TAB_USER_STATISTICS)])
            const component = renderer.create(<USerDetailedView navigation={navigation} />)
            component.unmount()
        })

        it('should render the statistics view', () => {
            store.dispatch([storeLoggedUserProjects(projects), setSelectedNavItem(DV_TAB_USER_STATISTICS)])
            const component = renderer.create(<USerDetailedView navigation={navigation} />)
            expect(component.toJSON()).toMatchSnapshot()
        })

        it('should render the Posts view', () => {
            store.dispatch(setSelectedNavItem('Posts'))
            const component = renderer.create(<USerDetailedView navigation={navigation} />)
            expect(component.toJSON()).toMatchSnapshot()
        })
    })
})
