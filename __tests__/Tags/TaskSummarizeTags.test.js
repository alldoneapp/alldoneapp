/**
 * @jest-environment jsdom
 */

import React from 'react'
import TaskSummarizeTags from '../../components/Tags/TaskSummarizeTags'
import renderer from 'react-test-renderer'

describe('TaskSummarizeTags component', () => {
    describe('TaskSummarizeTags empty snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<TaskSummarizeTags amountTags={0} onPress={() => {}} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<TaskSummarizeTags amountTags={0} onPress={() => {}} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('TaskSummarizeTags check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(<TaskSummarizeTags amountTags={0} onPress={() => {}} />)
            tree.getInstance().componentWillUnmount()
        })
    })
})
