/**
 * @jest-environment jsdom
 */

import React from 'react'
import DueDateSinglePopup from '../../components/UIComponents/DueDateSinglePopup'

import renderer from 'react-test-renderer'

describe('DueDate Single Popup component', () => {
    describe('DueDate Single Popup snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<DueDateSinglePopup />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<DueDateSinglePopup />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function hidePopover snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<DueDateSinglePopup />)
            expect(tree.toJSON()).toMatchSnapshot()
            tree.getInstance().hidePopover()
        })
    })

    describe('Function delayHidePopover snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<DueDateSinglePopup />)
            expect(tree.toJSON()).toMatchSnapshot()
            tree.getInstance().delayHidePopover()
        })
    })

    describe('Function hideCalendar snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<DueDateSinglePopup />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().state.visibleCalendar = true
            tree.getInstance().hideCalendar()

            let state = tree.getInstance().state
            expect(state.visibleCalendar).toBeFalsy()
        })
    })

    describe('Function showCalendar snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(<DueDateSinglePopup />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().state.visibleCalendar = false
            tree.getInstance().showCalendar()

            let state = tree.getInstance().state
            expect(state.visibleCalendar).toBeTruthy()
        })
    })

    describe('Task DueDate check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(<DueDateSinglePopup />)
            tree.getInstance().componentWillUnmount()
        })
    })
})
