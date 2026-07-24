import React from 'react'
import Indicator from '../../../components/TaskDetailedView/Header/Indicator'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('Indicator component', () => {
    describe('Indicator snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Indicator />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
