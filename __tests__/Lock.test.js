import React from 'react'
import Lock from '../components/Lock'

import renderer from 'react-test-renderer'

describe('Lock component', () => {
    describe('Lock locked snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Lock isLocked />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Lock unocked snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Lock />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
