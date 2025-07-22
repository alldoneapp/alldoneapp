import React from 'react'
import CloseButton from '../../components/FollowUp/CloseButton'
import renderer from 'react-test-renderer'

describe('CloseButton component', () => {
    describe('CloseButton snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<CloseButton close={() => {}} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
