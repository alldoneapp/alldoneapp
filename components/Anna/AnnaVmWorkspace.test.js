import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaVmWorkspace from './AnnaVmWorkspace'

let mockSnapshot, mockError, mockMessageProps, mockInteractionProps
const mockStop = jest.fn()
jest.mock('../../utils/backends/firestore', () => ({
    getDb: () => ({
        doc: () => ({
            onSnapshot: (next, error) => {
                mockSnapshot = next
                mockError = error
                return mockStop
            },
        }),
    }),
}))
jest.mock('../../utils/appResume', () => ({ subscribePageVisible: () => () => {} }))
jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../ChatsView/ChatDV/EditorView/MessageItemBody', () => props => {
    mockMessageProps = props
    return <p>{props.commentText}</p>
})
jest.mock('../ChatsView/ChatDV/EditorView/VmInteractionCard', () => props => {
    mockInteractionProps = props
    return <button>Approve</button>
})
jest.mock('../ChatsView/ChatDV/EditorView/StopAssistantRunButton', () => () => <button>Stop</button>)
const job = {
    id: 'r1',
    projectId: 'p1',
    objectId: 't1',
    objectType: 'tasks',
    commentId: 'c1',
    title: 'Build report',
    status: 'initiated',
}
let root, container
const publish = (status, commentText = 'Reading files', runId = 'r1') =>
    act(() =>
        mockSnapshot({
            exists: true,
            data: () => ({
                commentText,
                isLoading: status === 'running',
                assistantRun: { kind: 'vm_job', runId, status, interaction: { requestId: 'ask1' } },
            }),
        })
    )
beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<AnnaVmWorkspace job={job} active />))
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    jest.clearAllMocks()
})

it('updates live terminal text, exposes existing approvals and renders the final result', () => {
    publish('running')
    expect(container.querySelector('pre').textContent).toBe('Reading files')
    publish('awaiting_user', 'Review the plan')
    expect(container.textContent).toContain('Approve')
    expect(mockInteractionProps).toMatchObject({
        projectId: 'p1',
        objectId: 't1',
        commentId: 'c1',
        assistantRun: { runId: 'r1' },
    })
    publish('completed', 'Report ready')
    expect(container.querySelector('pre')).toBeNull()
    expect(mockMessageProps.isLoading).toBe(false)
    expect(container.textContent).toContain('Report ready')
})

it('removes stale output on permission failure and rejects a different run’s comment', () => {
    publish('running', 'Private output')
    act(() => mockError(new Error('permission-denied')))
    expect(container.textContent).not.toContain('Private output')
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    publish('running', 'Other output', 'other-run')
    expect(container.textContent).not.toContain('Other output')
})

it('unsubscribes when the pane is hidden and restores the listener when opened again', () => {
    act(() => root.render(<AnnaVmWorkspace job={job} active={false} />))
    expect(mockStop).toHaveBeenCalledTimes(1)
    act(() => root.render(<AnnaVmWorkspace job={job} active />))
    publish('completed', 'Finished in the background')
    expect(container.textContent).toContain('Finished in the background')
})

// AT-2916: a card is a thread; `runId` is the run it follows, and a paused VM says so.
describe('thread cards', () => {
    const thread = { ...job, id: 'p1__t1', runId: 'r2', commentId: 'c2' }

    it('follows the run a thread card points at, not the thread id', () => {
        act(() => root.render(<AnnaVmWorkspace job={thread} active />))
        publish('running', 'Second run output', 'r2')
        expect(container.querySelector('pre').textContent).toBe('Second run output')
        publish('running', 'First run output', 'r1')
        expect(container.textContent).not.toContain('First run output')
    })

    it('labels a paused VM as paused and shows the result of its last run', () => {
        act(() => root.render(<AnnaVmWorkspace job={{ ...thread, status: 'paused' }} active />))
        publish('completed', 'Merged and deployed', 'r2')
        expect(container.querySelector('.anna-vm-status').textContent).toBe('vm_workspace_paused')
        expect(container.textContent).toContain('vm_workspace_paused_hint')
        expect(container.querySelector('pre')).toBeNull()
        expect(container.textContent).toContain('Merged and deployed')
        expect(container.querySelector('.anna-vm-task-link').getAttribute('href')).toBe('/projects/p1/tasks/t1/chat')
    })

    it('counts the follow-ups waiting on the same thread', () => {
        act(() => root.render(<AnnaVmWorkspace job={{ ...thread, waitingCount: 2 }} active />))
        expect(container.querySelector('.anna-vm-waiting').textContent).toContain('vm_workspace_waiting')
        act(() => root.render(<AnnaVmWorkspace job={thread} active />))
        expect(container.querySelector('.anna-vm-waiting')).toBeNull()
    })
})
