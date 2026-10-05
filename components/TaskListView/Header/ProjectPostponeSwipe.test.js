import React from 'react'
import renderer, { act } from 'react-test-renderer'
import ProjectPostponeSwipe from './ProjectPostponeSwipe'
import store from '../../../redux/store'

const mockClose = jest.fn()
jest.mock('react-native-gesture-handler/Swipeable', () => {
    const React = require('react')
    return React.forwardRef(({ children, ...props }, ref) => {
        React.useImperativeHandle(ref, () => ({ close: mockClose }))
        return React.createElement('Swipeable', props, children)
    })
})
jest.mock('../../../redux/store', () => ({ dispatch: jest.fn() }))
jest.mock('../../../redux/actions', () => ({
    showSwipeDueDatePopup: () => ({ type: 'SHOW' }),
    setSwipeDueDatePopupData: data => ({ type: 'DATA', data }),
}))
jest.mock('../../GoalsView/GoalsSwipeBackground', () => 'GoalsSwipeBackground')
jest.mock('../../../hooks/useProjectPostponePreview', () => () => undefined)

beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
})
afterEach(() => jest.useRealTimers())

it('opens the project date picker after swiping left without sending a partial client task list', () => {
    const tree = renderer.create(
        <ProjectPostponeSwipe projectId="p1">
            <span>Project</span>
        </ProjectPostponeSwipe>
    )
    const swipe = tree.root.findByType('Swipeable')
    expect(swipe.props.renderLeftActions).toBeUndefined()
    act(() => swipe.props.onSwipeableRightWillOpen())
    expect(mockClose).toHaveBeenCalledTimes(1)
    act(() => jest.runOnlyPendingTimers())
    expect(store.dispatch).toHaveBeenCalledWith([
        { type: 'SHOW' },
        { type: 'DATA', data: { projectId: 'p1', isProjectPostpone: true } },
    ])
    tree.unmount()
})

it('blocks the trailing navigation click for inverted swipe-close callbacks and then allows clicks again', () => {
    const tree = renderer.create(
        <ProjectPostponeSwipe projectId="p1">
            <span>Project</span>
        </ProjectPostponeSwipe>
    )
    const swipe = tree.root.findByType('Swipeable')
    const capture = tree.root.findAll(n => typeof n.props.onClickCapture === 'function')[0].props.onClickCapture
    act(() => {
        swipe.props.onSwipeableClose()
        swipe.props.onSwipeableWillClose()
        swipe.props.onSwipeableWillOpen()
    })
    const event = { preventDefault: jest.fn(), stopPropagation: jest.fn() }
    capture(event)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    act(() => jest.runOnlyPendingTimers())
    capture(event)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    tree.unmount()
})

it('does not open a popup after navigation unmounts the row', () => {
    const tree = renderer.create(
        <ProjectPostponeSwipe projectId="p1">
            <span>Project</span>
        </ProjectPostponeSwipe>
    )
    act(() => {
        tree.root.findByType('Swipeable').props.onSwipeableRightWillOpen()
        tree.unmount()
    })
    act(() => jest.runOnlyPendingTimers())
    expect(store.dispatch).not.toHaveBeenCalled()
})
