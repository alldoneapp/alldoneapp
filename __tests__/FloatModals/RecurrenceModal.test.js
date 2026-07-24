/**
 * @jest-environment jsdom
 */

import React from 'react'
import RecurrenceModal from '../../components/UIComponents/FloatModals/RecurrenceModal'

import renderer from 'react-test-renderer'

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const dummyTaskId = '-LcRVT6MEWlqGQRkE2xw'
const task = { id: dummyTaskId, name: 'My task', recurrence: { type: 'never' } }

describe('RecurrenceModal component', () => {
    describe('RecurrenceModal snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer
                .create(<RecurrenceModal projectId={dummyProjectId} task={task} closePopover={() => {}} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function selectRecurrence snapshot test', () => {
        it('Should execute and render correctly', () => {
            const tree = renderer.create(
                <RecurrenceModal projectId={dummyProjectId} task={task} closePopover={() => {}} />
            )

            tree.getInstance().selectRecurrence({ type: 'every2Weeks' })
            setTimeout(() => {
                let state = tree.getInstance().state
                expect(state.recurrence.type).toEqual('every2Weeks')
            }, 10)
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(
                <RecurrenceModal projectId={dummyProjectId} task={task} closePopover={() => {}} />
            )
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Task RecurrenceModal check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(
                <RecurrenceModal projectId={dummyProjectId} task={task} closePopover={() => {}} />
            )
            tree.getInstance().componentWillUnmount()
        })
    })
})
