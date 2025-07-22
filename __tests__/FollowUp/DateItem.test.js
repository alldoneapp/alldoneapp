import React from 'react'
import DateItem from '../../components/FollowUp/DateItem'
import renderer from 'react-test-renderer'

describe('DateItem component', () => {
    describe('DateItem snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<DateItem onPress={() => {}} selected={true} children="Today" />).toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly', () => {
            const tree = renderer
                .create(<DateItem onPress={() => {}} selected={false} children="Custom date" />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
