import React from 'react'
import ProjectLabel from '../components/ProjectLabel'

import renderer from 'react-test-renderer'

describe('ProjectLabel component', () => {
    describe('ProjectLabel snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<ProjectLabel />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
