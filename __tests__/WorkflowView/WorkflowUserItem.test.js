import React from 'react'
import WorkflowUserItem from '../../components/WorkflowView/WorkflowUserItem'

import renderer from 'react-test-renderer'

jest.mock('../../utils/BackendBridge')
jest.mock('firebase', () => ({ firestore: {} }))

describe('WorkflowUserItem component', () => {
    const user = { uid: '0', displayName: 'asd', photoURL: 'a' }
    describe('WorkflowUserItem snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<WorkflowUserItem user={user} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
