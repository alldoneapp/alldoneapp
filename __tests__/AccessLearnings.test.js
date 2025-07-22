import React from 'react'
import AccessLearnings from '../components/AccessLearnings'

import renderer from 'react-test-renderer'

describe('AccessLearning component', () => {
    describe('AccessLearning snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<AccessLearnings />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
