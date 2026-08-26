/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Platform, Text } from 'react-native'

import AttachmentDropZone, { addDroppedFilesToEditor } from './AttachmentDropZone'
import { insertFilesAsAttachments } from './textInputHelper'
import { checkIsLimitedByTraffic } from '../../Premium/PremiumHelper'

// The per-file cursor stepping now lives in `insertFilesAsAttachments` (AT-2441), shared with
// the paste path; it is driven for real against a Quill document in
// attachmentDropDuplicate.test.js. Here it is a seam, so these stay tests of the drop zone.
jest.mock('./textInputHelper', () => ({
    insertFilesAsAttachments: jest.fn(({ files, startIndex = 0 }) => ({
        addedFiles: Array.from(files || []),
        nextCursorIndex: startIndex + 3 * Array.from(files || []).length,
    })),
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
        expect(insertFilesAsAttachments).toHaveBeenCalledWith({ files, editor, startIndex: 7 })
        expect(setInputCursorIndex).toHaveBeenCalledWith(16)
        expect(editor.focus).toHaveBeenCalled()
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

        act(() => getDropZone().props.onDropCapture(dragEvent))

        expect(checkIsLimitedByTraffic).toHaveBeenCalledWith('project-1')
        expect(insertFilesAsAttachments).toHaveBeenCalledWith({ files: [file], editor, startIndex: 0 })
        expect(tree.root.findAllByProps({ testID: 'attachment-drop-feedback' })).toHaveLength(0)
    })

    // The 50 MB guard itself lives in `addFilesAsAttachments` and is pinned in
    // attachmentFileUtils.test.js; what matters here is that a drop which added nothing
    // leaves the composer alone.
    it('does not move the cursor or steal focus when nothing was added', () => {
        const editor = { focus: jest.fn() }
        const setInputCursorIndex = jest.fn()
        insertFilesAsAttachments.mockReturnValueOnce({ addedFiles: [], nextCursorIndex: 4 })

        const addedFiles = addDroppedFilesToEditor({
            files: [{ name: 'huge.zip', size: 51 * 1024 * 1024 }],
            editor,
            inputCursorIndex: 4,
            setInputCursorIndex,
        })

        expect(addedFiles).toEqual([])
        expect(setInputCursorIndex).not.toHaveBeenCalled()
        expect(editor.focus).not.toHaveBeenCalled()
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

        act(() => tree.root.findByProps({ 'data-testid': 'drop-zone' }).props.onDropCapture(dropEvent))

        expect(dropEvent.preventDefault).toHaveBeenCalled()
        expect(dropEvent.stopPropagation).toHaveBeenCalled()
        expect(insertFilesAsAttachments).not.toHaveBeenCalled()
    })
})
