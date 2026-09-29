/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Platform, Text } from 'react-native'
import { createRoot } from 'react-dom/client'
import { act as domAct } from 'react'

import CreateTaskFileDropZone from './CreateTaskFileDropZone'

jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))

const eventFor = (files, types = ['Files']) => ({
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    dataTransfer: { files, types, dropEffect: 'none' },
})

describe('CreateTaskFileDropZone', () => {
    const originalPlatform = Platform.OS

    beforeAll(() => {
        Platform.OS = 'web'
    })
    afterAll(() => {
        Platform.OS = originalPlatform
    })

    it('claims image drops in capture before the Quill title editor and forwards every file', () => {
        const onFilesDropped = jest.fn()
        const tree = renderer.create(
            <CreateTaskFileDropZone onFilesDropped={onFilesDropped}>
                <Text>Task title</Text>
            </CreateTaskFileDropZone>
        )
        const zone = tree.root.findByProps({ 'data-testid': 'create-task-file-drop-zone' })
        const files = [{ name: 'first.png' }, { name: 'second.jpg' }]
        const event = eventFor(files)

        act(() => zone.props.onDragEnter(eventFor([])))
        expect(tree.root.findAllByProps({ testID: 'create-task-file-drop-feedback' })).toHaveLength(1)

        act(() => zone.props.onDropCapture(event))
        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(onFilesDropped).toHaveBeenCalledWith(files)
        expect(tree.root.findAllByProps({ testID: 'create-task-file-drop-feedback' })).toHaveLength(0)
        expect(zone.props.onDrop).toBeUndefined()
    })

    it('stops a real drop before a native editor listener can insert the image in the title', () => {
        const host = document.createElement('div')
        document.body.appendChild(host)
        const root = createRoot(host)
        const onFilesDropped = jest.fn()

        domAct(() => {
            root.render(
                <CreateTaskFileDropZone onFilesDropped={onFilesDropped}>
                    <div data-testid="title-editor" />
                </CreateTaskFileDropZone>
            )
        })

        const editor = host.querySelector('[data-testid="title-editor"]')
        const nativeEditorDrop = jest.fn()
        editor.addEventListener('drop', nativeEditorDrop)
        const event = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', {
            value: { files: [{ name: 'photo.png' }], types: ['Files'], dropEffect: 'none' },
        })

        domAct(() => editor.dispatchEvent(event))
        expect(onFilesDropped).toHaveBeenCalledTimes(1)
        expect(nativeEditorDrop).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(true)

        domAct(() => root.unmount())
        host.remove()
    })

    it('leaves text drags alone and clears feedback even when dragleave omits types', () => {
        const onFilesDropped = jest.fn()
        const tree = renderer.create(
            <CreateTaskFileDropZone onFilesDropped={onFilesDropped}>
                <Text>Task title</Text>
            </CreateTaskFileDropZone>
        )
        const zone = tree.root.findByProps({ 'data-testid': 'create-task-file-drop-zone' })
        const textDrag = eventFor([], ['text/plain'])

        act(() => zone.props.onDropCapture(textDrag))
        expect(textDrag.preventDefault).not.toHaveBeenCalled()
        expect(onFilesDropped).not.toHaveBeenCalled()

        act(() => zone.props.onDragEnter(eventFor([])))
        act(() => zone.props.onDragLeave(eventFor([], [])))
        expect(tree.root.findAllByProps({ testID: 'create-task-file-drop-feedback' })).toHaveLength(0)
    })
})
