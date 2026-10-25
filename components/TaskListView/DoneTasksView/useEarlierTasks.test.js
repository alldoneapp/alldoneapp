import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import { watchEarlierDoneTasks } from '../../../utils/backends/doneTasks'
import useEarlierTasks from './useEarlierTasks'

/**
 * AT-2382 — `loadingEarlierTasks` is what stops the done-tasks list rendering blank.
 *
 * The first "earlier tasks" press swaps the list's data source from today's tasks to
 * `earlierTasksByDate`, which is still `[]` until Firestore answers. Before this flag there
 * was no way for the view to tell "empty because it is still loading" apart from "empty
 * because there is nothing", so it showed the second and looked broken.
 */

jest.mock('../../../utils/backends/doneTasks', () => ({
    AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON: 15,
    watchEarlierDoneTasks: jest.fn(),
}))
jest.mock('../../../utils/BackendBridge', () => ({ __esModule: true, default: { unwatch: jest.fn() } }))
jest.mock('../../../redux/actions', () => ({ setEarlierDoneTasksAmount: jest.fn(() => ({ type: 'noop' })) }))
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }))
jest.mock('uuid/v4', () => () => 'watcher-key')

const PROJECT = { id: 'project-1' }

const Probe = ({ amount }) => {
    const { loadingEarlierTasks } = useEarlierTasks(PROJECT, amount)
    return <Text testID="state">{loadingEarlierTasks ? 'loading' : 'idle'}</Text>
}

const readState = tree => tree.root.findByProps({ testID: 'state' }).props.children

const deliver = () => {
    const updateTasks = watchEarlierDoneTasks.mock.calls[watchEarlierDoneTasks.mock.calls.length - 1][3]
    act(() => {
        updateTasks([['20260806', [{ id: 'task-1' }]]], {}, 1, 1786000000000)
    })
}

describe('useEarlierTasks loading signal', () => {
    beforeEach(() => jest.clearAllMocks())

    it('is idle while nothing has been requested', () => {
        let tree
        act(() => {
            tree = renderer.create(<Probe amount={0} />)
        })

        expect(readState(tree)).toBe('idle')
        expect(watchEarlierDoneTasks).not.toHaveBeenCalled()
    })

    it('reports loading from the moment a window is requested until the snapshot lands', () => {
        let tree
        act(() => {
            tree = renderer.create(<Probe amount={15} />)
        })

        expect(readState(tree)).toBe('loading')

        deliver()
        expect(readState(tree)).toBe('idle')
    })

    it('reports loading again when the window is widened', () => {
        let tree
        act(() => {
            tree = renderer.create(<Probe amount={15} />)
        })
        deliver()
        expect(readState(tree)).toBe('idle')

        act(() => {
            tree.update(<Probe amount={30} />)
        })

        // The old rows are still on screen here, so this is the "append ghosts below" case
        // rather than the "the whole section is blank" one — but both need the flag.
        expect(readState(tree)).toBe('loading')

        deliver()
        expect(readState(tree)).toBe('idle')
    })
})
