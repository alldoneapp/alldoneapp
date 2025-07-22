/**
 * @jest-environment jsdom
 */

import React from 'react'
import TaskRecurrence from '../../components/Tags/TaskRecurrence'
import renderer from 'react-test-renderer'

const task = { id: '-Asd', name: 'My task', recurrence: { type: 'never' } }

describe('TaskRecurrence component', () => {
    describe('TaskRecurrence empty snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<TaskRecurrence projectId={'-Asd'} task={task} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<TaskRecurrence projectId={'-Asd'} task={task} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Task Recurrence check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(<TaskRecurrence projectId={'-Asd'} task={task} />)
            tree.getInstance().componentWillUnmount()
        })
    })
})
