import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'

import CommentsList from './CommentsList'
import { respondToVmInteraction } from '../../../../utils/backends/Assistants/assistantRuns'

jest.mock('../../../Feeds/FeedsModals/ListCommentsComponents/Comment', () => 'Comment')
jest.mock('../../../../utils/backends/Assistants/assistantRuns', () => ({
    respondToVmInteraction: jest.fn(() => Promise.resolve()),
}))

const baseRun = interaction => ({
    kind: 'vm_job',
    status: 'awaiting_user',
    runId: 'run-1',
    interaction: { requestId: 'request-1', ...interaction },
})

const renderPopupComments = assistantRun =>
    renderer.create(
        <CommentsList
            projectId="project-1"
            objectType="tasks"
            objectId="task-1"
            comments={[{ id: 'comment-1', commentText: 'VM status', assistantRun }]}
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
})
