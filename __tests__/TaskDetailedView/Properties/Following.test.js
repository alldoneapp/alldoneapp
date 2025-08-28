import React from 'react'
import Following from '../../../components/TaskDetailedView/Properties/Following'

import renderer from 'react-test-renderer'

describe('Following component', () => {
    describe('Following snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Following />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
