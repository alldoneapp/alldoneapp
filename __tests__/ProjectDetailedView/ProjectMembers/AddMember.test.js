/**
 * @jest-environment jsdom
 */

import React from 'react'
import AddMember from '../../../components/ProjectDetailedView/ProjectMembers/AddMember'
import renderer from 'react-test-renderer'

describe('AddMember component', () => {
    describe('AddMember snapshot test', () => {
        it('should render correctly', () => {
            const json = renderer.create(<AddMember />).toJSON()
            expect(json).toMatchSnapshot()
        })
    })
})
