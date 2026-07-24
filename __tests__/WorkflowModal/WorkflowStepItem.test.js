import React from 'react'
import WorkflowStepItem from '../../components/WorkflowModal/WorkflowStepItem'

import renderer from 'react-test-renderer'


describe('WorkflowStepItem', () => {
    it('should render correctly', () => {
        const json = renderer.create(<WorkflowStepItem estimations={[0]}
            step={[null, { reviewPhotoURL: '' }]}
        />).toJSON()
        expect(json).toMatchSnapshot()
    })
})
