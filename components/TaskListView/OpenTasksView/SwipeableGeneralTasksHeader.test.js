import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet, Text } from 'react-native'

const mockClose = jest.fn()
const mockDispatch = jest.fn()

jest.mock('react-native-gesture-handler/Swipeable', () => {
    const React = require('react')
    return React.forwardRef(({ children, ...props }, ref) => {
        React.useImperativeHandle(ref, () => ({ close: mockClose }))
        return React.createElement('Swipeable', props, children)
    })
})
jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector({ loggedUserProjects: [{ id: 'project-1' }] }),
}))
jest.mock('../../../redux/store', () => ({ dispatch: jest.fn() }))
jest.mock('../../../redux/actions', () => ({
    showSwipeDueDatePopup: jest.fn(() => ({ type: 'SHOW_SWIPE_DUE_DATE_POPUP' })),
    setSwipeDueDatePopupData: jest.fn(data => ({ type: 'SET_SWIPE_DUE_DATE_POPUP_DATA', data })),
    setSelectedNavItem: jest.fn(tab => ({ type: 'SET_SELECTED_NAV_ITEM', tab })),
}))
jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: { navigate: jest.fn() } }))
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../Icon', () => 'Icon')
jest.mock('./GeneralTasksHeader', () => 'GeneralTasksHeader')

import SwipeableGeneralTasksHeader from './SwipeableGeneralTasksHeader'
import GoalsSwipeBackground from '../../GoalsView/GoalsSwipeBackground'
import store from '../../../redux/store'

describe('SwipeableGeneralTasksHeader (AT-2642)', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockClose.mockClear()
        mockDispatch.mockClear()
        store.dispatch.mockClear()
    })

    afterEach(() => jest.useRealTimers())

    const renderRow = () =>
        renderer.create(
            <SwipeableGeneralTasksHeader projectId="project-1" taskList={[{ id: 'task-1', dueDate: 123 }]} />
        ).root

    it('reveals the same full-row reminder background as a goal while keeping Properties on the other side', () => {
        const root = renderRow()
        const background = root.findByType(GoalsSwipeBackground)
        const swipeable = root.findByType('Swipeable')

        // A goal keeps its background behind Swipeable. Rendering it inside the 150px action
        // clips the yellow side to half that width and misplaces the Reminder label.
        expect(swipeable.findAllByType(GoalsSwipeBackground)).toHaveLength(0)
        expect(background.props).toMatchObject({ needToShowReminderButton: true, showPropertiesButton: true })
        expect(root.findByType('GeneralTasksHeader').props.noVerticalMargin).toBe(true)
        expect(background.findAllByType(Text).map(node => node.props.children)).toEqual(['Properties', 'Reminder'])
        expect(StyleSheet.flatten(swipeable.props.renderRightActions().props.style).width).toBe(150)
        expect(StyleSheet.flatten(swipeable.props.renderLeftActions().props.style).width).toBe(150)
    })

    it('still opens the General Tasks reminder picker after a left swipe', () => {
        const root = renderRow()
        const swipeable = root.findByType('Swipeable')

        act(() => swipeable.props.onSwipeableRightWillOpen())
        expect(mockClose).toHaveBeenCalledTimes(1)
        act(() => jest.runOnlyPendingTimers())

        const dispatched = store.dispatch.mock.calls.map(([actions]) => actions).flat()
        expect(dispatched).toContainEqual({ type: 'SHOW_SWIPE_DUE_DATE_POPUP' })
        expect(dispatched).toContainEqual({
            type: 'SET_SWIPE_DUE_DATE_POPUP_DATA',
            data: expect.objectContaining({
                projectId: 'project-1',
                task: { id: 'task-1', dueDate: 123 },
                inParentGoal: true,
                goal: null,
            }),
        })
    })
})
