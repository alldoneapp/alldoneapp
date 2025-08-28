import React from 'react'
import Followers from '../../../components/TaskDetailedView/Properties/Followers'

import renderer from 'react-test-renderer'

describe('Followers component', () => {
    describe('Followers snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Followers />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
