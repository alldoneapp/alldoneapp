import React from 'react'
import FilterBy from '../../../components/TaskDetailedView/CommentsView/FilterBy'

import renderer from 'react-test-renderer'

describe('FilterBy component', () => {
    describe('FilterBy snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<FilterBy />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
