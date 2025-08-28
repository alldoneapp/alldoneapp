import React from 'react'
import TaskTitle from '../../../components/TaskDetailedView/Header/TaskTitle'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('TaskTitle component', () => {
    describe('TaskTitle snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<TaskTitle hashtags={['asd', 'dsa']} task={{linkBack: []}} title="dsa"></TaskTitle>).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
