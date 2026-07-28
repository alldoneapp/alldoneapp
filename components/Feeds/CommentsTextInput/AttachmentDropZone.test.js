/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Platform, Text } from 'react-native'

import AttachmentDropZone, { addDroppedFilesToEditor } from './AttachmentDropZone'
import { insertAttachmentInsideEditor } from './textInputHelper'
import { checkIsLimitedByTraffic } from '../../Premium/PremiumHelper'

jest.mock('./textInputHelper', () => ({
    insertAttachmentInsideEditor: jest.fn(),
}))

jest.mock('../../Premium/PremiumHelper', () => ({
    checkIsLimitedByTraffic: jest.fn(() => false),
}))

jest.mock('../../../i18n/TranslationService', () => ({
    translate: text => text,
}))

jest.mock('../../styles/global', () => ({
    colors: { UtilityBlue125: '#0066ff' },
}))

describe('AttachmentDropZone', () => {
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
        global.URL.createObjectURL = jest.fn(file => `blob:${file.name}`)
    })

    it('adds every dropped image and file through the existing editor attachment path', () => {
        const editor = { focus: jest.fn() }
        const setInputCursorIndex = jest.fn()
        const files = [
            { name: 'first image.png', size: 1024 },
            { name: 'second.jpg', size: 2048 },
            { name: 'notes.pdf', size: 1024 },
        ]

        const addedFiles = addDroppedFilesToEditor({
            files,
            editor,
            inputCursorIndex: 7,
            setInputCursorIndex,
        })

        expect(addedFiles).toEqual(files)
        expect(insertAttachmentInsideEditor).toHaveBeenNthCalledWith(
            1,
            7,
            editor,
            'first_image.png',
            'blob:first image.png'
        )
        expect(insertAttachmentInsideEditor).toHaveBeenNthCalledWith(2, 10, editor, 'second.jpg', 'blob:second.jpg')
        expect(insertAttachmentInsideEditor).toHaveBeenNthCalledWith(3, 13, editor, 'notes.pdf', 'blob:notes.pdf')
        expect(setInputCursorIndex).toHaveBeenCalledWith(16)
        expect(editor.focus).toHaveBeenCalled()
        expect(global.alert).not.toHaveBeenCalled()
    })

    it('shows drag feedback, prevents browser file navigation, and inserts the drop', () => {
        const editor = { focus: jest.fn() }
        const file = { name: 'screen.webp', size: 1024 }
        const dataTransfer = { files: [file], types: ['Files'], dropEffect: 'none' }
        const dragEvent = {
            dataTransfer,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        }
        let tree

        act(() => {
            tree = renderer.create(
                <AttachmentDropZone testID="drop-zone" editor={editor} inputCursorIndex={0} projectId="project-1">
                    <Text>Message</Text>
                </AttachmentDropZone>
            )
        })

        const getDropZone = () => tree.root.findByProps({ 'data-testid': 'drop-zone' })

        act(() => getDropZone().props.onDragEnter(dragEvent))

        expect(dragEvent.preventDefault).toHaveBeenCalled()
        expect(dragEvent.stopPropagation).toHaveBeenCalled()
        expect(dataTransfer.dropEffect).toBe('copy')
        expect(tree.root.findByProps({ testID: 'attachment-drop-feedback' })).toBeTruthy()

        act(() => getDropZone().props.onDrop(dragEvent))

        expect(checkIsLimitedByTraffic).toHaveBeenCalledWith('project-1')
        expect(insertAttachmentInsideEditor).toHaveBeenCalledWith(0, editor, 'screen.webp', 'blob:screen.webp')
        expect(tree.root.findAllByProps({ testID: 'attachment-drop-feedback' })).toHaveLength(0)
    })

    it('blocks oversized files using the same limit as click-to-upload', () => {
        const editor = { focus: jest.fn() }

        const addedFiles = addDroppedFilesToEditor({
            files: [{ name: 'huge.zip', size: 51 * 1024 * 1024 }],
            editor,
        })

        expect(addedFiles).toEqual([])
        expect(insertAttachmentInsideEditor).not.toHaveBeenCalled()
        expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('File size exceeds'))
    })

    it('still prevents browser navigation while the editor is unavailable', () => {
        const file = { name: 'screen.png', size: 1024 }
        const dropEvent = {
            dataTransfer: { files: [file], types: ['Files'] },
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        }
        let tree

        act(() => {
            tree = renderer.create(
                <AttachmentDropZone testID="drop-zone" projectId="project-1">
                    <Text>Message</Text>
                </AttachmentDropZone>
            )
        })

        act(() => tree.root.findByProps({ 'data-testid': 'drop-zone' }).props.onDrop(dropEvent))

        expect(dropEvent.preventDefault).toHaveBeenCalled()
        expect(dropEvent.stopPropagation).toHaveBeenCalled()
        expect(insertAttachmentInsideEditor).not.toHaveBeenCalled()
    })
})
