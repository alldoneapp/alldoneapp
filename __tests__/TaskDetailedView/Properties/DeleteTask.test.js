import React from 'react'
import DeleteTask from '../../../components/TaskDetailedView/Properties/DeleteTask'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('DeleteTask component', () => {
    describe('DeleteTask snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<DeleteTask />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
