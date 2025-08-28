/**
 * @jest-environment jsdom
 */

import React from 'react'
import DueDateModal from '../../components/UIComponents/FloatModals/DueDateModal'

import renderer from 'react-test-renderer'
import moment from 'moment'

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const dummyTaskId = '-LcRVT6MEWlqGQRkE2xw'
const task = { id: dummyTaskId, name: 'My task' }

describe('DueDateModal component', () => {
    describe('DueDateModal snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer
                .create(
                    <DueDateModal
                        projectId={dummyProjectId}
                        task={task}
                        closePopover={() => {}}
                        delayClosePopover={() => {}}
                    />
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function toggleCalendar snapshot test', () => {
        it('Should execute and render correctly', () => {
            const tree = renderer.create(
                <DueDateModal
                    projectId={dummyProjectId}
                    task={task}
                    closePopover={() => {}}
                    delayClosePopover={() => {}}
                />
            )

            let instance = tree.getInstance()
            instance.state.visibleCalendar = false
            instance.toggleCalendar()

            let state = instance.state
            expect(state.visibleCalendar).toBeTruthy()
        })
    })

    describe('Function selectDate snapshot test', () => {
        it('Should execute and render correctly', () => {
            const tree = renderer.create(
                <DueDateModal
                    projectId={dummyProjectId}
                    task={task}
                    closePopover={() => {}}
                    delayClosePopover={() => {}}
                />
            )

            tree.getInstance().selectDate(moment())
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function updateState snapshot test', () => {
        it('should execute and render correctly', () => {
            const tree = renderer.create(
                <DueDateModal
                    projectId={dummyProjectId}
                    task={task}
                    closePopover={() => {}}
                    delayClosePopover={() => {}}
                />
            )
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Task DueDate check unmount', () => {
        it('should unmount correctly', () => {
            const tree = renderer.create(
                <DueDateModal
                    projectId={dummyProjectId}
                    task={task}
                    closePopover={() => {}}
                    delayClosePopover={() => {}}
                />
            )
            tree.getInstance().componentWillUnmount()
        })
    })
})
