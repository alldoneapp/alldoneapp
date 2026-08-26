/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import TimeTagWrapper from './TimeTagWrapper'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))
jest.mock('../../redux/actions', () => ({
    showFloatPopup: () => ({ type: 'Show float popup' }),
    hideFloatPopup: () => ({ type: 'Hide float popup' }),
}))
jest.mock('../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    return props => React.createElement('AppPopover', props, props.children, props.content)
})
jest.mock('../UIComponents/FloatModals/EstimationModal/EstimationModal', () => 'EstimationModal')
jest.mock('./TimeTag', () => 'TimeTag')
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskAutoEstimation: jest.fn(),
    setTaskEstimations: jest.fn(),
}))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ getTaskAutoEstimation: () => null }))

describe('TimeTagWrapper popup lock', () => {
    let dispatch
    let tree

    beforeEach(() => {
        jest.useFakeTimers()
        jest.clearAllMocks()
        dispatch = jest.fn()
        useDispatch.mockReturnValue(dispatch)
        useSelector.mockImplementation(selector => selector({ smallScreen: false }))
        act(() => {
            tree = renderer.create(
                <TimeTagWrapper
                    projectId="project-1"
                    task={{
                        id: 'task-1',
                        stepHistory: ['open'],
                        time: 30,
                        estimations: { open: 30 },
                        autoEstimation: null,
                        isSubtask: false,
                        calendarData: null,
                    }}
                />
            )
        })
    })

    afterEach(() => {
        if (tree) {
            act(() => tree.unmount())
            tree = null
        }
        jest.runOnlyPendingTimers()
        jest.useRealTimers()
    })

    it('acquires once for repeated presses and releases when its task row unmounts', () => {
        const timeTag = tree.root.findByType('TimeTag')

        act(() => {
            timeTag.props.onPress()
            timeTag.props.onPress()
        })

        expect(dispatch.mock.calls.filter(([action]) => action.type === 'Show float popup')).toHaveLength(1)

        act(() => {
            tree.unmount()
            tree = null
        })

        expect(dispatch.mock.calls.filter(([action]) => action.type === 'Hide float popup')).toHaveLength(1)
    })

    it('releases exactly once after outside dismissal', () => {
        act(() => {
            tree.root.findByType('TimeTag').props.onPress()
            jest.runOnlyPendingTimers()
        })

        act(() => tree.root.findByType('AppPopover').props.onClickOutside())

        expect(dispatch.mock.calls.filter(([action]) => action.type === 'Show float popup')).toHaveLength(1)
        expect(dispatch.mock.calls.filter(([action]) => action.type === 'Hide float popup')).toHaveLength(1)
    })
})
