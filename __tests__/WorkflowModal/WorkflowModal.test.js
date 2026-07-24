import React from 'react'
import WorkflowModal from '../../components/WorkflowModal/WorkflowModal'
import { setProjectsUsers } from '../../redux/actions'
import store from '../../redux/store'

import renderer from 'react-test-renderer'


describe('WorkflowModal', () => {
    it('should render correctly', () => {
        store.dispatch(
            setProjectsUsers([[{ uid: 0, displayName: 'pepitp' }]])
        )
        const json = renderer.create(<WorkflowModal task={{ userIds: [0] }} />).toJSON()
        expect(json).toMatchSnapshot()
    })
})
