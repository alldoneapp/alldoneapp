/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Platform, Text } from 'react-native'

import TaskFileDropZone from './TaskFileDropZone'
import { addDroppedFilesToTaskDescription } from './taskFileDropHelper'
import { checkIsLimitedByTraffic } from '../../../Premium/PremiumHelper'

jest.mock('./taskFileDropHelper', () => ({
    addDroppedFilesToTaskDescription: jest.fn(() => Promise.resolve({ addedCount: 1, failedCount: 0 })),
}))

jest.mock('../../../Premium/PremiumHelper', () => ({
    checkIsLimitedByTraffic: jest.fn(() => false),
}))

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: text => text,
}))

jest.mock('../../../UIComponents/Spinner', () => 'Spinner')

const task = { id: 'task-1', description: 'Existing' }

const buildDragEvent = (files = [], types = ['Files']) => ({
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    dataTransfer: { files, types, dropEffect: 'none' },
})

const renderZone = (props = {}) =>
    renderer.create(
        <TaskFileDropZone projectId="project-1" task={task} {...props}>
            <Text>row</Text>
        </TaskFileDropZone>
    )

const findDropDiv = tree => tree.root.findByType('div')

const feedback = tree => tree.root.findAllByProps({ testID: 'task-file-drop-feedback' })

describe('TaskFileDropZone', () => {
    const originalPlatform = Platform.OS

    beforeAll(() => {
        Platform.OS = 'web'
    })

    afterAll(() => {
        Platform.OS = originalPlatform
    })

    beforeEach(() => {
        jest.clearAllMocks()
        global.alert = jest.fn()
        checkIsLimitedByTraffic.mockReturnValue(false)
        addDroppedFilesToTaskDescription.mockResolvedValue({ addedCount: 1, failedCount: 0 })
    })

    it('adds dropped files to the task description', async () => {
        const tree = renderZone()
        const files = [{ name: 'photo.png', size: 10 }]
        const event = buildDragEvent(files)

        await act(async () => {
            await findDropDiv(tree).props.onDrop(event)
        })

        expect(addDroppedFilesToTaskDescription).toHaveBeenCalledWith({
            projectId: 'project-1',
            task,
            files,
        })
    })

    it('shows the drop hint while files are dragged over the row and clears it on leave', () => {
        const tree = renderZone()
        const div = findDropDiv(tree)

        expect(feedback(tree)).toHaveLength(0)

        act(() => {
            div.props.onDragEnter(buildDragEvent())
        })
        expect(feedback(tree)).toHaveLength(1)

        act(() => {
            div.props.onDragLeave(buildDragEvent())
        })
        expect(feedback(tree)).toHaveLength(0)
    })

    it('only clears the hint once the drag has left every nested element', () => {
        const tree = renderZone()
        const div = findDropDiv(tree)

        act(() => {
            div.props.onDragEnter(buildDragEvent())
            div.props.onDragEnter(buildDragEvent())
        })
        act(() => {
            div.props.onDragLeave(buildDragEvent())
        })

        // Entering a child fires enter-then-leave pairs; the row must stay highlighted.
        expect(feedback(tree)).toHaveLength(1)
    })

    it('still clears the hint when the browser reports no types on dragleave', () => {
        const tree = renderZone()
        const div = findDropDiv(tree)

        act(() => {
            div.props.onDragEnter(buildDragEvent())
        })
        act(() => {
            // Some browsers omit `types` on dragleave; keying the counter on it would strand the
            // overlay on the row for the rest of the session.
            div.props.onDragLeave(buildDragEvent([], []))
        })

        expect(feedback(tree)).toHaveLength(0)
    })

    it('ignores a dragleave it never saw a matching dragenter for', () => {
        const tree = renderZone()
        const event = buildDragEvent()

        act(() => {
            findDropDiv(tree).props.onDragLeave(event)
        })

        expect(event.preventDefault).not.toHaveBeenCalled()
    })

    it('swallows the browser default for any file drag so the page cannot navigate away', () => {
        const tree = renderZone()
        const div = findDropDiv(tree)
        const event = buildDragEvent()

        act(() => {
            div.props.onDragOver(event)
        })

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(event.dataTransfer.dropEffect).toBe('copy')
    })

    it('still blocks browser navigation on a row that cannot accept the drop, without swallowing it', () => {
        const tree = renderZone({ disabled: true })
        const event = buildDragEvent([{ name: 'photo.png', size: 10 }])

        act(() => {
            findDropDiv(tree).props.onDragOver(event)
        })

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.dataTransfer.dropEffect).toBe('none')
        // A task row is rendered inside the rich comment popup, which owns a drop zone above us.
        // Stopping propagation here would silently break dropping a file into that comment.
        expect(event.stopPropagation).not.toHaveBeenCalled()
    })

    it('ignores drags that carry no files, leaving text/element drags alone', () => {
        const tree = renderZone()
        const div = findDropDiv(tree)
        const event = buildDragEvent([], ['text/plain'])

        act(() => {
            div.props.onDragEnter(event)
            div.props.onDragOver(event)
        })

        expect(event.preventDefault).not.toHaveBeenCalled()
        expect(feedback(tree)).toHaveLength(0)
    })

    it('does nothing when the row is disabled', async () => {
        const tree = renderZone({ disabled: true })

        await act(async () => {
            await findDropDiv(tree).props.onDrop(buildDragEvent([{ name: 'photo.png', size: 10 }]))
        })

        expect(addDroppedFilesToTaskDescription).not.toHaveBeenCalled()
    })

    it('does nothing when the project is over its traffic quota', async () => {
        checkIsLimitedByTraffic.mockReturnValue(true)
        const tree = renderZone()

        await act(async () => {
            await findDropDiv(tree).props.onDrop(buildDragEvent([{ name: 'photo.png', size: 10 }]))
        })

        expect(addDroppedFilesToTaskDescription).not.toHaveBeenCalled()
    })

    it('warns when a file could not be uploaded', async () => {
        addDroppedFilesToTaskDescription.mockResolvedValue({ addedCount: 0, failedCount: 1 })
        const tree = renderZone()

        await act(async () => {
            await findDropDiv(tree).props.onDrop(buildDragEvent([{ name: 'photo.png', size: 10 }]))
        })

        expect(global.alert).toHaveBeenCalledWith('Task attachment upload failed')
    })

    it('warns instead of leaving an unhandled rejection when the whole drop throws', async () => {
        addDroppedFilesToTaskDescription.mockRejectedValue(new Error('boom'))
        const tree = renderZone()

        await act(async () => {
            await findDropDiv(tree).props.onDrop(buildDragEvent([{ name: 'photo.png', size: 10 }]))
        })

        expect(global.alert).toHaveBeenCalledWith('Task attachment upload failed')
    })

    it('shows an upload indicator while the drop is in flight and hides it afterwards', async () => {
        let resolveUpload
        addDroppedFilesToTaskDescription.mockReturnValue(
            new Promise(resolve => {
                resolveUpload = resolve
            })
        )
        const tree = renderZone()

        let dropPromise
        await act(async () => {
            dropPromise = findDropDiv(tree).props.onDrop(buildDragEvent([{ name: 'photo.png', size: 10 }]))
        })

        expect(feedback(tree)).toHaveLength(1)
        expect(tree.root.findAllByType('Spinner')).toHaveLength(1)

        await act(async () => {
            resolveUpload({ addedCount: 1, failedCount: 0 })
            await dropPromise
        })

        expect(feedback(tree)).toHaveLength(0)
    })

    it('never lets its feedback overlay swallow a click on the row', () => {
        const tree = renderZone()

        act(() => {
            findDropDiv(tree).props.onDragEnter(buildDragEvent())
        })

        expect(feedback(tree)[0].props.pointerEvents).toBe('none')
    })

    it('renders no drag handlers outside the web platform', () => {
        Platform.OS = 'ios'
        const tree = renderZone()
        // react-native-web still renders host divs for every View, so assert on the handlers.
        expect(tree.root.findAll(node => !!node.props.onDrop || !!node.props.onDragOver)).toHaveLength(0)
        Platform.OS = 'web'
    })
})
