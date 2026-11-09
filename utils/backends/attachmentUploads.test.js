/**
 * NV-38 (security audit 2026-11) — uploads into feedAttachments/ and notesAttachments/ are bound
 * to their uploader. storage.rules refuses a create without `customMetadata.uploaderId` equal to
 * the caller, and lets only that uploader resolve, replace or delete the object afterwards. A put
 * that forgets the metadata does not fail loudly in development (the emulator may run open
 * rules); it fails in production, so the metadata and the call sites are pinned here.
 */

const fs = require('fs')
const path = require('path')

const {
    ATTACHMENT_UPLOAD_FOLDERS,
    buildAttachmentUploadMetadata,
    putAttachmentAsUploader,
} = require('./attachmentUploads')

const makeStorageRoot = () => {
    const refs = {}
    return {
        refs,
        child: jest.fn(objectPath => {
            refs[objectPath] = {
                put: jest.fn(() => Promise.resolve()),
                getDownloadURL: jest.fn(() => Promise.resolve(`https://download/${objectPath}?token=t`)),
            }
            return refs[objectPath]
        }),
    }
}

describe('attachment uploads carry their uploader', () => {
    it('builds the custom metadata storage.rules checks', () => {
        expect(buildAttachmentUploadMetadata('u1')).toEqual({ customMetadata: { uploaderId: 'u1' } })
    })

    it('refuses to build metadata without a uid, rather than uploading an orphan', () => {
        expect(() => buildAttachmentUploadMetadata(undefined)).toThrow()
        expect(() => buildAttachmentUploadMetadata('')).toThrow()
    })

    it('puts with the uploader metadata and resolves the URL only after the put', async () => {
        const root = makeStorageRoot()
        const file = { name: 'a.png' }

        const url = await putAttachmentAsUploader(root, 'feedAttachments/01112026/h1/a.png', file, 'u1')

        const ref = root.refs['feedAttachments/01112026/h1/a.png']
        expect(ref.put).toHaveBeenCalledWith(file, { customMetadata: { uploaderId: 'u1' } })
        expect(ref.put.mock.invocationCallOrder[0]).toBeLessThan(ref.getDownloadURL.mock.invocationCallOrder[0])
        expect(url).toBe('https://download/feedAttachments/01112026/h1/a.png?token=t')
    })

    it('only writes into the two uploader-bound folders', async () => {
        const root = makeStorageRoot()
        expect(ATTACHMENT_UPLOAD_FOLDERS).toEqual(['feedAttachments', 'notesAttachments'])
        await expect(putAttachmentAsUploader(root, 'attachments/c1/a.png', {}, 'u1')).rejects.toThrow()
        await expect(putAttachmentAsUploader(root, 'Invoice/u1/x.pdf', {}, 'u1')).rejects.toThrow()
        expect(root.child).not.toHaveBeenCalled()
    })
})

describe('client call sites', () => {
    const repo = path.resolve(__dirname, '../..')
    const firestoreSource = fs.readFileSync(path.join(repo, 'utils/backends/firestore.js'), 'utf8')

    const functionBody = name => {
        const start = firestoreSource.indexOf(`export async function ${name}(`)
        expect(start).toBeGreaterThan(-1)
        return firestoreSource.slice(start, firestoreSource.indexOf('\n}\n', start))
    }

    it.each(['storeAttachment', 'storeConvertedVideos'])('%s uploads through putAttachmentAsUploader', name => {
        const body = functionBody(name)
        expect(body).toContain('putAttachmentAsUploader(')
        expect(body).not.toMatch(/\.put\(/)
    })

    it('no client code puts into an attachment folder directly', () => {
        const offenders = []
        const walk = dir => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (
                    [
                        'node_modules',
                        'functions',
                        'web-build',
                        'browser-tests',
                        'migration',
                        '.claude',
                        '.git',
                    ].includes(entry.name)
                )
                    continue
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) walk(full)
                else if (/\.js$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) {
                    const source = fs.readFileSync(full, 'utf8')
                    if (/(feedAttachments|notesAttachments|['`]attachments)\//.test(source) && /\.put\(/.test(source)) {
                        const allowed = ['utils/backends/firestore.js', 'utils/backends/attachmentUploads.js']
                        if (!allowed.includes(path.relative(repo, full))) offenders.push(full)
                    }
                }
            }
        }
        ;['utils', 'components', 'hooks', 'redux', 'URLSystem'].forEach(dir => walk(path.join(repo, dir)))
        expect(offenders).toEqual([])
    })

    it('the dead comment-attachment client (uploadAttachments / getAttachments) stays gone', () => {
        // storage.rules gives clients no access to attachments/ at all; only the VM runner writes it.
        expect(firestoreSource).not.toMatch(/ref\(`attachments\//)
        expect(firestoreSource).not.toMatch(/export async function (uploadAttachments|getAttachments)\(/)
    })
})
