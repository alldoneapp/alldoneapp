import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import TaskExecutionStatusTag, { TaskExecutionStatusChip } from './TaskExecutionStatusTag'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'
import { watchVmSessionStatus } from '../../utils/backends/Assistants/vmSessionStatus'

jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { caption2: {} },
    colors: { Text03: '#8A94A6', UtilityBlue200: '#5AA0FF', UtilityRed200: '#FF8080', UtilityYellow300: '#F58E0A' },
}))
jest.mock('../Icon', () => 'Icon')
jest.mock('../../i18n/TranslationService', () => ({
    translate: (text, params) => (params && Object.keys(params).length ? `${text}(${JSON.stringify(params)})` : text),
}))
jest.mock('../../utils/backends/firestore', () => ({ runHttpsCallableFunction: jest.fn(() => Promise.resolve()) }))
jest.mock('../../utils/backends/Assistants/vmSessionStatus', () => ({ watchVmSessionStatus: jest.fn() }))

const run = status => ({ id: 'task-1', workflowAiStatus: { runId: 'run-1', stepId: 'build', status } })

const textsOf = tree => tree.root.findAllByType(Text).map(node => node.props.children)
const chipOf = tree => tree.root.findByType(TouchableOpacity)

const renderChip = props => {
    let tree
    act(() => {
        tree = renderer.create(<TaskExecutionStatusChip projectId="project-1" {...props} />)
    })
    return tree
}

describe('TaskExecutionStatusChip (AT-3099)', () => {
    afterEach(() => jest.clearAllMocks())

    test.each([
        ['running step + paused VM', run('running'), { status: 'paused' }, 'Working', 'cpu'],
        ['pending step + paused VM', run('pending'), { status: 'paused' }, 'Queued', 'clock'],
        [
            'VM asking a question',
            run('awaiting_vm'),
            { status: 'paused', blockedByCorrelationId: 'job-1' },
            'Waiting for you',
            'message-circle',
        ],
        ['retained VM only', { id: 'task-1' }, { status: 'idle_running' }, 'Paused', 'pause-circle'],
        [
            'failed VM run',
            { id: 'task-1' },
            { status: 'paused', lastRunStatus: 'failed' },
            'Needs attention',
            'alert-circle',
        ],
    ])('%s renders exactly one outline chip', (_, task, session, label, icon) => {
        const tree = renderChip({ task, session })

        expect(tree.root.findAllByType(TouchableOpacity)).toHaveLength(1)
        expect(textsOf(tree)).toEqual([label])
        expect(tree.root.findByType('Icon').props.name).toBe(icon)
        const style = Object.assign({}, ...chipOf(tree).props.style.filter(Boolean))
        expect(style.borderWidth).toBe(1)
        // The old VM pill was filled; the unified chip must not be.
        expect(style.backgroundColor).toBeUndefined()
        // No English "… VM" label leaks into the row any more.
        expect(textsOf(tree).join('')).not.toMatch(/VM/)
    })

    it('renders nothing when there is nothing to report', () => {
        expect(renderChip({ task: { id: 'task-1' }, session: null }).toJSON()).toBeNull()
        expect(renderChip({ task: run('completed'), session: { status: 'stopped' } }).toJSON()).toBeNull()
        expect(renderChip({ task: { ...run('failed'), done: true }, session: null }).toJSON()).toBeNull()
    })

    it('keeps "paused" on a done task whose VM session is retained', () => {
        expect(textsOf(renderChip({ task: { ...run('running'), done: true }, session: { status: 'paused' } }))).toEqual(
            ['Paused']
        )
    })

    it('puts the technical VM details into the tooltip, not into a second tag', () => {
        const tree = renderChip({ task: run('pending'), session: { status: 'paused', queueLength: 2 } })
        const hint = chipOf(tree).props.accessibilityHint

        expect(hint.split('\n')).toEqual([
            'Queued',
            'vm_status_detail_session({"state":"vm_workspace_paused"})',
            'vm_workspace_waiting({"count":2})',
            'vm_workspace_paused_hint',
        ])

        const node = { setAttribute: jest.fn() }
        act(() => {
            renderer.create(
                <TaskExecutionStatusChip projectId="project-1" task={run('pending')} session={{ status: 'paused' }} />,
                { createNodeMock: () => node }
            )
        })
        expect(node.setAttribute).toHaveBeenCalledWith('title', expect.stringContaining('vm_workspace_paused_hint'))
    })

    it('retries a failed workflow step through the retry callable', async () => {
        const tree = renderChip({ task: run('failed'), session: { status: 'paused' } })
        expect(textsOf(tree)).toEqual(['Needs attention'])
        expect(tree.root.findByType('Icon').props.name).toBe('refresh-cw')
        expect(chipOf(tree).props.accessibilityRole).toBe('button')

        await act(async () => {
            tree.root.findByType(TouchableOpacity).props.onPress()
        })
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('retryWorkflowAiRunSecondGen', {
            projectId: 'project-1',
            taskId: 'task-1',
        })
    })

    it('does not offer a retry for a status that is not a failed step', async () => {
        const tree = renderChip({ task: { id: 'task-1' }, session: { status: 'failed' } })
        expect(tree.root.findByType(TouchableOpacity).props.disabled).toBe(true)
        await act(async () => {
            tree.root.findByType(TouchableOpacity).props.onPress()
        })
        expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    })
})

describe('TaskExecutionStatusTag', () => {
    let emit
    let unwatch

    beforeEach(() => {
        unwatch = jest.fn()
        watchVmSessionStatus.mockImplementation((projectId, taskId, callback) => {
            emit = callback
            return unwatch
        })
    })
    afterEach(() => jest.clearAllMocks())

    it('follows the live VM session and keeps one chip through every transition', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <TaskExecutionStatusTag projectId="project-1" task={{ ...run('awaiting_vm'), hasVmSession: true }} />
            )
        })
        expect(watchVmSessionStatus).toHaveBeenCalledWith('project-1', 'task-1', expect.any(Function))
        expect(textsOf(tree)).toEqual(['Working'])

        act(() => emit({ status: 'busy' }))
        expect(textsOf(tree)).toEqual(['Working'])

        act(() => emit({ status: 'paused', lastRunStatus: 'awaiting_user', blockedByCorrelationId: 'job-1' }))
        expect(textsOf(tree)).toEqual(['Waiting for you'])

        act(() => emit({ status: 'idle_running', lastRunStatus: 'completed' }))
        expect(textsOf(tree)).toEqual(['Working'])

        act(() =>
            tree.update(
                <TaskExecutionStatusTag projectId="project-1" task={{ ...run('completed'), hasVmSession: true }} />
            )
        )
        expect(textsOf(tree)).toEqual(['Paused'])

        act(() => tree.unmount())
        expect(unwatch).toHaveBeenCalledTimes(1)
    })

    it('does not watch a session for a task that never hosted a VM job (AT-2907)', () => {
        let tree
        act(() => {
            tree = renderer.create(<TaskExecutionStatusTag projectId="project-1" task={run('pending')} />)
        })
        expect(watchVmSessionStatus).not.toHaveBeenCalled()
        expect(textsOf(tree)).toEqual(['Queued'])
    })

    // Carried over from the former AssistantWorkflowRunTag suite: the chip reads the task the list
    // hands it, and every task enters the app through mapTaskData, which drops each field it does
    // not name. Asserted against the source because importing firestore.js pulls in the store.
    it('is fed by mapTaskData, and a copied task does not inherit the run status', () => {
        const fs = require('fs')
        const path = require('path')
        const firestoreSource = fs.readFileSync(path.join(__dirname, '../../utils/backends/firestore.js'), 'utf8')
        const mapTaskDataBody = firestoreSource.slice(firestoreSource.indexOf('export function mapTaskData'))
        expect(mapTaskDataBody).toMatch(/workflowAiStatus: task\.workflowAiStatus/)
        expect(mapTaskDataBody).toMatch(/hasVmSession/)

        const tasksSource = fs.readFileSync(
            path.join(__dirname, '../../utils/backends/Tasks/tasksFirestore.js'),
            'utf8'
        )
        const uploadNewTaskBody = tasksSource.slice(tasksSource.indexOf('export async function uploadNewTask'))
        expect(uploadNewTaskBody.slice(0, 600)).toMatch(/delete taskCopy\.workflowAiStatus/)
    })
})
