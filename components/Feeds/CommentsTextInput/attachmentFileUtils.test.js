/**
 * @jest-environment jsdom
 */
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))

import { addFilesAsAttachments, ATTACHMENT_FILE_SIZE_LIMIT_MB, openAttachmentFilePicker } from './attachmentFileUtils'

describe('openAttachmentFilePicker (AT-2365)', () => {
    let input

    beforeEach(() => {
        document.body.innerHTML = ''
        input = document.createElement('input')
        input.type = 'file'
        input.id = 'file-input'
        input.click = jest.fn()
        document.body.appendChild(input)
    })

    it('lets a surface opt in to picking several files at once', () => {
        openAttachmentFilePicker({ multiple: true, onFiles: jest.fn() })

        expect(input.multiple).toBe(true)
        expect(input.click).toHaveBeenCalled()
    })

    it('defaults to a single file, so surfaces that cannot order a batch are unchanged', () => {
        openAttachmentFilePicker({ onFiles: jest.fn() })

        expect(input.multiple).toBe(false)
    })

    it('resets the shared input on every open rather than inheriting the last surface', () => {
        openAttachmentFilePicker({ multiple: true, onFiles: jest.fn() })
        openAttachmentFilePicker({ multiple: false, onFiles: jest.fn() })

        expect(input.multiple).toBe(false)
    })

    it('hands every selected file to the caller, in selection order', () => {
        const onFiles = jest.fn()
        openAttachmentFilePicker({ multiple: true, onFiles })

        const files = [{ name: 'a.png' }, { name: 'b.png' }]
        input.onchange({ target: { files } })

        expect(onFiles).toHaveBeenCalledWith(files)
    })

    it('reports rather than throws when the surface renders no file input', () => {
        document.body.innerHTML = ''
        expect(openAttachmentFilePicker({ onFiles: jest.fn() })).toBe(false)
    })
})

describe('addFilesAsAttachments', () => {
    beforeEach(() => {
        global.alert = jest.fn()
        global.URL.createObjectURL = jest.fn(file => `blob:${file.name}`)
    })

    it('adds every file in order and strips whitespace from names', () => {
        const added = []
        const files = [
            { name: 'first shot.png', size: 10 },
            { name: 'second.png', size: 10 },
        ]

        const result = addFilesAsAttachments(files, (name, uri) => added.push([name, uri]))

        expect(added).toEqual([
            ['first_shot.png', 'blob:first shot.png'],
            ['second.png', 'blob:second.png'],
        ])
        expect(result).toEqual(files)
    })

    it('skips only the oversized file and keeps the rest of the batch', () => {
        const added = []
        const files = [
            { name: 'ok.png', size: 10 },
            { name: 'huge.png', size: (ATTACHMENT_FILE_SIZE_LIMIT_MB + 5) * 1024 * 1024 },
            { name: 'fine.png', size: 10 },
        ]

        const result = addFilesAsAttachments(files, name => added.push(name))

        expect(added).toEqual(['ok.png', 'fine.png'])
        expect(result).toHaveLength(2)
        expect(global.alert).toHaveBeenCalledTimes(1)
    })
})
