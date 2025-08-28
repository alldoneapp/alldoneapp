import React from 'react'
import RecurrenceModalItem from '../../../components/TaskDetailedView/Properties/RecurrenceModalItem'

import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { setRecurrence } from '../../../redux/actions'
import Backend from '../../../utils/BackendBridge'

jest.mock('../../../utils/BackendBridge')
jest.mock('firebase', () => ({ firestore: {} }));

describe('RecurrenceModalItem component', () => {
    const task = { id: 'id0', name: 'task1', recurrence: { type: 'never' } }
    const project = { id: 'id0', name: 'Running out of cool names', color: 'the same with colors' }

    describe('RecurrenceModalItem snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <RecurrenceModalItem projectId={project.id} task={task} recurrence={task.recurrence}>
                        Never
                    </RecurrenceModalItem>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('RecurrenceModalItem methods', () => {
        it('should set the new recurrence for the task', () => {
            const tree = renderer.create(
                <RecurrenceModalItem projectId={project.id} task={task} recurrence={task.recurrence}>
                    Never
                </RecurrenceModalItem>
            )
            const instance = tree.getInstance()

            store.dispatch(setRecurrence(task.recurrence))
            instance.onPress()
            expect(Backend.setTaskRecurrence.mock.calls.length).toEqual(1)
            expect(Backend.setTaskRecurrence.mock.calls[0][0]).toEqual(project.id)
            expect(Backend.setTaskRecurrence.mock.calls[0][1]).toEqual(task.id)
            expect(Backend.setTaskRecurrence.mock.calls[0][2]).toEqual(task.recurrence)
            expect(store.getState().recurrence).toEqual(task.recurrence)
            expect(store.getState().showRecurrenceModal.visible).toEqual(false)
        })

        it('should hide the recurrence modal', () => {
            const tree = renderer.create(
                <RecurrenceModalItem projectId={project.id} task={task} recurrence={task.recurrence}>
                    Never
                </RecurrenceModalItem>
            )
            const instance = tree.getInstance()

            store.dispatch(setRecurrence(task.recurrence.type))
            instance.whenDone()
            expect(store.getState().showRecurrenceModal.visible).toEqual(false)
        })

        it('should attempt to animate', () => {
            const tree = renderer.create(
                <RecurrenceModalItem projectId={project.id} task={task} recurrence={task.recurrence}>
                    Never
                </RecurrenceModalItem>
            )
            const instance = tree.getInstance()
            instance.tryAnimate()
            expect(store.getState().showRecurrenceModal.visible).toEqual(false)
        })
    })
})
