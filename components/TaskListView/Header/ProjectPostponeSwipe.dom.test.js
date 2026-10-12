import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Text, TouchableOpacity } from 'react-native'
import { Provider, useSelector } from 'react-redux'
import ProjectPostponeSwipe from './ProjectPostponeSwipe'
import GlobalModalsContainerRootView from '../../UIComponents/GlobalModalsContainerRootView'
import store from '../../../redux/store'
import { setSelectedSidebarTab } from '../../../redux/actions'

jest.mock('../../../redux/store', () => {
    const { createStore } = require('redux')
    const { reduxBatch } = require('@manaflair/redux-batch')
    return {
        __esModule: true,
        default: createStore(
            (
                state = {
                    selectedSidebarTab: 'Tasks',
                    showSwipeDueDatePopup: { visible: false, data: null },
                },
                action
            ) => {
                if (action.type === 'RESET')
                    return { selectedSidebarTab: 'Tasks', showSwipeDueDatePopup: { visible: false, data: null } }
                if (action.type === 'Show swipe due date popup')
                    return { ...state, showSwipeDueDatePopup: { ...state.showSwipeDueDatePopup, visible: true } }
                if (action.type === 'Set swipe due date data')
                    return { ...state, showSwipeDueDatePopup: { ...state.showSwipeDueDatePopup, data: action.data } }
                if (action.type === 'Hide swipe due date popup')
                    return { ...state, showSwipeDueDatePopup: { ...state.showSwipeDueDatePopup, visible: false } }
                if (action.type === 'Set selected sidebar tab') return { ...state, selectedSidebarTab: action.tab }
                return state
            },
            reduxBatch
        ),
    }
})
jest.mock('react-native-gesture-handler/Swipeable', () => {
    const React = require('react')
    // Model the real synchronous close ordering, but send release and click
    // through the DOM and RNW Touchable rather than calling the capture prop.
    return React.forwardRef(({ children, ...props }, ref) => {
        React.useImperativeHandle(ref, () => ({
            close: () => {
                props.onSwipeableClose()
                props.onSwipeableWillClose()
            },
        }))
        const release = () => {
            props.onSwipeableRightWillOpen()
            props.onSwipeableWillOpen()
        }
        return (
            <div onMouseUp={release} onTouchEnd={release}>
                {children}
            </div>
        )
    })
})
jest.mock('../../../hooks/useProjectPostponePreview', () => () => undefined)
jest.mock('../../GoalsView/GoalsSwipeBackground', () => () => null)
jest.mock('../../UIComponents/ProjectDontExistInInvitationModal', () => () => null)
jest.mock('../../UIComponents/DueDateSinglePopup', () => () => <div role="dialog">Postpone</div>)

function List() {
    const tab = useSelector(state => state.selectedSidebarTab)
    return (
        <>
            {tab === 'Tasks' ? (
                <ProjectPostponeSwipe projectId="p1">
                    <TouchableOpacity
                        accessibilityRole="button"
                        onPress={() => store.dispatch(setSelectedSidebarTab('Goals'))}
                    >
                        <Text>Milestone</Text>
                    </TouchableOpacity>
                </ProjectPostponeSwipe>
            ) : (
                <div>Goals page</div>
            )}
            <GlobalModalsContainerRootView />
        </>
    )
}
beforeEach(() => {
    jest.useFakeTimers()
    store.dispatch({ type: 'RESET' })
})
afterEach(() => jest.useRealTimers())

it.each(['mouseUp', 'touchEnd'])(
    'mounts the global popup without navigation after %s and a synthesized click',
    release => {
        render(
            <Provider store={store}>
                <List />
            </Provider>
        )
        const row = screen.getByRole('button')
        if (release === 'touchEnd') {
            const touch = { identifier: 1, target: row, pageX: 300, pageY: 100 }
            fireEvent.touchStart(row, { touches: [touch], changedTouches: [touch] })
            fireEvent.touchEnd(row, { touches: [], changedTouches: [touch] })
        } else {
            fireEvent.pointerDown(row, { pointerType: 'mouse' })
            fireEvent.mouseDown(row)
            fireEvent.pointerUp(row, { pointerType: 'mouse' })
            fireEvent.mouseUp(row)
        }
        // The trailing click must be caught on the actual DOM ancestor. RNW View
        // silently drops onClickCapture; reading and calling that prop hides it.
        fireEvent.click(row)
        expect(store.getState().selectedSidebarTab).toBe('Tasks')
        act(() => jest.runOnlyPendingTimers())
        expect(screen.getByRole('dialog')).toBeTruthy()
        expect(store.getState().showSwipeDueDatePopup.data).toEqual({ projectId: 'p1', isProjectPostpone: true })
        act(() => store.dispatch({ type: 'Hide swipe due date popup' }))
        fireEvent.click(row)
        expect(screen.getByText('Goals page')).toBeTruthy()
        expect(screen.queryByRole('dialog')).toBeNull()
    }
)

it('preserves ordinary row click navigation before any swipe', () => {
    render(
        <Provider store={store}>
            <List />
        </Provider>
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Goals page')).toBeTruthy()
    act(() => jest.runOnlyPendingTimers())
    expect(screen.queryByRole('dialog')).toBeNull()
})
