import { deflateRawSync } from 'zlib'

import {
    bytesToBase64,
    buildSkillDraftFromArchive,
    buildSkillDraftFromFile,
    buildSkillDraftFromMarkdown,
    classifySkillUploadFile,
    MAX_SKILL_BODY_BYTES,
    parseSkillFrontmatter,
    selectSkillFromArchiveEntries,
    slugifySkillName,
    SkillSourceError,
} from './skillDraftFromSource'

jest.mock('../../../redux/store', () => ({ getState: jest.fn(() => ({ loggedUser: { uid: 'admin' } })) }))

const webStreams = require('node:stream/web')
if (typeof global.DecompressionStream === 'undefined') {
    global.DecompressionStream = webStreams.DecompressionStream
}

const encode = text => new TextEncoder().encode(text)
const warningCodes = warnings => warnings.map(warning => warning.code)

// Same real-ZIP fixture builder as skillArchive.test.js, trimmed to what these
// cases need — an uploaded bundle has to survive the actual binary format.
function buildZip(files) {
    const encoder = new TextEncoder()
    const parts = []
    const central = []
    let offset = 0

    for (const file of files) {
        const nameBytes = encoder.encode(file.path)
        const contentBytes = file.bytes || encoder.encode(file.content || '')
        const compressed = new Uint8Array(deflateRawSync(Buffer.from(contentBytes)))

        const localHeader = new Uint8Array(30)
        const localView = new DataView(localHeader.buffer)
        localView.setUint32(0, 0x04034b50, true)
        localView.setUint16(8, 8, true)
        localView.setUint32(18, compressed.length, true)
        localView.setUint32(22, contentBytes.length, true)
        localView.setUint16(26, nameBytes.length, true)
        parts.push(localHeader, nameBytes, compressed)

        const centralHeader = new Uint8Array(46)
        const centralView = new DataView(centralHeader.buffer)
        centralView.setUint32(0, 0x02014b50, true)
        centralView.setUint16(10, 8, true)
        centralView.setUint32(20, compressed.length, true)
        centralView.setUint32(24, contentBytes.length, true)
        centralView.setUint16(28, nameBytes.length, true)
        centralView.setUint32(42, offset, true)
        central.push(centralHeader, nameBytes)

        offset += localHeader.length + nameBytes.length + compressed.length
    }

    const centralSize = central.reduce((total, part) => total + part.length, 0)
    const eocd = new Uint8Array(22)
    const eocdView = new DataView(eocd.buffer)
    eocdView.setUint32(0, 0x06054b50, true)
    eocdView.setUint16(8, files.length, true)
    eocdView.setUint16(10, files.length, true)
    eocdView.setUint32(12, centralSize, true)
    eocdView.setUint32(16, offset, true)

    const all = [...parts, ...central, eocd]
    const output = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0))
    let cursor = 0
    for (const part of all) {
        output.set(part, cursor)
        cursor += part.length
    }
    return output
}

const fileFromBytes = (name, bytes) => ({
    name,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
})

describe('parseSkillFrontmatter', () => {
    test('reads name and description and strips the frontmatter off the body', () => {
        const { frontmatter, body } = parseSkillFrontmatter(
            ['---', 'name: pdf-processing', 'description: "Extract text from PDFs"', '---', '# Heading', 'text'].join(
                '\n'
            )
        )

        expect(frontmatter).toMatchObject({ name: 'pdf-processing', description: 'Extract text from PDFs' })
        expect(body).toBe('# Heading\ntext')
    })

    test('folds an indented continuation line into its key', () => {
        const { frontmatter } = parseSkillFrontmatter(
            [
                '---',
                'name: research',
                'description: Use this when the user',
                '  asks for market research',
                '---',
                '',
            ].join('\n')
        )

        expect(frontmatter.description).toBe('Use this when the user asks for market research')
    })

    // Regression: the block-scalar normalization used to run AFTER the fold, by
    // which point the value was no longer exactly '>', so every folded
    // description shipped with a literal '> ' glued to the front — and that
    // string is what the assistant reads in its skills index.
    test('drops a block scalar indicator instead of folding it into the value', () => {
        const { frontmatter } = parseSkillFrontmatter(
            ['---', 'name: pdf', 'description: >', '  Extract text from PDFs.', '  Use when asked.', '---', ''].join(
                '\n'
            )
        )

        expect(frontmatter.description).toBe('Extract text from PDFs. Use when asked.')
    })

    test.each([['|'], ['>-'], ['|-'], ['>+'], ['|+']])('drops the %p block scalar indicator too', indicator => {
        const { frontmatter } = parseSkillFrontmatter(
            ['---', `description: ${indicator}`, '  Folded text.', '---', ''].join('\n')
        )

        expect(frontmatter.description).toBe('Folded text.')
    })

    test('treats a document without frontmatter as pure body', () => {
        const { frontmatter, body } = parseSkillFrontmatter('# No frontmatter\nJust instructions')

        expect(frontmatter).toBeNull()
        expect(body).toBe('# No frontmatter\nJust instructions')
    })
})

describe('slugifySkillName', () => {
    test.each([
        ['PDF Processing', 'pdf-processing'],
        ['Marktanalyse für Ärzte', 'marktanalyse-fur-arzte'],
        ['  --weird__name--  ', 'weird-name'],
        ['', ''],
    ])('slugifies %p to %p', (input, expected) => {
        expect(slugifySkillName(input)).toBe(expected)
    })

    test('never leaves a trailing hyphen after truncating an over-long name', () => {
        const slug = slugifySkillName(`${'a'.repeat(63)} tail`)

        expect(slug.length).toBeLessThanOrEqual(64)
        expect(slug.endsWith('-')).toBe(false)
    })
})

describe('classifySkillUploadFile', () => {
    test.each([
        ['SKILL.md', 'markdown'],
        ['notes.MARKDOWN', 'markdown'],
        ['pasted.txt', 'markdown'],
        ['bundle.zip', 'archive'],
        ['script.py', ''],
        ['no-extension', ''],
    ])('classifies %p as %p', (fileName, expected) => {
        expect(classifySkillUploadFile(fileName)).toBe(expected)
    })
})

describe('buildSkillDraftFromMarkdown', () => {
    test('fills every field from valid frontmatter with no warnings', () => {
        const { draft, warnings } = buildSkillDraftFromMarkdown({
            markdown: ['---', 'name: pdf-processing', 'description: Extract text from PDFs', '---', '# Steps'].join(
                '\n'
            ),
            fileName: 'SKILL.md',
        })

        expect(draft).toMatchObject({
            name: 'pdf-processing',
            displayName: 'Pdf Processing',
            description: 'Extract text from PDFs',
            body: '# Steps',
        })
        expect(warnings).toEqual([])
    })

    test('keeps the whole document as the body when there is no frontmatter', () => {
        const { draft, warnings } = buildSkillDraftFromMarkdown({
            markdown: '# Just instructions',
            fileName: 'market-research.md',
        })

        expect(draft.body).toBe('# Just instructions')
        expect(draft.name).toBe('market-research')
        expect(warningCodes(warnings)).toEqual(
            expect.arrayContaining(['noFrontmatter', 'nameDerived', 'descriptionMissing'])
        )
    })

    test('normalizes a frontmatter name that is not a valid slug and says so', () => {
        const { draft, warnings } = buildSkillDraftFromMarkdown({
            markdown: ['---', 'name: PDF Processing', 'description: d', '---', 'body'].join('\n'),
            fileName: 'SKILL.md',
        })

        expect(draft.name).toBe('pdf-processing')
        expect(warningCodes(warnings)).toContain('nameNormalized')
    })

    test('falls back to the containing folder for a bare SKILL.md', () => {
        const { draft } = buildSkillDraftFromMarkdown({
            markdown: '# body',
            fileName: 'brand-guidelines/SKILL.md',
        })

        expect(draft.name).toBe('brand-guidelines')
    })

    test('truncates an over-long description to the storable length', () => {
        const { draft, warnings } = buildSkillDraftFromMarkdown({
            markdown: ['---', 'name: n', `description: ${'x'.repeat(2000)}`, '---', 'body'].join('\n'),
            fileName: 'SKILL.md',
        })

        expect(draft.description).toHaveLength(1024)
        expect(warningCodes(warnings)).toContain('descriptionTruncated')
    })

    test('names the frontmatter fields it did not keep', () => {
        const { warnings } = buildSkillDraftFromMarkdown({
            markdown: [
                '---',
                'name: pdf',
                'description: d',
                'allowed-tools: Bash, Read',
                'license: MIT',
                '---',
                'body',
            ].join('\n'),
            fileName: 'SKILL.md',
        })

        const dropped = warnings.find(warning => warning.code === 'frontmatterFieldsDropped')
        expect(dropped.params.fields).toBe('allowed-tools, license')
    })

    test('rejects empty input', () => {
        expect(() => buildSkillDraftFromMarkdown({ markdown: '   \n  ' })).toThrow(SkillSourceError)
    })

    test('rejects a body past the storable size', () => {
        expect(() => buildSkillDraftFromMarkdown({ markdown: 'x'.repeat(MAX_SKILL_BODY_BYTES + 1) })).toThrow(
            expect.objectContaining({ code: 'bodyTooLarge' })
        )
    })
})

describe('selectSkillFromArchiveEntries', () => {
    const entry = (path, size = 10) => ({ path, size, bytes: new Uint8Array(size) })

    test('bundles every file next to the manifest with paths relative to it', () => {
        const { manifest, files } = selectSkillFromArchiveEntries([
            entry('pdf/SKILL.md'),
            entry('pdf/scripts/run.py'),
            entry('pdf/reference/spec.md'),
        ])

        expect(manifest.path).toBe('pdf/SKILL.md')
        expect(files.map(file => file.relativePath)).toEqual(['scripts/run.py', 'reference/spec.md'])
    })

    test('supports a manifest at the archive root', () => {
        const { files } = selectSkillFromArchiveEntries([entry('SKILL.md'), entry('run.py')])

        expect(files.map(file => file.relativePath)).toEqual(['run.py'])
    })

    test('warns about, but does not bundle, files outside the skill folder', () => {
        const { files, warnings } = selectSkillFromArchiveEntries([
            entry('pdf/SKILL.md'),
            entry('README.md'),
            entry('pdf/run.py'),
        ])

        expect(files.map(file => file.relativePath)).toEqual(['run.py'])
        expect(warningCodes(warnings)).toEqual(['fileOutsideSkillFolder'])
    })

    test('refuses an archive with no manifest', () => {
        expect(() => selectSkillFromArchiveEntries([entry('notes.md')])).toThrow(
            expect.objectContaining({ code: 'noManifest' })
        )
    })

    test('refuses a collection of skills rather than importing an arbitrary one', () => {
        expect(() => selectSkillFromArchiveEntries([entry('a/SKILL.md'), entry('b/SKILL.md')])).toThrow(
            expect.objectContaining({ code: 'multipleManifests' })
        )
    })

    test('refuses an over-large bundled file instead of silently dropping it', () => {
        expect(() =>
            selectSkillFromArchiveEntries([entry('pdf/SKILL.md'), entry('pdf/huge.bin', 6 * 1024 * 1024)])
        ).toThrow(expect.objectContaining({ code: 'bundleFileTooLarge' }))
    })

    test('refuses more bundled files than the VM will mount', () => {
        const entries = [entry('pdf/SKILL.md')]
        for (let index = 0; index < 21; index++) entries.push(entry(`pdf/file-${index}.txt`))

        expect(() => selectSkillFromArchiveEntries(entries)).toThrow(
            expect.objectContaining({ code: 'tooManyBundleFiles' })
        )
    })

    test('refuses a bundle over the total size the VM will mount', () => {
        const entries = [entry('pdf/SKILL.md')]
        for (let index = 0; index < 5; index++) entries.push(entry(`pdf/file-${index}.bin`, 4.5 * 1024 * 1024))

        expect(() => selectSkillFromArchiveEntries(entries)).toThrow(
            expect.objectContaining({ code: 'bundleTooLarge' })
        )
    })

    test('refuses a traversing relative path', () => {
        expect(() =>
            selectSkillFromArchiveEntries([
                { path: 'pdf/SKILL.md', size: 1, bytes: new Uint8Array(1) },
                { path: 'pdf/../../etc/passwd', size: 1, bytes: new Uint8Array(1) },
            ])
        ).toThrow(expect.objectContaining({ code: 'unsafeFilePath' }))
    })
})

describe('buildSkillDraftFromArchive', () => {
    test('reads a real zip into a draft with its bundled files', async () => {
        const archive = buildZip([
            {
                path: 'pdf-processing/SKILL.md',
                content: ['---', 'name: pdf-processing', 'description: Extract text', '---', '# Steps'].join('\n'),
            },
            { path: 'pdf-processing/scripts/run.py', content: 'print(1)' },
        ])

        const { draft, warnings } = await buildSkillDraftFromArchive({ archive, fileName: 'pdf-processing.zip' })

        expect(draft).toMatchObject({ name: 'pdf-processing', description: 'Extract text', body: '# Steps' })
        expect(draft.files).toHaveLength(1)
        expect(draft.files[0]).toMatchObject({ relativePath: 'scripts/run.py', size: 8 })
        expect(warnings).toEqual([])
    })

    test('reports an unreadable archive as a typed source error', async () => {
        await expect(buildSkillDraftFromArchive({ archive: encode('not a zip') })).rejects.toBeInstanceOf(
            SkillSourceError
        )
    })
})

describe('buildSkillDraftFromFile', () => {
    test('routes a .md file through the markdown path', async () => {
        const file = fileFromBytes('SKILL.md', encode('---\nname: a-skill\ndescription: d\n---\nbody'))

        const { draft } = await buildSkillDraftFromFile(file)

        expect(draft).toMatchObject({ name: 'a-skill', body: 'body', files: [] })
    })

    test('routes a .zip file through the archive path', async () => {
        const archive = buildZip([{ path: 'SKILL.md', content: '---\nname: z-skill\ndescription: d\n---\nb' }])
        const file = fileFromBytes('bundle.zip', archive)

        const { draft } = await buildSkillDraftFromFile(file)

        expect(draft.name).toBe('z-skill')
    })

    test('rejects an unsupported extension before reading anything', async () => {
        const file = { name: 'script.py', arrayBuffer: jest.fn() }

        await expect(buildSkillDraftFromFile(file)).rejects.toMatchObject({ code: 'unsupportedFileType' })
        expect(file.arrayBuffer).not.toHaveBeenCalled()
    })

    // The caps below would catch these too, but only after arrayBuffer() has
    // pulled the whole file into memory — for a mis-picked huge file that is a
    // dead tab rather than an error message.
    test('rejects an over-large file from its metadata, before reading a byte', async () => {
        const archive = { name: 'huge.zip', size: 26 * 1024 * 1024, arrayBuffer: jest.fn() }
        const markdown = { name: 'huge.md', size: 300 * 1024, arrayBuffer: jest.fn() }

        await expect(buildSkillDraftFromFile(archive)).rejects.toMatchObject({ code: 'archiveTooLarge' })
        await expect(buildSkillDraftFromFile(markdown)).rejects.toMatchObject({ code: 'bodyTooLarge' })
        expect(archive.arrayBuffer).not.toHaveBeenCalled()
        expect(markdown.arrayBuffer).not.toHaveBeenCalled()
    })

    test('reports a read failure separately from a validation failure', async () => {
        const file = {
            name: 'SKILL.md',
            arrayBuffer: async () => {
                throw new Error('disk gone')
            },
        }

        await expect(buildSkillDraftFromFile(file)).rejects.toMatchObject({ code: 'readFailed' })
    })
})

describe('bytesToBase64', () => {
    test('round-trips binary content', () => {
        const bytes = new Uint8Array([0, 1, 127, 128, 255, 254])

        expect(Buffer.from(bytesToBase64(bytes), 'base64').equals(Buffer.from(bytes))).toBe(true)
    })

    test('handles a payload past the fromCharCode argument limit', () => {
        const bytes = new Uint8Array(200000).map((_, index) => index % 256)

        expect(Buffer.from(bytesToBase64(bytes), 'base64').length).toBe(200000)
    })
})
