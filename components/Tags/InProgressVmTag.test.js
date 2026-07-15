import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import TaskVmStatusTag, { IN_PROGRESS_VM_LABEL, PAUSED_VM_LABEL } from './InProgressVmTag'
import { watchVmSessionStatus } from '../../utils/backends/Assistants/vmSessionStatus'

jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { subtitle2: {} },
    colors: {
        UtilityYellow125: '#FFE6C7',
        Yellow400: '#A66007',
        Gray300: '#E7ECEF',
        Text03: '#8A94A6',
    },
    windowTagStyle: jest.fn(() => undefined),
}))
jest.mock('../../utils/backends/Assistants/vmSessionStatus', () => ({
    getVmSessionBadgeState: status => {
        if (status === 'busy') return 'active'
        if (['idle_running', 'paused'].includes(status)) return 'paused'
        return null
    },
    VM_SESSION_BADGE_ACTIVE: 'active',
    VM_SESSION_BADGE_PAUSED: 'paused',
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

    test('switches from active to warm and persisted paused badges, then hides terminal states', () => {
        let tree
        act(() => {
            tree = renderer.create(<TaskVmStatusTag projectId="project-1" taskId="task-1" />)
        })

        expect(watchVmSessionStatus).toHaveBeenCalledWith('project-1', 'task-1', expect.any(Function))
        expect(tree.root.findAllByType(Text)).toHaveLength(0)

        act(() => emitStatus('busy'))
        expect(tree.root.findByType(Text).props.children).toBe(IN_PROGRESS_VM_LABEL)
        expect(tree.root.findByProps({ accessibilityLabel: IN_PROGRESS_VM_LABEL }).props.style).toContainEqual({
            backgroundColor: '#FFE6C7',
        })

        act(() => emitStatus('idle_running'))
        expect(tree.root.findByType(Text).props.children).toBe(PAUSED_VM_LABEL)
        expect(tree.root.findByProps({ accessibilityLabel: PAUSED_VM_LABEL }).props.style).toContainEqual({
            backgroundColor: '#E7ECEF',
        })

        act(() => emitStatus('paused'))
        expect(tree.root.findByType(Text).props.children).toBe(PAUSED_VM_LABEL)

        act(() => emitStatus('completed'))
        expect(tree.root.findAllByType(Text)).toHaveLength(0)

        act(() => tree.unmount())
        expect(unwatch).toHaveBeenCalledTimes(1)
    })
})
