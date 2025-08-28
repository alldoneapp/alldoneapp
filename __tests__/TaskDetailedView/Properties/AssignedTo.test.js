import React from 'react'
import AssignedTo from '../../../components/TaskDetailedView/Properties/AssignedTo'

import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { setAssignee } from '../../../redux/actions'

jest.mock('firebase', () => ({ firestore: {} }));

describe('AssignedTo component', () => {
    describe('AssignedTo snapshot test', () => {
        xit('should render correctly', () => {
            const assignee = { displayName: 'Awesomeness Maximus', photoUrl: 'tooAwesomeForIt' }
            store.dispatch(setAssignee(assignee))

            const json = renderer
                .create(<AssignedTo/>)
                .toJSON()
            expect(json).toMatchSnapshot()
        })
    })
})
