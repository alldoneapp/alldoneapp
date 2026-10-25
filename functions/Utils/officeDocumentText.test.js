'use strict'

// The fixtures in __fixtures__/office are real Office files, not hand-written XML: the decks were
// written by python-pptx and the workbooks by openpyxl, and the `-libreoffice` variants are the same
// files re-saved by LibreOffice, whose markup differs in the places that matter here (line breaks,
// formula results). The hand-built archives below cover what neither writer produces.

const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')

const {
    OfficeDocumentError,
    decodeXmlText,
    extractPptxText,
    extractXlsxText,
    isPptxFile,
    isXlsxFile,
    resolvePartPath,
} = require('./officeDocumentText')

const fixture = name => fs.readFileSync(path.join(__dirname, '__fixtures__', 'office', name))

async function buildArchive(files, options = {}) {
    const zip = new JSZip()
    Object.entries(files).forEach(([name, content]) => zip.file(name, content))
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', ...options })
}

const SLIDE = body =>
    `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`

describe('extractPptxText', () => {
    test.each(['pricing-concept.pptx', 'pricing-concept-libreoffice.pptx'])(
        'reads %s in the order the deck shows its slides',
        async name => {
            const text = await extractPptxText(fixture(name))
            expect(text).toBe(
                [
                    'Slide 1',
                    'Pricing concept 2026',
                    'Draft for the steering committee',
                    '',
                    // The table slide is file slide3.xml, moved in front of the bullets slide.
                    'Slide 2',
                    'Price table',
                    'Plan',
                    'Price',
                    'Team',
                    '12 <EUR>',
                    'Business',
                    '24.50',
                    '',
                    'Slide 3',
                    'Plans & prices',
                    'Three plans: Starter, Team, Business',
                    'Team costs €12 per user & month',
                    'Annual billing\nsaves money',
                    'Speaker notes: Decision pending: annual discount 15% or 20%',
                    '',
                    'Slide 4 (hidden)',
                    'Backup: competitor prices',
                    'Competitor A charges 15',
                ].join('\n')
            )
        }
    )

    test('drops field text such as slide numbers and dates', async () => {
        const buffer = await buildArchive({
            'ppt/slides/slide1.xml': SLIDE(
                '<a:p><a:r><a:t>Roadmap</a:t></a:r></a:p><a:p><a:fld id="1" type="slidenum"><a:t>7</a:t></a:fld></a:p>'
            ),
        })
        expect(await extractPptxText(buffer)).toBe('Slide 1\nRoadmap')
    })

    test('falls back to file-name order when the deck has no readable slide list', async () => {
        const buffer = await buildArchive({
            'ppt/slides/slide10.xml': SLIDE('<a:p><a:r><a:t>Ten</a:t></a:r></a:p>'),
            'ppt/slides/slide2.xml': SLIDE('<a:p><a:r><a:t>Two</a:t></a:r></a:p>'),
        })
        expect(await extractPptxText(buffer)).toBe('Slide 1\nTwo\n\nSlide 2\nTen')
    })

    test('stops reading slides once the character budget is spent', async () => {
        const slides = {}
        for (let index = 1; index <= 20; index++) {
            slides[`ppt/slides/slide${index}.xml`] = SLIDE(`<a:p><a:r><a:t>${'x'.repeat(100)}</a:t></a:r></a:p>`)
        }
        const text = await extractPptxText(await buildArchive(slides), { maxChars: 300 })
        expect(text.match(/^Slide \d+$/gm)).toHaveLength(3)
    })

    test('refuses a part that declares more than the per-part limit, before inflating it', async () => {
        const buffer = await buildArchive({
            'ppt/slides/slide1.xml': SLIDE('<a:p><a:r><a:t>small</a:t></a:r></a:p>'),
        })
        // Forge the slide's uncompressed size in the central directory (offset 24 of its file
        // header; the name follows at 46), the way a zip bomb announces what it will inflate to.
        // jszip also writes headers for the folders, so the slide's is found by its name.
        const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02])
        let header = buffer.indexOf(signature)
        while (
            buffer.toString('utf8', header + 46, header + 46 + buffer.readUInt16LE(header + 28)) !==
            'ppt/slides/slide1.xml'
        ) {
            header = buffer.indexOf(signature, header + 4)
        }
        buffer.writeUInt32LE(61 * 1024 * 1024, header + 24)

        await expect(extractPptxText(buffer)).rejects.toThrow(/too large/)
    })

    test('reports a file that is not an Office archive, or a deck without slides', async () => {
        await expect(extractPptxText(Buffer.from('not a zip'))).rejects.toThrow(OfficeDocumentError)
        await expect(extractPptxText(await buildArchive({ 'ppt/presentation.xml': '<p/>' }))).rejects.toThrow(
            'The presentation has no slides.'
        )
    })
})

describe('extractXlsxText', () => {
    test('reads every sheet as rows, with dates as dates and gaps kept', async () => {
        expect(await extractXlsxText(fixture('price-list.xlsx'))).toBe(
            [
                'Sheet: Plans',
                'Plan | Price per user | Valid from | Annual',
                'Starter | 0 | 2026-01-01',
                // openpyxl stores the formula without a cached result, so there is nothing to show.
                'Team | 12 | 2026-03-15',
                'Business & Co <Enterprise> | 24.5 | 2026-07-01 09:30 | TRUE',
                ' |  |  |  | Only E',
                '',
                'Sheet: Internal (hidden)',
                'Margin target | 0.7',
            ].join('\n')
        )
    })

    test('shows the cached result of a formula', async () => {
        const text = await extractXlsxText(fixture('price-list-libreoffice.xlsx'))
        expect(text).toContain('Team | 12 | 2026-03-15 | 144')
    })

    test('reads inline strings, booleans, errors and the 1904 date system', async () => {
        const buffer = await buildArchive({
            'xl/workbook.xml':
                '<workbook><workbookPr date1904="1"/><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels':
                '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="/xl/worksheets/s.xml"/></Relationships>',
            'xl/styles.xml':
                '<styleSheet><numFmts><numFmt numFmtId="170" formatCode="&quot;Q&quot;0"/><numFmt numFmtId="171" formatCode="d/m"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="171"/><xf numFmtId="170"/></cellXfs></styleSheet>',
            'xl/worksheets/s.xml':
                '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Line_x000D_</t></is></c><c r="B1" t="b"><v>0</v></c><c r="C1" t="e"><v>#N/A</v></c><c r="D1" s="1"><v>0</v></c><c r="E1" s="2"><v>3</v></c></row></sheetData></worksheet>',
        })
        // "Q"0 is not a date even though the literal contains no d or y; d/m is one.
        expect(await extractXlsxText(buffer)).toBe('Sheet: S\nLine | FALSE | #N/A | 1904-01-01 | 3')
    })

    test('stops at the character budget', async () => {
        const rows = Array.from(
            { length: 200 },
            (_, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>${index}</v></c></row>`
        ).join('')
        const buffer = await buildArchive({
            'xl/workbook.xml': '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels':
                '<Relationships><Relationship Id="rId1" Target="worksheets/s.xml"/></Relationships>',
            'xl/worksheets/s.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
        })
        const text = await extractXlsxText(buffer, { maxChars: 50 })
        expect(text.split('\n').length).toBeLessThan(20)
    })
})

describe('helpers', () => {
    test('decodeXmlText decodes named and numeric entities', () => {
        expect(decodeXmlText('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#8364; &#x20AC;')).toBe(
            'a & b <c> "d" \'e\' € €'
        )
    })

    test('resolvePartPath follows relative and absolute relationship targets', () => {
        expect(resolvePartPath('ppt/slides', '../notesSlides/notesSlide1.xml')).toBe('ppt/notesSlides/notesSlide1.xml')
        expect(resolvePartPath('xl', '/xl/worksheets/sheet1.xml')).toBe('xl/worksheets/sheet1.xml')
        expect(resolvePartPath('xl', 'worksheets/./sheet1.xml')).toBe('xl/worksheets/sheet1.xml')
    })

    test('isPptxFile and isXlsxFile accept either the MIME type or the extension', () => {
        expect(isPptxFile('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'x')).toBe(true)
        expect(isPptxFile('', 'Deck.PPTX')).toBe(true)
        expect(isPptxFile('application/vnd.ms-powerpoint', 'deck.ppt')).toBe(false)
        expect(isXlsxFile('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x')).toBe(true)
        expect(isXlsxFile('application/octet-stream', 'prices.xlsx')).toBe(true)
        expect(isXlsxFile('', 'prices.xls')).toBe(false)
    })
})
