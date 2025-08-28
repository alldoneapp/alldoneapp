import React from 'react'
import WorkflowStep from '../../components/WorkflowView/WorkflowStep'

import renderer from 'react-test-renderer'
import { Provider } from 'react-redux'
import store from '../../redux/store'

describe('WorkflowStep component', () => {
    const step = { description: 'a', addedBy: 'b', date: Date.now(), reviewerName: 'c', photoURL: 'd' }
    describe('WorkflowStep snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <WorkflowStep stepNumber={1} step={step} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
