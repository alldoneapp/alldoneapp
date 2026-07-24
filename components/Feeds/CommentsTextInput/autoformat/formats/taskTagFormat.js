import React, { createRef } from 'react'
import ReactQuill from 'react-quill'
import ReactDOM from 'react-dom'
import { Provider } from 'react-redux'

import TaskTagWrapper from '../tags/TaskTagWrapper'
import store from '../../../../../redux/store'

const Embed = ReactQuill.Quill.import('blots/embed')

export default class TaskTagFormat extends Embed {
    static create(taskData) {
        const { id, taskId, editorId, objectUrl } = taskData
        const text = 'taskTagFormat'
        const node = super.create(text)
        const refs = TaskTagFormat.refs

        node.setAttribute('data-id', id)
        node.setAttribute('objectUrl', objectUrl)
        node.setAttribute('editorId', editorId)
        node.setAttribute('taskId', taskId)
        node.setAttribute('text', text)
        node.setAttribute('contenteditable', false)

        TaskTagFormat.data = text
        TaskTagFormat.refs = {
            ...refs,
            [id]: createRef(),
        }

        ReactDOM.render(
            <Provider store={store}>
                <TaskTagWrapper taskId={taskId} editorId={editorId} tagId={id} objectUrl={objectUrl} />
            </Provider>,
            node
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

    constructor(domNode) {
        super(domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = TaskTagFormat.data
    }
}

TaskTagFormat.blotName = 'taskTagFormat'
TaskTagFormat.className = 'ql-taskTagFormat'
TaskTagFormat.tagName = 'span'
