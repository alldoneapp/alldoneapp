import React from 'react'
import Hashtag from '../../../components/TaskDetailedView/Header/Hashtag'

import renderer from 'react-test-renderer'

describe('Hashtag component', () => {
    describe('Hashtag snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Hashtag>TESTING HASHTAG</Hashtag>).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
