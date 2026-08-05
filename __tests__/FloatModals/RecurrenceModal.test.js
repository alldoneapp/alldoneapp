/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'

import RecurrenceModal from '../../components/UIComponents/FloatModals/RecurrenceModal'
import store from '../../redux/store'

// Selecting a recurrence really persists now that RNW events execute - keep the
// firestore write (which needs the uninitialized `db`) out of the test.
jest.mock('../../utils/backends/Tasks/tasksFirestore', () =>
    Object.assign(Object.create(jest.requireActual('../../utils/backends/Tasks/tasksFirestore')), {
        setTaskRecurrence: jest.fn(),
    })
)

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const dummyTaskId = '-LcRVT6MEWlqGQRkE2xw'
const task = { id: dummyTaskId, name: 'My task', recurrence: { type: 'never' } }

// The class is wrapped in withWindowSizeHook and not exported on its own, so
// tree.getInstance() reaches the wrapper rather than the modal. The options are
// exercised through the rendered rows instead.
const render = (props = {}) =>
    renderer.create(
        <Provider store={store}>
            <RecurrenceModal projectId={dummyProjectId} task={task} closePopover={() => {}} {...props} />
        </Provider>
    )

describe('RecurrenceModal component', () => {
    it('Should render correctly', () => {
        expect(render().toJSON()).toMatchSnapshot()
    })

    it('offers the recurrence options as pressable rows', () => {
        const tree = render()

        const pressables = tree.root.findAll(node => typeof node.props.onPress === 'function')

        expect(pressables.length).toBeGreaterThan(0)
    })

    it('selects a recurrence without throwing', () => {
        const tree = render()
        const pressables = tree.root.findAll(node => typeof node.props.onPress === 'function')

        expect(() =>
            renderer.act(() => {
                pressables[0].props.onPress()
            })
        ).not.toThrow()
    })

    it('should unmount correctly', () => {
        const tree = render()

        expect(() => tree.unmount()).not.toThrow()
    })
})
