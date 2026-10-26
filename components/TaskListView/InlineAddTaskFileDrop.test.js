/**
 * @jest-environment jsdom
 */

// AT-2875: dropping a file on the inline "Add new task" line opens the add-task popup with that
// file attached, carrying the line's context and the inline draft title. These tests dispatch a
// REAL `drop` through react-dom at a node standing in for the inline editor's Quill root, which
// also has its own native `drop` listener (Quill's uploader): only a capture-phase claim keeps
// that listener from inserting a base64 image into the task title.

import React, { act } from 'react'
import { Platform } from 'react-native'
import { createRoot } from 'react-dom/client'

const mockDispatch = jest.fn()
let mockState = {}

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('../../redux/store', () => ({ getState: () => mockState, dispatch: jest.fn() }))
jest.mock('../../redux/actions', () => ({
    setTmpInputTextTask: text => ({ type: 'setTmpInputTextTask', text }),
    unsetAddTaskRepeatMode: () => ({ type: 'unsetAddTaskRepeatMode' }),
    showFloatPopup: () => ({ type: 'showFloatPopup' }),
    hideFloatPopup: () => ({ type: 'hideFloatPopup' }),
    startTaskEditor: () => ({ type: 'startTaskEditor' }),
    finishTaskEditor: () => ({ type: 'finishTaskEditor' }),
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../ModalsManager/modalsManager', () => ({ MENTION_MODAL_ID: 'mentions' }))
jest.mock('../../utils/SharedHelper', () => ({ accessGranted: (user, projectId) => !user.noAccess }))
jest.mock('./Utils/TasksHelper', () => ({ BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER }))
jest.mock('../../hooks/useModalSizing', () => () => ({ maxHeight: 600, isSheet: false }))
jest.mock('../../hooks/useLiftAboveKeyboard', () => () => 0)

const mockCheckIsLimitedByTraffic = jest.fn(() => false)
jest.mock('../Premium/PremiumHelper', () => ({
    checkIsLimitedByTraffic: (...args) => mockCheckIsLimitedByTraffic(...args),
}))

const mockPopupProps = []
jest.mock('../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal', () => {
    const React = require('react')
    return props => {
        mockPopupProps.push(props)
        return React.createElement('div', { 'data-testid': 'create-task-popup' })
    }
})

// The real AppPopover positions a portal; what matters here is only whether it is open.
jest.mock('../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    return ({ children, content, isOpen, onClickOutside }) =>
        React.createElement(
            React.Fragment,
            null,
            children,
            isOpen
                ? React.createElement(
                      'div',
                      { 'data-testid': 'popover' },
                      content,
                      React.createElement('button', { 'data-testid': 'outside', onClick: onClickOutside })
                  )
                : null
        )
})

import InlineAddTaskFileDrop, { getDroppedTaskDueDate, getDroppedTaskGoalSource } from './InlineAddTaskFileDrop'
import { FEED_GOAL_OBJECT_TYPE, FEED_TASK_OBJECT_TYPE } from '../Feeds/Utils/FeedsConstants'

const lastPopupProps = () => mockPopupProps[mockPopupProps.length - 1]

const dropEvent = (files, types = ['Files']) => {
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files, types, dropEffect: 'none' } })
    return event
}

describe('InlineAddTaskFileDrop (AT-2875)', () => {
    const originalPlatform = Platform.OS
    let host
    let root
    let editorDrop

    beforeAll(() => {
        Platform.OS = 'web'
        global.IS_REACT_ACT_ENVIRONMENT = true
    })
    afterAll(() => {
        Platform.OS = originalPlatform
    })

    beforeEach(() => {
        mockState = {
            tmpInputTextTask: '',
            addTaskRepeatMode: false,
            isQuillTagEditorOpen: false,
            openModals: {},
            loggedUser: {},
        }
        mockDispatch.mockClear()
        mockCheckIsLimitedByTraffic.mockReset()
        mockCheckIsLimitedByTraffic.mockReturnValue(false)
        mockPopupProps.length = 0
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
        editorDrop = jest.fn()
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const render = (props = {}) => {
        act(() => {
            root.render(
                <InlineAddTaskFileDrop projectId="project-1" enabled={true} defaultDate={Date.now()} {...props}>
                    <div data-testid="inline-editor" />
                </InlineAddTaskFileDrop>
            )
        })
        const editor = host.querySelector('[data-testid="inline-editor"]')
        editor.addEventListener('drop', editorDrop)
        return editor
    }

    const drop = (target, files, types) => {
        const event = dropEvent(files, types)
        act(() => {
            target.dispatchEvent(event)
        })
        return event
    }

    test('a file drop opens the popup with the file, without reaching the inline editor', () => {
        const editor = render()
        const files = [
            { name: 'photo.png', size: 10 },
            { name: 'brief.pdf', size: 10 },
        ]

        const event = drop(editor, files)

        expect(event.defaultPrevented).toBe(true)
        expect(editorDrop).not.toHaveBeenCalled()
        expect(host.querySelector('[data-testid="create-task-popup"]')).not.toBeNull()
        expect(lastPopupProps()).toMatchObject({
            initialProjectId: 'project-1',
            fromTaskList: true,
            initialFiles: files,
            initialTaskName: '',
            sourceType: FEED_TASK_OBJECT_TYPE,
        })
        expect(mockCheckIsLimitedByTraffic).toHaveBeenCalledWith('project-1')
    })

    test('hands over the typed inline text and closes the open inline editor without creating', () => {
        mockState.tmpInputTextTask = 'Call the notary  '
        mockState.addTaskRepeatMode = true
        const inlineEditorRef = { current: { modalIsVisible: () => true, closeModal: jest.fn() } }
        const editor = render({ inlineEditorRef })

        drop(editor, [{ name: 'deed.pdf', size: 10 }])

        expect(inlineEditorRef.current.closeModal).toHaveBeenCalledWith(false, true)
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'unsetAddTaskRepeatMode' })
        expect(lastPopupProps().initialTaskName).toBe('Call the notary')
        // The draft is only cleared once the popup really submits.
        expect(mockDispatch).not.toHaveBeenCalledWith({ type: 'setTmpInputTextTask', text: '' })
        act(() => lastPopupProps().onDraftSubmitted())
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'setTmpInputTextTask', text: '' })
    })

    test("passes the line's date and goal", () => {
        const goal = { id: 'goal-1', isPublicFor: [0], lockKey: 'lock' }
        const editor = render({ activeGoal: goal, inBacklog: true })

        drop(editor, [{ name: 'a.png', size: 1 }])

        expect(lastPopupProps()).toMatchObject({
            initialDueDate: Number.MAX_SAFE_INTEGER,
            sourceType: FEED_GOAL_OBJECT_TYPE,
            sourceId: 'goal-1',
            sourceIsPublicFor: [0],
            lockKey: 'lock',
        })
    })

    test('leaves text drags to the editor', () => {
        const editor = render()
        const event = drop(editor, [], ['text/plain'])

        expect(event.defaultPrevented).toBe(false)
        expect(editorDrop).toHaveBeenCalledTimes(1)
        expect(host.querySelector('[data-testid="popover"]')).toBeNull()
    })

    test('does nothing when the line does not accept new tasks', () => {
        const editor = render({ enabled: false })
        drop(editor, [{ name: 'a.png', size: 1 }])

        expect(host.querySelector('[data-testid="popover"]')).toBeNull()
        expect(mockCheckIsLimitedByTraffic).not.toHaveBeenCalled()
    })

    test('does nothing for a user without access to the project', () => {
        mockState.loggedUser = { noAccess: true }
        const editor = render()
        const event = drop(editor, [{ name: 'a.png', size: 1 }])

        expect(event.defaultPrevented).toBe(false)
        expect(host.querySelector('[data-testid="popover"]')).toBeNull()
    })

    test('a traffic-limited user gets the limit modal, not an empty popup', () => {
        mockCheckIsLimitedByTraffic.mockReturnValue(true)
        const inlineEditorRef = { current: { modalIsVisible: () => true, closeModal: jest.fn() } }
        const editor = render({ inlineEditorRef })

        drop(editor, [{ name: 'a.png', size: 1 }])

        expect(host.querySelector('[data-testid="popover"]')).toBeNull()
        // The inline editor and its text stay as they were.
        expect(inlineEditorRef.current.closeModal).not.toHaveBeenCalled()
    })

    test('a second drop while the popup is open does not reopen or replace it', () => {
        const editor = render()
        drop(editor, [{ name: 'first.png', size: 1 }])
        const opened = mockPopupProps.length

        drop(editor, [{ name: 'second.png', size: 1 }])

        expect(mockCheckIsLimitedByTraffic).toHaveBeenCalledTimes(1)
        expect(lastPopupProps().initialFiles).toEqual([{ name: 'first.png', size: 1 }])
        expect(mockPopupProps.length).toBeGreaterThanOrEqual(opened)
    })

    test('closing releases the popup and a later drop opens a fresh one', () => {
        const editor = render()
        drop(editor, [{ name: 'first.png', size: 1 }])
        act(() => host.querySelector('[data-testid="outside"]').click())
        expect(host.querySelector('[data-testid="popover"]')).toBeNull()

        drop(editor, [{ name: 'second.png', size: 1 }])
        expect(lastPopupProps().initialFiles).toEqual([{ name: 'second.png', size: 1 }])
    })

    test('stays open while a mention picker inside it is open', () => {
        const editor = render()
        drop(editor, [{ name: 'first.png', size: 1 }])
        mockState = { ...mockState, openModals: { mentions: true } }
        render() // redux would re-render the subscriber on this state change

        act(() => host.querySelector('[data-testid="outside"]').click())

        expect(host.querySelector('[data-testid="popover"]')).not.toBeNull()
    })
})

describe('inline drop context helpers (AT-2875)', () => {
    test('today keeps the popup default; future days and Someday are carried over', () => {
        const now = new Date(2026, 9, 26, 20, 0).valueOf()
        expect(getDroppedTaskDueDate({ defaultDate: new Date(2026, 9, 26, 9).valueOf(), now })).toBeUndefined()
        const future = new Date(2026, 9, 30).valueOf()
        expect(getDroppedTaskDueDate({ defaultDate: future, now })).toBe(future)
        expect(getDroppedTaskDueDate({ inBacklog: true, defaultDate: future, now })).toBe(Number.MAX_SAFE_INTEGER)
        expect(getDroppedTaskDueDate({ defaultDate: undefined, now })).toBeUndefined()
    })

    test('a goal becomes the popup goal source, no goal stays a plain task', () => {
        expect(getDroppedTaskGoalSource(null)).toEqual({ sourceType: FEED_TASK_OBJECT_TYPE })
        expect(getDroppedTaskGoalSource({ id: 'g', isPublicFor: [0], lockKey: '' })).toEqual({
            sourceType: FEED_GOAL_OBJECT_TYPE,
            sourceId: 'g',
            sourceIsPublicFor: [0],
            lockKey: '',
        })
    })
})
