import React from 'react'
import Footer from '../../components/FollowUp/Footer'
import renderer from 'react-test-renderer'

describe('Footer component', () => {
    describe('Footer snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Footer text="some text" onPress={() => {}} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
