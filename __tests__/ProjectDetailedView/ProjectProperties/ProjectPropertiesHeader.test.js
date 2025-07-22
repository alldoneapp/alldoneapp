/**
 * @jest-environment jsdom
 */

import React from 'react'
import ProjectPropertiesHeader from '../../../components/ProjectDetailedView/ProjectProperties/ProjectPropertiesHeader'
import renderer from 'react-test-renderer'

describe('ProjectPropertiesHeader component', () => {
    describe('ProjectPropertiesHeader snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<ProjectPropertiesHeader />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
