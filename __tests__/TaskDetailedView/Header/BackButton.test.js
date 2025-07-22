import React from 'react'
import BackButton from '../../../components/TaskDetailedView/Header/BackButton'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('BackButton component', () => {
    describe('BackButton snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<BackButton />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
