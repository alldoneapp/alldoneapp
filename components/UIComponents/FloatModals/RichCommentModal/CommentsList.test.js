import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'

import CommentsList from './CommentsList'
import { cancelAssistantRun, respondToVmInteraction } from '../../../../utils/backends/Assistants/assistantRuns'
import AssistantProgress from '../../../ChatsView/ChatDV/EditorView/AssistantProgress'
import { resetStopRequests } from '../../../ChatsView/ChatDV/EditorView/stopAssistantRunRequests'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { uid: 'user-1' } }),
}))
jest.mock('../../../Feeds/FeedsModals/ListCommentsComponents/Comment', () => 'Comment')
jest.mock('../../../../utils/backends/Assistants/assistantRuns', () => ({
    respondToVmInteraction: jest.fn(() => Promise.resolve()),
    cancelAssistantRun: jest.fn(() => Promise.resolve()),
}))

const baseRun = interaction => ({
    kind: 'vm_job',
    status: 'awaiting_user',
    runId: 'run-1',
    interaction: { requestId: 'request-1', ...interaction },
})

const renderPopupComments = (assistantRun, commentOverrides = {}) =>
    renderer.create(
        <CommentsList
            projectId="project-1"
            objectType="tasks"
            objectId="task-1"
            comments={[{ id: 'comment-1', commentText: 'VM status', assistantRun, ...commentOverrides }]}
            archivingEmailKeys={[]}
            archivedEmailKeys={[]}
        />
    )

const textContent = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => node.props.children)
        .flat(Infinity)
        .filter(value => typeof value === 'string')
        .join('\n')

const findButton = (tree, label) =>
    tree.root
        .findAllByType(TouchableOpacity)
        .find(button => button.findAllByType(Text).some(text => text.props.children === label))

describe('RichCommentModal CommentsList VM interactions', () => {
    beforeEach(() => {
        respondToVmInteraction.mockClear()
    })

    test('shows the complete plan and submits its review from the popup', async () => {
        const plan = '1. Inspect the queue\n2. Update the worker\n3. Run the focused tests'
        const tree = renderPopupComments(baseRun({ kind: 'plan_review', plan }))

        expect(textContent(tree)).toContain(plan)
        expect(findButton(tree, 'Execute plan')).toBeTruthy()
        expect(findButton(tree, 'Request changes')).toBeTruthy()
        expect(findButton(tree, 'Cancel')).toBeTruthy()

        await act(async () => {
            await findButton(tree, 'Execute plan').props.onPress()
        })

        expect(respondToVmInteraction).toHaveBeenCalledWith({
            projectId: 'project-1',
            objectType: 'tasks',
            objectId: 'task-1',
            commentId: 'comment-1',
            runId: 'run-1',
            requestId: 'request-1',
            response: { action: 'approve', answers: {}, message: '' },
        })
    })

    test('shows every question detail and submits selected and free-form answers from the popup', async () => {
        const tree = renderPopupComments(
            baseRun({
                kind: 'clarification',
                questions: [
                    {
                        id: 'scope',
                        header: 'Scope',
                        question: 'How broad should the fix be?',
                        options: [
                            { label: 'Full repository', description: 'Cover every VM entry point.' },
                            { label: 'Tasks only', description: 'Limit the change to task comments.' },
                        ],
                    },
                ],
            })
        )

        const content = textContent(tree)
        expect(content).toContain('How broad should the fix be?')
        expect(content).toContain('Full repository')
        expect(content).toContain('Cover every VM entry point.')

        act(() => findButton(tree, 'Full repository').props.onPress())
        const otherInput = tree.root.findByProps({ placeholder: 'Type another answer…' })
        act(() => otherInput.props.onChangeText('Include contact chats'))

        await act(async () => {
            await findButton(tree, 'Send answers').props.onPress()
        })

        expect(respondToVmInteraction).toHaveBeenCalledWith(
            expect.objectContaining({
                response: {
                    action: 'submit',
                    answers: { scope: ['Full repository'], 'scope:other': 'Include contact chats' },
                    message: '',
                },
            })
        )
    })

    test('shows approval context and submits the tool decision from the popup', async () => {
        const tree = renderPopupComments(
            baseRun({
                kind: 'tool_approval',
                toolName: 'Shell command',
                reason: 'This command changes tracked files.',
                command: 'npm run format-code',
                cwd: '/workspace/alldone',
            })
        )

        const content = textContent(tree)
        expect(content).toContain('Shell command')
        expect(content).toContain('This command changes tracked files.')
        expect(content).toContain('npm run format-code')
        expect(content).toContain('/workspace/alldone')

        const instructionInput = tree.root.findByProps({ placeholder: 'Optional instruction or reason…' })
        act(() => instructionInput.props.onChangeText('Use the focused formatter instead'))
        await act(async () => {
            await findButton(tree, 'Deny').props.onPress()
        })

        expect(respondToVmInteraction).toHaveBeenCalledWith(
            expect.objectContaining({
                response: {
                    action: 'deny',
                    answers: {},
                    message: 'Use the focused formatter instead',
                },
            })
        )
    })

    test('renders one card only while the canonical run is awaiting the user', () => {
        const interaction = { kind: 'plan_review', plan: 'Only active plans should appear.' }
        const awaitingTree = renderPopupComments(baseRun(interaction))
        const resumedTree = renderPopupComments({ ...baseRun(interaction), status: 'running' })

        expect(findButton(awaitingTree, 'Execute plan')).toBeTruthy()
        expect(awaitingTree.root.findAllByType(Text).filter(text => text.props.children === 'PLAN READY')).toHaveLength(
            1
        )
        expect(findButton(resumedTree, 'Execute plan')).toBeUndefined()
    })

    test('replaces technical chat status text with the shared friendly progress story', () => {
        const tree = renderPopupComments(
            {
                kind: 'chat',
                status: 'running',
                runId: 'run-1',
                activity: { phase: 'tool', toolName: 'web_search', startedAt: 123 },
            },
            {
                isLoading: true,
                commentText: 'Under the hood: web_search (step 1/200)',
            }
        )
        const comment = tree.root.findByType('Comment')

        expect(comment.props.contentOverride.type).toBe(AssistantProgress)
        expect(comment.props.contentOverride.props.activity).toEqual({
            phase: 'tool',
            toolName: 'web_search',
            startedAt: 123,
        })
        expect(comment.props.contentOverride.props.appearance).toBe('dark')
    })
})

describe('RichCommentModal CommentsList stop control', () => {
    beforeEach(() => {
        resetStopRequests()
        cancelAssistantRun.mockClear()
        cancelAssistantRun.mockImplementation(() => Promise.resolve())
    })

    const runningRun = overrides => ({ kind: 'chat', status: 'running', runId: 'run-1', ...overrides })

    test('stops a running chat run straight from the popup, without opening the full chat view', async () => {
        const tree = renderPopupComments(runningRun(), { isLoading: true })

        const stop = findButton(tree, 'Stop')
        expect(stop).toBeTruthy()

        await act(async () => {
            await stop.props.onPress()
        })

        expect(cancelAssistantRun).toHaveBeenCalledWith({
            projectId: 'project-1',
            objectType: 'tasks',
            objectId: 'task-1',
            commentId: 'comment-1',
            runKind: 'chat',
            runId: 'run-1',
        })
        expect(findButton(tree, 'Stopping…')).toBeTruthy()
    })

    test('offers Stop for a running VM job too, which the popup shows no progress card for', () => {
        const tree = renderPopupComments(runningRun({ kind: 'vm_job' }), { isLoading: true })

        expect(tree.root.findAllByType(AssistantProgress)).toHaveLength(0)
        expect(findButton(tree, 'Stop')).toBeTruthy()
    })

    test('hides Stop whenever the run is not stoppable', () => {
        const cases = [
            ['settled run', runningRun({ status: 'completed' }), { isLoading: true }],
            ['already stopping', runningRun({ status: 'cancel_requested' }), { isLoading: true }],
            ['awaiting the user', baseRun({ kind: 'plan_review', plan: 'p' }), { isLoading: true }],
            ['another user’s run', runningRun({ requestUserId: 'user-2' }), { isLoading: true }],
            ['not loading', runningRun(), {}],
            ['stale spinner', runningRun(), { isLoading: true, lastChangeDate: Date.now() - 6 * 60 * 1000 }],
        ]

        cases.forEach(([label, assistantRun, overrides]) => {
            const tree = renderPopupComments(assistantRun, overrides)
            expect([label, !!findButton(tree, 'Stop')]).toEqual([label, false])
        })
    })

    test('a stop already requested from the full chat view mounts the popup button disabled', async () => {
        const firstTree = renderPopupComments(runningRun(), { isLoading: true })
        await act(async () => {
            await findButton(firstTree, 'Stop').props.onPress()
        })

        const reopenedPopup = renderPopupComments(runningRun(), { isLoading: true })
        const pendingButton = findButton(reopenedPopup, 'Stopping…')

        expect(pendingButton).toBeTruthy()
        expect(pendingButton.props.disabled).toBe(true)

        await act(async () => {
            await pendingButton.props.onPress()
        })

        expect(cancelAssistantRun).toHaveBeenCalledTimes(1)
    })
})
