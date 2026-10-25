import { deflateRawSync } from 'zlib'

import { MAX_ENTRY_INFLATED_BYTES, readSkillArchiveEntries, SkillArchiveError, ZIP_ENTRY_LIMIT } from './skillArchive'

// jsdom exposes neither DecompressionStream nor the web streams it needs, but
// the module under test is only worth anything if the REAL inflate path runs —
// a stubbed decompressor would green-light a broken data offset. Node's own
// implementation is the same spec surface a browser provides.
const webStreams = require('node:stream/web')
if (typeof global.DecompressionStream === 'undefined') {
    global.DecompressionStream = webStreams.DecompressionStream
}

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const EOCD_SIZE = 22

const STORED = 0
const DEFLATE = 8

/**
 * Build a real ZIP byte-for-byte rather than mocking the reader's input.
 * The whole point of the module is that it walks a binary layout correctly, so
 * the fixture has to be that layout.
 */
function buildZip(files, { method = DEFLATE, flags = 0, comment = '' } = {}) {
    const encoder = new TextEncoder()
    const parts = []
    const central = []
    let offset = 0

    for (const file of files) {
        const nameBytes = encoder.encode(file.path)
        const contentBytes = file.bytes || encoder.encode(file.content || '')
        const entryMethod = file.method === undefined ? method : file.method
        const compressed =
            entryMethod === DEFLATE ? new Uint8Array(deflateRawSync(Buffer.from(contentBytes))) : contentBytes

        const localHeader = new Uint8Array(LOCAL_HEADER_SIZE)
        const localView = new DataView(localHeader.buffer)
        localView.setUint32(0, 0x04034b50, true)
        localView.setUint16(4, 20, true)
        localView.setUint16(6, flags, true)
        localView.setUint16(8, entryMethod, true)
        localView.setUint32(18, compressed.length, true)
        localView.setUint32(22, contentBytes.length, true)
        localView.setUint16(26, nameBytes.length, true)
        localView.setUint16(28, 0, true)

        parts.push(localHeader, nameBytes, compressed)

        const centralHeader = new Uint8Array(CENTRAL_HEADER_SIZE)
        const centralView = new DataView(centralHeader.buffer)
        centralView.setUint32(0, 0x02014b50, true)
        centralView.setUint16(6, 20, true)
        centralView.setUint16(8, flags, true)
        centralView.setUint16(10, entryMethod, true)
        centralView.setUint32(20, compressed.length, true)
        centralView.setUint32(24, contentBytes.length, true)
        centralView.setUint16(28, nameBytes.length, true)
        centralView.setUint32(42, offset, true)
        central.push(centralHeader, nameBytes)

        offset += localHeader.length + nameBytes.length + compressed.length
    }

    const centralSize = central.reduce((total, part) => total + part.length, 0)
    const commentBytes = encoder.encode(comment)
    const eocd = new Uint8Array(EOCD_SIZE)
    const eocdView = new DataView(eocd.buffer)
    eocdView.setUint32(0, 0x06054b50, true)
    eocdView.setUint16(8, files.length, true)
    eocdView.setUint16(10, files.length, true)
    eocdView.setUint32(12, centralSize, true)
    eocdView.setUint32(16, offset, true)
    eocdView.setUint16(20, commentBytes.length, true)

    const all = [...parts, ...central, eocd, commentBytes]
    const total = all.reduce((sum, part) => sum + part.length, 0)
    const output = new Uint8Array(total)
    let cursor = 0
    for (const part of all) {
        output.set(part, cursor)
        cursor += part.length
    }
    return output
}

const asText = bytes => new TextDecoder('utf-8').decode(bytes)

describe('readSkillArchiveEntries', () => {
    test('reads deflated entries back to their exact bytes', async () => {
        // Long enough that DEFLATE actually compresses, so the inflate path is exercised.
        const body = 'skill instructions '.repeat(200)
        const archive = buildZip([
            { path: 'pdf-processing/SKILL.md', content: `---\nname: pdf-processing\n---\n${body}` },
            { path: 'pdf-processing/scripts/run.py', content: 'print("hi")' },
        ])

        const entries = await readSkillArchiveEntries(archive)

        expect(entries.map(entry => entry.path)).toEqual(['pdf-processing/SKILL.md', 'pdf-processing/scripts/run.py'])
        expect(asText(entries[0].bytes)).toContain(body)
        expect(asText(entries[1].bytes)).toBe('print("hi")')
        expect(entries[1].size).toBe(11)
    })

    test('reads stored (uncompressed) entries', async () => {
        const archive = buildZip([{ path: 'SKILL.md', content: 'plain' }], { method: STORED })

        const entries = await readSkillArchiveEntries(archive)

        expect(asText(entries[0].bytes)).toBe('plain')
    })

    test('preserves binary content exactly', async () => {
        const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 0, 255])
        const archive = buildZip([{ path: 'assets/blob.bin', bytes }])

        const entries = await readSkillArchiveEntries(archive)

        expect(Array.from(entries[0].bytes)).toEqual(Array.from(bytes))
    })

    test('finds the central directory past a trailing archive comment', async () => {
        const archive = buildZip([{ path: 'SKILL.md', content: 'x' }], { comment: 'created by a zip tool' })

        const entries = await readSkillArchiveEntries(archive)

        expect(entries).toHaveLength(1)
    })

    test('skips directory entries and platform droppings', async () => {
        const archive = buildZip([
            { path: 'skill/', content: '' },
            { path: '__MACOSX/skill/._SKILL.md', content: 'junk' },
            { path: 'skill/.DS_Store', content: 'junk' },
            { path: 'skill/SKILL.md', content: 'real' },
        ])

        const entries = await readSkillArchiveEntries(archive)

        expect(entries.map(entry => entry.path)).toEqual(['skill/SKILL.md'])
    })

    test('rejects an encrypted archive instead of returning garbage', async () => {
        const archive = buildZip([{ path: 'SKILL.md', content: 'secret' }], { flags: 0x0001 })

        await expect(readSkillArchiveEntries(archive)).rejects.toMatchObject({ code: 'archiveEncrypted' })
    })

    test('rejects an unsupported compression method', async () => {
        const archive = buildZip([{ path: 'SKILL.md', content: 'x', method: 12 }])

        await expect(readSkillArchiveEntries(archive)).rejects.toMatchObject({ code: 'archiveUnsupported' })
    })

    test('rejects bytes that are not a ZIP at all', async () => {
        await expect(readSkillArchiveEntries(new TextEncoder().encode('# just markdown'))).rejects.toBeInstanceOf(
            SkillArchiveError
        )
    })

    test('refuses a zip64 archive rather than misreading its sentinel offsets', async () => {
        const archive = buildZip([{ path: 'SKILL.md', content: 'x' }])
        // Park the central-directory offset at the zip64 sentinel.
        const view = new DataView(archive.buffer)
        view.setUint32(archive.length - EOCD_SIZE + 16, 0xffffffff, true)

        await expect(readSkillArchiveEntries(archive)).rejects.toMatchObject({ code: 'archiveUnsupported' })
    })

    test('caps the number of entries it will walk', async () => {
        const archive = buildZip([{ path: 'SKILL.md', content: 'x' }])
        const view = new DataView(archive.buffer)
        view.setUint16(archive.length - EOCD_SIZE + 10, ZIP_ENTRY_LIMIT + 1, true)

        await expect(readSkillArchiveEntries(archive)).rejects.toMatchObject({ code: 'tooManyArchiveEntries' })
    })

    test('stops a decompression bomb instead of inflating until the tab dies', async () => {
        // 60 MB of zeros compresses to a few dozen KB — the classic shape. The
        // guard has to fire on the bytes produced, since the declared size in
        // the directory is attacker-controlled.
        const bomb = new Uint8Array(60 * 1024 * 1024)
        const archive = buildZip([{ path: 'SKILL.md', bytes: bomb }])
        // Lie about the uncompressed size in both headers so only the
        // streaming check can catch it.
        const view = new DataView(archive.buffer)
        const centralStart = archive.length - EOCD_SIZE - (CENTRAL_HEADER_SIZE + 'SKILL.md'.length)
        view.setUint32(centralStart + 24, 1024, true)
        view.setUint32(22, 1024, true)

        await expect(readSkillArchiveEntries(archive)).rejects.toMatchObject({ code: 'archiveTooLarge' })
    }, 30000)

    // Two blameless-but-maximal entries used to leave a remaining budget of
    // exactly 0, which the streaming guard read as "no limit" — so the third
    // entry inflated without any bound and OOM-killed the process.
    test('keeps enforcing the budget once it is exactly exhausted', async () => {
        const quarter = new Uint8Array(MAX_ENTRY_INFLATED_BYTES)
        const archive = buildZip([
            { path: 'skill/a.bin', bytes: quarter },
            { path: 'skill/b.bin', bytes: quarter },
            { path: 'skill/SKILL.md', content: 'x'.repeat(1000) },
        ])

        await expect(readSkillArchiveEntries(archive)).rejects.toMatchObject({ code: 'archiveTooLarge' })
    }, 60000)

    test('refuses an entry whose name did not survive decoding rather than mangling it', async () => {
        const archive = buildZip([{ path: 'skill/SKILL.md', content: 'x' }])
        // Corrupt the central-directory file name into invalid UTF-8, the shape
        // a legacy CP437 archive arrives in.
        const nameStart = archive.length - EOCD_SIZE - 'skill/SKILL.md'.length
        archive[nameStart] = 0xe9

        await expect(readSkillArchiveEntries(archive)).rejects.toMatchObject({ code: 'archiveFileNameUnsupported' })
    })

    test('blames the browser, not the file, when there is no decompressor', async () => {
        const archive = buildZip([{ path: 'SKILL.md', content: 'deflated content here' }])
        const original = global.DecompressionStream
        // A browser with DecompressionStream but without 'deflate-raw' throws
        // from the constructor; both gaps must report the same way.
        global.DecompressionStream = class {
            constructor() {
                throw new TypeError('unsupported format')
            }
        }
        try {
            await expect(readSkillArchiveEntries(archive)).rejects.toMatchObject({
                code: 'archiveUnsupportedBrowser',
            })
        } finally {
            global.DecompressionStream = original
        }
    })
})
