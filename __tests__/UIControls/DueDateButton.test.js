/**
 * @jest-environment jsdom
 */

import React from 'react'
import DueDateButton from '../../components/UIControls/DueDateButton'

import renderer from 'react-test-renderer'

describe('Task DueDate Button component', () => {
    describe('Task DueDate Button snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(<DueDateButton projectId={'-Asd'} task={{ id: '-Sda', name: 'My Task' }} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(
                <DueDateButton projectId={'-Asd'} task={{ id: '-Sda', name: 'My Task' }} />
            )
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function hidePopover snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(
                <DueDateButton projectId={'-Asd'} task={{ id: '-Sda', name: 'My Task' }} />
            )
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().state.visiblePopover = true
            tree.getInstance().hidePopover()
        })
    })

    describe('Function delayHidePopover snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(
                <DueDateButton projectId={'-Asd'} task={{ id: '-Sda', name: 'My Task' }} />
            )
            expect(tree.toJSON()).toMatchSnapshot()
            tree.getInstance().delayHidePopover()
        })
    })

    describe('Task DueDate check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(
                <DueDateButton projectId={'-Asd'} task={{ id: '-Sda', name: 'My Task' }} />
            )
            tree.getInstance().componentWillUnmount()
        })
    })
})
