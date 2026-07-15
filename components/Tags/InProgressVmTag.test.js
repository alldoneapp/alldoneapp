import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import TaskVmStatusTag, { FAILED_VM_LABEL, IN_PROGRESS_VM_LABEL, PAUSED_VM_LABEL, VmStatusTag } from './InProgressVmTag'
import { watchVmSessionStatus } from '../../utils/backends/Assistants/vmSessionStatus'

jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { subtitle2: {} },
    colors: {
        UtilityYellow125: '#FFE6C7',
        Yellow400: '#A66007',
        Gray300: '#E7ECEF',
        Text03: '#8A94A6',
        UtilityRed100: '#FFEBEB',
        UtilityRed300: '#BD0303',
    },
    windowTagStyle: jest.fn(() => undefined),
}))
jest.mock('../../utils/backends/Assistants/vmSessionStatus', () => ({
    VM_BADGE_STATE_IN_PROGRESS: 'in_progress',
    VM_BADGE_STATE_PAUSED: 'paused',
    VM_BADGE_STATE_FAILED: 'failed',
    getVmSessionBadgeState: session => {
        if (!session) return null
        const status = typeof session === 'string' ? session : session.status
        if (status === 'busy') return 'in_progress'
        if (status === 'failed' || session.lastRunStatus === 'failed') return 'failed'
        return ['idle_running', 'paused'].includes(status) ? 'paused' : null
    },
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

    test('updates from active to paused, failed, and hidden states', () => {
        let tree
        act(() => {
            tree = renderer.create(<TaskVmStatusTag projectId="project-1" taskId="task-1" />)
        })

        expect(watchVmSessionStatus).toHaveBeenCalledWith('project-1', 'task-1', expect.any(Function))
        expect(tree.root.findAllByType(Text)).toHaveLength(0)

        act(() => emitStatus({ status: 'busy' }))
        expect(tree.root.findByType(Text).props.children).toBe(IN_PROGRESS_VM_LABEL)

        act(() => emitStatus({ status: 'idle_running' }))
        expect(tree.root.findByType(Text).props.children).toBe(PAUSED_VM_LABEL)

        act(() => emitStatus({ status: 'paused', lastRunStatus: 'failed' }))
        expect(tree.root.findByType(Text).props.children).toBe(FAILED_VM_LABEL)

        act(() => emitStatus({ status: 'stopped' }))
        expect(tree.root.findAllByType(Text)).toHaveLength(0)

        act(() => tree.unmount())
        expect(unwatch).toHaveBeenCalledTimes(1)
    })

    test.each([
        [{ status: 'busy' }, IN_PROGRESS_VM_LABEL],
        [{ status: 'idle_running' }, PAUSED_VM_LABEL],
        [{ status: 'paused' }, PAUSED_VM_LABEL],
        [{ status: 'failed' }, FAILED_VM_LABEL],
    ])('renders the exact label for session %j', (session, label) => {
        const tree = renderer.create(<VmStatusTag session={session} />)

        expect(tree.root.findByType(Text).props.children).toBe(label)
        expect(tree.root.findByProps({ accessibilityLabel: label })).toBeTruthy()
    })

    test.each([
        [{ status: 'busy' }, IN_PROGRESS_VM_LABEL, '#FFE6C7'],
        [{ status: 'paused' }, PAUSED_VM_LABEL, '#E7ECEF'],
        [{ status: 'failed' }, FAILED_VM_LABEL, '#FFEBEB'],
    ])('uses the expected styling for %s', (session, label, backgroundColor) => {
        const tree = renderer.create(<VmStatusTag session={session} />)
        const badge = tree.root.findByProps({ accessibilityLabel: label })

        expect(badge.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor })]))
    })

    test.each([null, { status: 'stopped' }, { status: 'completed' }, { status: 'unknown' }])(
        'renders no badge for %j',
        session => {
            const tree = renderer.create(<VmStatusTag session={session} />)
            expect(tree.root.findAllByType(Text)).toHaveLength(0)
        }
    )
})
