import React from 'react'
import { Provider } from 'react-redux'

import TaskTagWrapper from '../tags/TaskTagWrapper'
import store from '../../../../../redux/store'
import { renderEmbedContent } from './embedReactRoot'
import ReactEmbedBlot from './reactEmbedBlot'

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
        node.setAttribute('contenteditable', false)

        TaskTagFormat.data = text

        renderEmbedContent(
            node,
            <Provider store={store}>
                <TaskTagWrapper taskId={taskId} editorId={editorId} tagId={id} objectUrl={objectUrl} />
            </Provider>
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
        this.id = domNode.getAttribute('data-id')
        this.data = TaskTagFormat.data
    }
}

TaskTagFormat.blotName = 'taskTagFormat'
TaskTagFormat.className = 'ql-taskTagFormat'
TaskTagFormat.tagName = 'span'
