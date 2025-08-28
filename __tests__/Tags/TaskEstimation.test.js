/**
 * @jest-environment jsdom
 */

import React from 'react'
import TaskEstimation from '../../components/Tags/TaskEstimation'

import renderer from 'react-test-renderer'

describe('Task Estimation Tag component', () => {
    describe('Task Estimation snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(<TaskEstimation projectId={'-Asd'} task={{ id: '-Sda', name: 'My Task' }} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(
                <TaskEstimation projectId={'-Asd'} task={{ id: '-Sda', name: 'My Task' }} />
            )
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Task Estimation check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(
                <TaskEstimation projectId={'-Asd'} task={{ id: '-Sda', name: 'My Task' }} />
            )
            tree.getInstance().componentWillUnmount()
        })
    })
})
