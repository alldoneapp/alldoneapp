/**
 * @jest-environment jsdom
 */

import React from 'react'
import PropertiesView from '../../../components/TaskDetailedView/Properties/PropertiesView'
import store from '../../../redux/store'
import { storeLoggedUserProjects, setAssignee, storeCurrentUser } from '../../../redux/actions'

import renderer from 'react-test-renderer'

describe('PropertiesView component', () => {
    const navigation = {
        getParam: (prop, fallback) => {
            return {}
        },
    }
    const task = { id: 'id1', name: 'task1', recurrence: { type: 'never' } }
    store.dispatch(storeLoggedUserProjects([{ id: 'id0', color: 'white' }]))

    describe('PropertiesView snapshot test', () => {
        xit('should render correctly', () => {
            const assignee = { displayName: 'Awesomeness Maximus', photoUrl: 'tooAwesomeForIt' }
            store.dispatch(setAssignee(assignee))
            store.dispatch(storeCurrentUser({ workflow: [] }))

            const tree = renderer.create(<PropertiesView projectId="0" task={task} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('PropertiesView methods', () => {
        xit('should set the creator in the state', () => {
            const tree = renderer.create(<PropertiesView navigation={navigation} projectId="id0" task={task} />)
            const instance = tree.getInstance()
            const test = {
                name: 'John Horton Conway',
                desc: `Your game of life made me believe the universe is indeed a computable entity since I was 15 years old. Thank you`,
            }
            instance.afterCreatorFetch(test)
            expect(instance.state.creator).toEqual(test)
        })
    })
})
