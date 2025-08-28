/**
 * @jest-environment jsdom
 */

import React from 'react'
import RecurrenceButton from '../../components/UIControls/RecurrenceButton'
import renderer from 'react-test-renderer'

const task = { id: '-Sda', name: 'My task', recurrence: { type: 'never' } }

describe('Task Recurrence Button component', () => {
    describe('Task Estimation Button snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<RecurrenceButton projectId={'-Asd'} task={task} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<RecurrenceButton projectId={'-Asd'} task={task} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function hidePopover snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<RecurrenceButton projectId={'-Asd'} task={task} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().state.visiblePopover = true
            tree.getInstance().hidePopover()

            let state = tree.getInstance().state
            expect(state.visiblePopover).toBeFalsy()
        })
    })

    describe('Task Recurrence check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(<RecurrenceButton projectId={'-Asd'} task={task} />)
            tree.getInstance().componentWillUnmount()
        })
    })
})
