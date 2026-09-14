/**
 * @jest-environment jsdom
 *
 * AT-2568. Every task tag is a separate React root mounted inside a quill embed. Those roots are
 * not descendants of App's error boundary, so an exception in a live task-row update used to
 * tear down the row while leaving the embed and its Yjs value untouched. Reloading reconstructed
 * the root, which is why the task appeared again.
 *
 * Drive the real TaskTagFormat in a real quill editor and fail one render after mount. The tag
 * must remain visible during recovery and remount itself without rebuilding the editor.
 */
import React from 'react'
import ReactDOM from 'react-dom'
import Quill from 'quill'

let mockTriggerTaskRender
let mockFailNextTaskRender = false

jest.mock('react-redux', () => ({
    __esModule: true,
    Provider: ({ children }) => children,
}))
jest.mock('../../../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({}), subscribe: () => () => {}, dispatch: () => {} },
}))
jest.mock('../tags/TaskTagWrapper', () => {
    const React = require('react')
    return function TestTaskTag() {
        const [, renderAgain] = React.useState(0)
        mockTriggerTaskRender = () => renderAgain(value => value + 1)
        if (mockFailNextTaskRender) {
            mockFailNextTaskRender = false
            throw new Error('transient task row render failure')
        }
        return React.createElement('span', { className: 'task-title' }, 'Ship the release notes')
    }
})

import TaskTagWrapper from '../tags/TaskTagWrapper'
import { renderEmbedContent } from './embedReactRoot'
import ReactEmbedBlot from './reactEmbedBlot'
import TaskTagFormat, { TASK_TAG_RENDER_RETRY_DELAY } from './taskTagFormat'

// The pre-fix shape, kept beside the fixed blot so the test demonstrates why a root-local
// boundary is necessary instead of merely restating its implementation.
class UnprotectedTaskTagFormat extends ReactEmbedBlot {
    static create(taskData) {
        const node = super.create('unprotectedTaskTagFormat')
        node.setAttribute('taskId', taskData.taskId)
        node.setAttribute('contenteditable', false)
        renderEmbedContent(node, <TaskTagWrapper />)
        return node
    }

    static value(domNode) {
        return { taskId: domNode.getAttribute('taskId') }
    }
}

UnprotectedTaskTagFormat.blotName = 'unprotectedTaskTagFormat'
UnprotectedTaskTagFormat.className = 'ql-unprotectedTaskTagFormat'
UnprotectedTaskTagFormat.tagName = 'span'

Quill.register(TaskTagFormat, true)
Quill.register(UnprotectedTaskTagFormat, true)

const visibleText = node => node.textContent.replace(/﻿/g, '').trim()

describe('TaskTagFormat render recovery (AT-2568)', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockFailNextTaskRender = false
        mockTriggerTaskRender = null
        jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        console.error.mockRestore()
        jest.useRealTimers()
        document.body.innerHTML = ''
    })

    it('reproduces the empty embed when an isolated task root has no boundary', () => {
        const host = document.createElement('div')
        document.body.appendChild(host)
        const quill = new Quill(host)
        quill.setContents([
            { insert: 'Before\n' },
            { insert: { unprotectedTaskTagFormat: { taskId: 'task-1' } } },
            { insert: '\nAfter\n' },
        ])

        const embed = quill.root.querySelector('span.ql-unprotectedTaskTagFormat')
        expect(visibleText(embed)).toContain('Ship the release notes')

        mockFailNextTaskRender = true
        try {
            ReactDOM.unstable_batchedUpdates(() => mockTriggerTaskRender())
        } catch (error) {
            // React 18 may surface the uncaught root error to the caller after tearing it down.
        }

        expect(visibleText(embed)).toBe('')
        expect(quill.getContents().ops.some(op => op.insert?.unprotectedTaskTagFormat?.taskId === 'task-1')).toBe(true)
    })

    it('keeps the embed visible and restores its task after a transient row failure', () => {
        const host = document.createElement('div')
        document.body.appendChild(host)
        const quill = new Quill(host)
        quill.setContents([
            { insert: 'Before\n' },
            {
                insert: {
                    taskTagFormat: {
                        id: 'tag-1',
                        taskId: 'task-1',
                        editorId: 'note-1',
                        objectUrl: 'https://alldone.app/task',
                    },
                },
            },
            { insert: '\nAfter\n' },
        ])

        const embed = quill.root.querySelector('span.ql-taskTagFormat')
        expect(visibleText(embed)).toContain('Ship the release notes')

        mockFailNextTaskRender = true
        ReactDOM.unstable_batchedUpdates(() => mockTriggerTaskRender())

        expect(visibleText(embed)).toContain('Loading task...')
        expect(quill.getContents().ops.some(op => op.insert?.taskTagFormat?.taskId === 'task-1')).toBe(true)

        ReactDOM.unstable_batchedUpdates(() => {
            jest.advanceTimersByTime(TASK_TAG_RENDER_RETRY_DELAY)
        })

        expect(visibleText(embed)).toContain('Ship the release notes')
        expect(quill.root.querySelector('span.ql-taskTagFormat')).toBe(embed)
    })
})
