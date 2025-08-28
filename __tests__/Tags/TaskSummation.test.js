/**
 * @jest-environment jsdom
 */

import React from 'react'
import TaskSummation from '../../components/Tags/TaskSummation'

import renderer from 'react-test-renderer'

describe('Task Summation Estimation tag component', () => {
    describe('Task Summation snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<TaskSummation estimation={0} style={{ marginLeft: 10 }} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('should render correctly for amount 1', () => {
            const tree = renderer.create(<TaskSummation estimation={1} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('should render correctly for amount 2', () => {
            const tree = renderer.create(<TaskSummation estimation={2} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<TaskSummation estimation={1} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Task Sub Tasks tag check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(<TaskSummation estimation={2} />)
            tree.getInstance().componentWillUnmount()
        })
    })
})
