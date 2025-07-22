/**
 * @jest-environment jsdom
 */

import React from 'react'
import AddNewStep from '../../components/WorkflowView/AddNewStep'

import renderer from 'react-test-renderer'

describe('AddNewStep component', () => {
    describe('AddNewStep snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<AddNewStep />)
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
