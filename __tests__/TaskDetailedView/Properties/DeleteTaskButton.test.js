import React from 'react'
import DeleteTaskButton from '../../../components/TaskDetailedView/Properties/DeleteTaskButton'

import renderer from 'react-test-renderer'

jest.mock('../../../utils/BackendBridge')
jest.mock('../../../utils/NavigationService')
jest.mock('firebase', () => ({ firestore: {} }));

describe('DeleteTaskButton component', () => {
    describe('DeleteTaskButton snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<DeleteTaskButton />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('DeleteTaskButton methods', () => {
        it('should delete a task', () => {
            const tree = renderer.create(<DeleteTaskButton projectId="id0" task={{ id: 'id1' }} />)
            const instance = tree.getInstance()
            instance.onPress()
        })
    })
})
