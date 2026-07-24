/**
 * @jest-environment jsdom
 */

import React from 'react'
import TaskSubTasks from '../../components/Tags/TaskSubTasks'

import renderer from 'react-test-renderer'

describe('Task Sub Tasks tag component', () => {
    describe('Task Estimation snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<TaskSubTasks amountOfSubTasks={0} style={{ marginLeft: 10 }} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('should render correctly for amount 1', () => {
            const tree = renderer.create(<TaskSubTasks amountOfSubTasks={1} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('should render correctly for amount 2', () => {
            const tree = renderer.create(<TaskSubTasks amountOfSubTasks={2} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<TaskSubTasks amountOfSubTasks={1} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Task Sub Tasks tag check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(<TaskSubTasks amountOfSubTasks={2} />)
            tree.getInstance().componentWillUnmount()
        })
    })
})
