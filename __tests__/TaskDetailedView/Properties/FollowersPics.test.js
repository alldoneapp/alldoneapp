import React from 'react'
import FollowersPics from '../../../components/TaskDetailedView/Properties/FollowersPics'

import renderer from 'react-test-renderer'

describe('FollowersPics component', () => {
    describe('FollowersPics snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<FollowersPics />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
