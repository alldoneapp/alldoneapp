import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useSelector: selector =>
        selector({
            loggedUser: { uid: 'user-1' },
            smallScreenNavigation: false,
            isMiddleScreen: false,
        }),
    useDispatch: () => jest.fn(),
    useStore: () => ({ getState: () => ({}), dispatch: jest.fn(), subscribe: jest.fn() }),
    shallowEqual: (a, b) => a === b,
    batch: fn => fn(),
    connect: () => component => component,
    Provider: ({ children }) => children,
}))

jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: {
        getTaskNameWithoutMeta: text => text.replace(/<[^>]+>/g, ''),
    },
}))

jest.mock('../../../Icon', () => 'Icon')

import SelectedGoalRow from './SelectedGoalRow'

describe('SelectedGoalRow (AT-2580)', () => {
    it('shows the selected goal name and opens the goal picker when pressed', () => {
        const showParentGoal = jest.fn()
        let tree
        act(() => {
            tree = renderer.create(
                <SelectedGoalRow
                    activeGoal={{ extendedName: '<meta>Prepare the launch</meta>' }}
                    showParentGoal={showParentGoal}
                />
            )
        })

        expect(tree.root.findByProps({ testID: 'selected-goal-row' })).toBeTruthy()
        expect(tree.root.findByProps({ testID: 'selected-goal-name' }).props.children).toBe('Prepare the launch')

        act(() => {
            tree.root.findByProps({ testID: 'selected-goal-row' }).props.onPress()
        })
        expect(showParentGoal).toHaveBeenCalledTimes(1)
    })

    it('renders nothing without a selected goal', () => {
        let tree
        act(() => {
            tree = renderer.create(<SelectedGoalRow activeGoal={null} showParentGoal={jest.fn()} />)
        })

        expect(tree.toJSON()).toBeNull()
    })
})
