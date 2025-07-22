/**
 * @jest-environment jsdom
 */

import React from 'react'
import EditMember from '../../../components/ProjectDetailedView/ProjectMembers/EditMember'
import renderer from 'react-test-renderer'

describe('EditMember component', () => {
    describe('EditMember snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<EditMember />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
