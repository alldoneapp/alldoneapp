import React from 'react'
import WorkflowHeader from '../../components/WorkflowView/WorkflowHeader'

import renderer from 'react-test-renderer'

describe('WorkflowHeader component', () => {
    it('should render correctly when there is one step', () => {
        const tree = renderer.create(<WorkflowHeader stepsAmount={1} />)
        const json = tree.toJSON()
        const actualText = json.children[1].children[0].children[0]
        expect(actualText).toEqual('1 step')
        expect(json).toMatchSnapshot()
    })

    it('should render correctly when there are two steps', () => {
        const tree = renderer.create(<WorkflowHeader stepsAmount={2} />)
        const json = tree.toJSON()
        const actualText = json.children[1].children[0].children[0]
        expect(actualText).toEqual('2 steps')
        expect(json).toMatchSnapshot()
    })

    it('should render correctly when there are no steps', () => {
        const tree = renderer.create(<WorkflowHeader stepsAmount={0} />)
        const json = tree.toJSON()
        const actualText = json.children[1].children[0].children[0]
        expect(actualText).toEqual('No steps yet')
        expect(json).toMatchSnapshot()
    })
})