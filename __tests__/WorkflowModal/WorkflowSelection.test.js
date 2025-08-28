import React from 'react'
import WorkflowSelection from '../../components/WorkflowModal/WorkflowSelection'

import renderer from 'react-test-renderer'


describe('WorkflowSelection', () => {
    it('should render correctly', () => {
        const json = renderer.create(<WorkflowSelection estimations={[]}
            steps={[]} assignee={{ photoURL: '' }}
        />).toJSON()
        expect(json).toMatchSnapshot()
    })
})
