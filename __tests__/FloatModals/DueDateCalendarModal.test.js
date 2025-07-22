import React from 'react'
import DueDateCalendarModal from '../../components/UIComponents/FloatModals/DueDateCalendarModal'

import renderer from 'react-test-renderer'
import moment from 'moment'

jest.mock('firebase', () => ({ firestore: {} }));

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const dummyTaskId = '-LcRVT6MEWlqGQRkE2xw'
const task = { id: dummyTaskId, name: 'My task' }

describe('DueDateCalendarModal component', () => {
    describe('DueDateCalendarModal snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer
                .create(<DueDateCalendarModal projectId={dummyProjectId} task={task} closePopover={() => {}} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function selectDate snapshot test', () => {
        xit('Should execute and render correctly', () => {
            const tree = renderer.create(
                <DueDateCalendarModal projectId={dummyProjectId} task={task} closePopover={() => {}} />
            )

            tree.getInstance().selectDate(moment())
            expect(tree.toJSON()).toMatchSnapshot()

            let state = tree.getInstance().state
            expect(state.currentDueDate).toEqual(moment().add(1, 'day').valueOf())
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(
                <DueDateCalendarModal projectId={dummyProjectId} task={task} closePopover={() => {}} />
            )
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Task DueDate check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(
                <DueDateCalendarModal projectId={dummyProjectId} task={task} closePopover={() => {}} />
            )
            tree.getInstance().componentWillUnmount()
        })
    })
})
