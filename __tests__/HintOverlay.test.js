import React from 'react'
import HintOverlay from '../components/NavigationBar/HintOverlay'

import renderer from 'react-test-renderer'

describe('HintOverlay component', () => {
    describe('HintOverlay snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<HintOverlay />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
