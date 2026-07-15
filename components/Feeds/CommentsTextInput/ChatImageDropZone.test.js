/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Platform, Text } from 'react-native'

import ChatImageDropZone, { addDroppedImagesToEditor } from './ChatImageDropZone'
import { insertAttachmentInsideEditor } from './textInputHelper'
import { checkIsLimitedByTraffic } from '../../Premium/PremiumHelper'

jest.mock('./textInputHelper', () => ({
    fileIsImage: fileName => ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'].includes(fileName.split('.').pop()),
    imageExtensionsSupported: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'],
    insertAttachmentInsideEditor: jest.fn(),
}))

jest.mock('../../Premium/PremiumHelper', () => ({
    checkIsLimitedByTraffic: jest.fn(() => false),
}))

jest.mock('../../../i18n/TranslationService', () => ({
    translate: (text, values = {}) => `${text}${values.formats ? `: ${values.formats}` : ''}`,
}))

jest.mock('../../styles/global', () => ({
    colors: { UtilityBlue125: '#0066ff' },
}))

describe('ChatImageDropZone', () => {
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

    it('adds every supported dropped image through the existing editor attachment path', () => {
        const editor = { focus: jest.fn() }
        const setInputCursorIndex = jest.fn()
        const files = [
            { name: 'first image.png', size: 1024 },
            { name: 'second.jpg', size: 2048 },
            { name: 'notes.pdf', size: 1024 },
        ]

        const addedFiles = addDroppedImagesToEditor({
            files,
            editor,
            inputCursorIndex: 7,
            setInputCursorIndex,
        })

        expect(addedFiles).toEqual(files.slice(0, 2))
        expect(insertAttachmentInsideEditor).toHaveBeenNthCalledWith(
            1,
            7,
            editor,
            'first_image.png',
            'blob:first image.png'
        )
        expect(insertAttachmentInsideEditor).toHaveBeenNthCalledWith(2, 10, editor, 'second.jpg', 'blob:second.jpg')
        expect(setInputCursorIndex).toHaveBeenCalledWith(13)
        expect(editor.focus).toHaveBeenCalled()
        expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Unsupported dropped image format'))
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
                <ChatImageDropZone testID="drop-zone" editor={editor} inputCursorIndex={0} projectId="project-1">
                    <Text>Message</Text>
                </ChatImageDropZone>
            )
        })

        const getDropZone = () => tree.root.findByProps({ 'data-testid': 'drop-zone' })

        act(() => getDropZone().props.onDragEnter(dragEvent))

        expect(dragEvent.preventDefault).toHaveBeenCalled()
        expect(dragEvent.stopPropagation).toHaveBeenCalled()
        expect(dataTransfer.dropEffect).toBe('copy')
        expect(tree.root.findByProps({ testID: 'chat-image-drop-feedback' })).toBeTruthy()

        act(() => getDropZone().props.onDrop(dragEvent))

        expect(checkIsLimitedByTraffic).toHaveBeenCalledWith('project-1')
        expect(insertAttachmentInsideEditor).toHaveBeenCalledWith(0, editor, 'screen.webp', 'blob:screen.webp')
        expect(tree.root.findAllByProps({ testID: 'chat-image-drop-feedback' })).toHaveLength(0)
    })

    it('blocks oversized images using the same limit as click-to-upload', () => {
        const editor = { focus: jest.fn() }

        const addedFiles = addDroppedImagesToEditor({
            files: [{ name: 'huge.gif', size: 51 * 1024 * 1024 }],
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
                <ChatImageDropZone testID="drop-zone" projectId="project-1">
                    <Text>Message</Text>
                </ChatImageDropZone>
            )
        })

        act(() => tree.root.findByProps({ 'data-testid': 'drop-zone' }).props.onDrop(dropEvent))

        expect(dropEvent.preventDefault).toHaveBeenCalled()
        expect(dropEvent.stopPropagation).toHaveBeenCalled()
        expect(insertAttachmentInsideEditor).not.toHaveBeenCalled()
    })
})
