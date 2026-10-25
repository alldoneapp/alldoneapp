import React from 'react'
import { Provider } from 'react-redux'

import TaskTagWrapper from '../tags/TaskTagWrapper'
import store from '../../../../../redux/store'
import { renderEmbedContent } from './embedReactRoot'
import ReactEmbedBlot from './reactEmbedBlot'

export const TASK_TAG_RENDER_RETRY_DELAY = 250
export const TASK_TAG_RENDER_MAX_RETRIES = 3

/**
 * Task tags live in their own React roots, outside the app-level error boundary. A transient
 * exception anywhere in the task row would therefore make React tear down only this root while
 * quill kept the embed in the document. The result was an empty line whose task returned after a
 * reload rebuilt the root (AT-2568).
 *
 * Keep the failure local, show a visible placeholder immediately, and remount from current redux
 * state. Retries are bounded so a genuinely broken task cannot create a render loop.
 */
export class TaskTagRenderBoundary extends React.Component {
    state = { error: null, retryCount: 0, retryKey: 0 }

    static getDerivedStateFromError(error) {
        return { error }
    }

    componentDidCatch(error) {
        const { retryCount } = this.state
        console.error('[TaskTagFormat] Embedded task render failed', {
            taskId: this.props.taskId,
            retryCount,
            error,
        })

        if (retryCount >= TASK_TAG_RENDER_MAX_RETRIES) return
        this.retryTimeout = setTimeout(() => {
            this.retryTimeout = null
            this.setState(state => ({
                error: null,
                retryCount: state.retryCount + 1,
                retryKey: state.retryKey + 1,
            }))
        }, TASK_TAG_RENDER_RETRY_DELAY)
    }

    componentWillUnmount() {
        clearTimeout(this.retryTimeout)
    }

    render() {
        const { children, fallback } = this.props
        const { error, retryKey } = this.state
        return error ? fallback : <React.Fragment key={retryKey}>{children}</React.Fragment>
    }
}

const TaskTagRecoveryPlaceholder = () => (
    <span contentEditable={false} role="status">
        Loading task...
    </span>
)

export default class TaskTagFormat extends ReactEmbedBlot {
    static create(taskData) {
        const { id, taskId, editorId, objectUrl } = taskData
        const text = 'taskTagFormat'
        const node = super.create(text)

        node.setAttribute('data-id', id)
        node.setAttribute('objectUrl', objectUrl)
        node.setAttribute('editorId', editorId)
        node.setAttribute('taskId', taskId)
        node.setAttribute('text', text)

        TaskTagFormat.data = text

        renderEmbedContent(
            node,
            <TaskTagRenderBoundary taskId={taskId} fallback={<TaskTagRecoveryPlaceholder />}>
                <Provider store={store}>
                    <TaskTagWrapper taskId={taskId} editorId={editorId} tagId={id} objectUrl={objectUrl} />
                </Provider>
            </TaskTagRenderBoundary>,
            {
                editorId,
                kind: 'task',
                height: 24,
                width: 480,
                getLabel: () => {
                    const state = store.getState()
                    const task =
                        state.notesInnerTasks[editorId]?.[taskId] || state.notesInnerTasks[state.activeNoteId]?.[taskId]
                    return task?.name || task?.extendedName || 'Loading task...'
                },
            }
        )

        return node
    }

    static value(domNode) {
        const taskData = {
            text: domNode.getAttribute('text'),
            id: domNode.getAttribute('data-id'),
            editorId: domNode.getAttribute('editorId'),
            objectUrl: domNode.getAttribute('objectUrl'),
            taskId: domNode.getAttribute('taskId'),
        }
        return taskData
    }

    constructor(scroll, domNode) {
        super(scroll, domNode)
        // Quill protects the task inside contentNode. The outer span also holds
        // its editable cursor guards: disabling it hides the native caret next
        // to standalone/adjacent tags (AT-2697). Normalize legacy DOM nodes too.
        domNode.removeAttribute('contenteditable')
        // Keep the row in one inline box and leave room for the native caret
        // outside its background, including between tags and on narrow screens.
        this.contentNode.style.display = 'inline-block'
        this.contentNode.style.margin = '0 2px'
        this.contentNode.style.maxWidth = 'calc(100% - 4px)'
        this.id = domNode.getAttribute('data-id')
        this.data = TaskTagFormat.data
    }
}

TaskTagFormat.blotName = 'taskTagFormat'
TaskTagFormat.className = 'ql-taskTagFormat'
TaskTagFormat.tagName = 'span'
