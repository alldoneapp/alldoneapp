import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import TaskVmStatusTag, { IN_PROGRESS_VM_LABEL } from './InProgressVmTag'
import { watchVmSessionStatus } from '../../utils/backends/Assistants/vmSessionStatus'

jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { subtitle2: {} },
    colors: { UtilityYellow125: '#FFE6C7', Yellow400: '#A66007' },
    windowTagStyle: jest.fn(() => undefined),
}))
jest.mock('../../utils/backends/Assistants/vmSessionStatus', () => ({
    isVmSessionActiveOrWarm: status => ['busy', 'idle_running', 'running'].includes(status),
    watchVmSessionStatus: jest.fn(),
}))

describe('TaskVmStatusTag', () => {
    let emitStatus
    let unwatch

    beforeEach(() => {
        unwatch = jest.fn()
        watchVmSessionStatus.mockImplementation((projectId, taskId, callback) => {
            emitStatus = callback
            return unwatch
        })
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    test('appears for active and warm sessions, then disappears when paused', () => {
        let tree
        act(() => {
            tree = renderer.create(<TaskVmStatusTag projectId="project-1" taskId="task-1" />)
        })

        expect(watchVmSessionStatus).toHaveBeenCalledWith('project-1', 'task-1', expect.any(Function))
        expect(tree.root.findAllByType(Text)).toHaveLength(0)

        act(() => emitStatus('busy'))
        expect(tree.root.findByType(Text).props.children).toBe(IN_PROGRESS_VM_LABEL)

        act(() => emitStatus('idle_running'))
        expect(tree.root.findByType(Text).props.children).toBe(IN_PROGRESS_VM_LABEL)

        act(() => emitStatus('paused'))
        expect(tree.root.findAllByType(Text)).toHaveLength(0)

        act(() => tree.unmount())
        expect(unwatch).toHaveBeenCalledTimes(1)
    })
})
