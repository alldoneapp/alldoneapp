import React from 'react'
import LoadingScreen from '../components/LoadingScreen'

import renderer from 'react-test-renderer'

describe('LoadingScreen component', () => {
    describe('LoadingScreen snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<LoadingScreen />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
