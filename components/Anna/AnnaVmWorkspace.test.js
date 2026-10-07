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
