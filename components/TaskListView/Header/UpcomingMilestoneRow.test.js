import React from 'react'
import renderer, { act } from 'react-test-renderer'
import UpcomingMilestoneRow from './UpcomingMilestoneRow'
import store from '../../../redux/store'
import useProjectPostponePreview from '../../../hooks/useProjectPostponePreview'
import { DV_TAB_ROOT_GOALS } from '../../../utils/TabNavigationConstants'

let mockState
const mockDispatch = jest.fn()
const mockClose = jest.fn()
jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../redux/store', () => ({ dispatch: jest.fn() }))
jest.mock('../../../redux/actions', () => ({
    showSwipeDueDatePopup: () => ({ type: 'SHOW' }),
    setSwipeDueDatePopupData: data => ({ type: 'DATA', data }),
    switchProject: index => ({ type: 'PROJECT', index }),
    setSelectedSidebarTab: tab => ({ type: 'TAB', tab }),
}))
jest.mock('react-native-gesture-handler/Swipeable', () => {
    const React = require('react')
    return React.forwardRef(({ children, ...props }, ref) => {
        React.useImperativeHandle(ref, () => ({
            close: () => {
                mockClose()
                // The real web Swipeable can close synchronously before willClose.
                props.onSwipeableClose()
                props.onSwipeableWillClose()
            },
        }))
        return React.createElement('Swipeable', props, children)
    })
})
jest.mock('../../GoalsView/MilestonePresentation', () => 'MilestonePresentation')
jest.mock('../../GoalsView/GoalsSwipeBackground', () => 'GoalsSwipeBackground')
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfLoggedUserIsNormalUserInGuide: () => false,
}))
jest.mock('../../../hooks/useProjectPostponePreview', () => jest.fn(() => undefined))
jest.mock('../../UIComponents/Ghosts/ghostAnimation', () => ({ useReducedMotion: () => true }))
jest.mock('../../../i18n/TranslationService', () => ({ translate: value => value }))

describe('upcoming milestone project postpone (AT-2726)', () => {
    let tree
    const mount = (props = {}) =>
        act(() => {
            tree = renderer.create(<UpcomingMilestoneRow projectId="p1" allowProjectPostpone {...props} />)
        })
    beforeEach(() => {
        jest.useFakeTimers()
        jest.clearAllMocks()
        useProjectPostponePreview.mockReturnValue(undefined)
        mockState = {
            openMilestonesByProjectInTasks: { p1: [{ id: 'm1', date: 123 }] },
            goalsByProjectInTasks: { p1: {} },
            projectUsers: { p1: [] },
            loggedUser: { uid: 'u1' },
            currentUser: { uid: 'u1' },
            loggedUserProjectsMap: { p1: { index: 2 } },
        }
    })
    afterEach(() => {
        act(() => tree?.unmount())
        jest.useRealTimers()
    })

    it('opens the same project picker on a left swipe without changing the milestone date', () => {
        mount()
        const swipe = tree.root.findByType('Swipeable')
        expect(swipe.props.renderLeftActions).toBeUndefined()
        expect(swipe.props.onSwipeableLeftWillOpen).toBeUndefined()
        expect(swipe.props.rightThreshold).toBe(80)
        expect(swipe.props.failOffsetY).toEqual([-5, 5])
        act(() => {
            swipe.props.onSwipeableRightWillOpen()
            swipe.props.onSwipeableWillOpen()
        })
        expect(mockClose).toHaveBeenCalledTimes(1)
        expect(mockDispatch).not.toHaveBeenCalled()
        act(() => jest.runOnlyPendingTimers())
        expect(store.dispatch).toHaveBeenCalledWith([
            { type: 'SHOW' },
            { type: 'DATA', data: { projectId: 'p1', isProjectPostpone: true } },
        ])
        expect(tree.root.findByType('MilestonePresentation').props.milestone.date).toBe(123)
    })

    it('blocks the trailing swipe click and allows normal goals navigation again after dismissal', () => {
        mount()
        const swipe = tree.root.findByType('Swipeable')
        const capture = tree.root.findAll(node => typeof node.props.onClickCapture === 'function')[0].props
            .onClickCapture
        const press = tree.root.findByType('MilestonePresentation').props.onPress
        let prevented = false
        const click = () => {
            prevented = false
            capture({ preventDefault: () => {}, stopPropagation: () => (prevented = true) })
            if (!prevented) press()
        }
        act(() => {
            swipe.props.onSwipeableRightWillOpen()
            swipe.props.onSwipeableWillOpen()
            click()
        })
        expect(mockDispatch).not.toHaveBeenCalled()
        act(() => jest.runOnlyPendingTimers())
        act(click)
        expect(mockDispatch).toHaveBeenCalledWith([
            { type: 'PROJECT', index: 2 },
            { type: 'TAB', tab: DV_TAB_ROOT_GOALS },
        ])
    })

    it('keeps ordinary milestone presses working when postponement is unavailable', () => {
        mount({ allowProjectPostpone: false })
        expect(tree.root.findAllByType('Swipeable')).toHaveLength(0)
        act(() => tree.root.findByType('MilestonePresentation').props.onPress())
        expect(mockDispatch).toHaveBeenCalledWith([
            { type: 'PROJECT', index: 2 },
            { type: 'TAB', tab: DV_TAB_ROOT_GOALS },
        ])
        expect(store.dispatch).not.toHaveBeenCalled()
    })

    it.each(['hidden', 'no-milestone', 'users-loading'])('does not create an active swipe row for %s', mode => {
        if (mode === 'no-milestone') mockState.openMilestonesByProjectInTasks.p1 = []
        if (mode === 'users-loading') delete mockState.projectUsers.p1
        mount({ hidden: mode === 'hidden' })
        expect(tree.root.findAllByType('Swipeable')).toHaveLength(0)
    })

    it('does not open a deferred picker after the milestone row unmounts', () => {
        mount()
        act(() => {
            tree.root.findByType('Swipeable').props.onSwipeableRightWillOpen()
            tree.unmount()
        })
        act(() => jest.runOnlyPendingTimers())
        expect(store.dispatch).not.toHaveBeenCalled()
    })

    it('shows the same saving feedback as the project header', () => {
        useProjectPostponePreview.mockReturnValue({ saving: true })
        mount()
        expect(tree.root.findAllByProps({ accessibilityRole: 'status' }).length).toBeGreaterThan(0)
    })
})
