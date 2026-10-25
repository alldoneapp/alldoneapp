'use strict'

// Plain text out of PowerPoint (.pptx) and Excel (.xlsx) files, for the assistant's view of a chat
// upload and for documents added to the project wiki. Both formats are ZIP archives of XML parts
// (Office Open XML), so this reads the parts that carry text and nothing else: no layout, no
// images, no charts.
//
// What comes out, and why that shape:
//   - a deck reads "Slide 1", its paragraphs, then its speaker notes, in the order the deck shows
//     the slides (presentation.xml), not in file-name order — a slide moved in PowerPoint keeps its
//     old file name. Field text (slide numbers, dates) is dropped: it is layout, not content.
//   - a workbook reads "Sheet: Name", then one line per row with the cells separated by " | ", gaps
//     kept so that columns still line up. A number formatted as a date is written as a date, because
//     a serial like 45591 means nothing to a reader.
//
// The archive is untrusted: a 20 MB upload can inflate to gigabytes. Every part is checked against
// its declared size before it is inflated, the inflated total is bounded, and reading stops once
// `maxChars` of text has been produced.

const JSZip = require('jszip')

const MAX_PART_BYTES = 60 * 1024 * 1024
const MAX_TOTAL_BYTES = 150 * 1024 * 1024
const MAX_SLIDES = 500
const MAX_SHEETS = 50

const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

class OfficeDocumentError extends Error {}

function isPptxFile(contentType = '', fileName = '') {
    return String(contentType).toLowerCase().includes(PPTX_MIME_TYPE) || /\.pptx$/i.test(String(fileName))
}

function isXlsxFile(contentType = '', fileName = '') {
    return String(contentType).toLowerCase().includes(XLSX_MIME_TYPE) || /\.xlsx$/i.test(String(fileName))
}

function decodeXmlText(value) {
    return (
        String(value || '')
            .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, entity) => {
                if (entity === 'lt') return '<'
                if (entity === 'gt') return '>'
                if (entity === 'amp') return '&'
                if (entity === 'quot') return '"'
                if (entity === 'apos') return "'"
                const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
                return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
            })
            // Excel writes characters XML cannot carry (a carriage return, a tab) as _xHHHH_.
            .replace(/_x([0-9a-fA-F]{4})_/g, (whole, hex) => String.fromCharCode(parseInt(hex, 16)))
    )
}

function readAttributes(tag) {
    const attributes = {}
    for (const match of String(tag || '').matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attributes[match[1]] = decodeXmlText(match[2] ?? match[3])
    }
    return attributes
}

// A relationship target is relative to the folder of the part that declares it, or absolute from
// the archive root when it starts with a slash.
function resolvePartPath(baseFolder, target) {
    const raw = String(target || '')
    const segments = raw.startsWith('/')
        ? []
        : String(baseFolder || '')
              .split('/')
              .filter(Boolean)
    for (const segment of raw.split('/')) {
        if (!segment || segment === '.') continue
        if (segment === '..') segments.pop()
        else segments.push(segment)
    }
    return segments.join('/')
}

function readRelationships(xml, baseFolder) {
    const relationships = {}
    for (const match of String(xml || '').matchAll(/<Relationship\b[^>]*>/g)) {
        const attributes = readAttributes(match[0])
        if (!attributes.Id || !attributes.Target || attributes.TargetMode === 'External') continue
        relationships[attributes.Id] = {
            type: String(attributes.Type || '')
                .split('/')
                .pop(),
            path: resolvePartPath(baseFolder, attributes.Target),
        }
    }
    return relationships
}

function createPartReader(zip) {
    let inflatedBytes = 0
    return async path => {
        const entry = zip.file(path)
        if (!entry) return null
        const declaredBytes = Number(entry._data?.uncompressedSize) || 0
        if (declaredBytes > MAX_PART_BYTES || inflatedBytes + declaredBytes > MAX_TOTAL_BYTES) {
            throw new OfficeDocumentError(`The file is too large to read (part ${path}).`)
        }
        const text = await entry.async('string')
        inflatedBytes += Buffer.byteLength(text)
        if (inflatedBytes > MAX_TOTAL_BYTES) throw new OfficeDocumentError('The file is too large to read.')
        return text
    }
}

async function openArchive(buffer) {
    try {
        return await JSZip.loadAsync(buffer)
    } catch (error) {
        throw new OfficeDocumentError(`The file is not a readable Office document: ${error.message}`)
    }
}

// Accumulates output lines and stops the reader once the budget is spent.
function createTextBudget(maxChars) {
    const lines = []
    let length = 0
    return {
        lines,
        get full() {
            return Number.isFinite(maxChars) && length >= maxChars
        },
        push(line) {
            lines.push(line)
            length += line.length + 1
        },
    }
}

// ---------------------------------------------------------------------------------------------
// PowerPoint

// The paragraphs of one DrawingML part (a slide or its notes), one per <a:p>, line breaks kept.
function readDrawingParagraphs(xml) {
    const withoutFields = String(xml || '').replace(/<a:fld\b[^>]*>[\s\S]*?<\/a:fld>/g, '')
    const paragraphs = []
    for (const match of withoutFields.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
        // PowerPoint writes a line break as <a:br/>, LibreOffice as <a:br><a:rPr/></a:br>.
        const runs = match[1]
            .replace(/<a:br\b[^>]*\/>|<a:br\b[^>]*>[\s\S]*?<\/a:br>/g, '<a:t>\n</a:t>')
            .matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)
        const text = [...runs]
            .map(run => decodeXmlText(run[1]))
            .join('')
            .replace(/[ \t]+/g, ' ')
            .trim()
        if (text) paragraphs.push(text)
    }
    return paragraphs
}

async function listSlidePaths(zip, readPart) {
    const presentation = await readPart('ppt/presentation.xml')
    const relationships = readRelationships(await readPart('ppt/_rels/presentation.xml.rels'), 'ppt')
    const ordered = []
    for (const match of String(presentation || '').matchAll(/<p:sldId\b[^>]*>/g)) {
        const relationship = relationships[readAttributes(match[0])['r:id']]
        if (relationship && zip.file(relationship.path)) ordered.push(relationship.path)
    }
    if (ordered.length) return ordered
    // A deck without a readable slide list: file-name order is the best guess there is.
    return Object.keys(zip.files)
        .map(path => ({ path, number: Number((/^ppt\/slides\/slide(\d+)\.xml$/.exec(path) || [])[1]) }))
        .filter(entry => Number.isFinite(entry.number))
        .sort((left, right) => left.number - right.number)
        .map(entry => entry.path)
}

async function extractPptxText(buffer, { maxChars = Infinity } = {}) {
    const zip = await openArchive(buffer)
    const readPart = createPartReader(zip)
    const slidePaths = await listSlidePaths(zip, readPart)
    if (!slidePaths.length) throw new OfficeDocumentError('The presentation has no slides.')

    const budget = createTextBudget(maxChars)
    for (const [index, slidePath] of slidePaths.slice(0, MAX_SLIDES).entries()) {
        if (budget.full) break
        const slideXml = await readPart(slidePath)
        const folder = slidePath.split('/').slice(0, -1).join('/')
        const fileName = slidePath.split('/').pop()
        const relationships = readRelationships(await readPart(`${folder}/_rels/${fileName}.rels`), folder)
        const notesPath = Object.values(relationships).find(relationship => relationship.type === 'notesSlide')?.path
        const hidden = /<p:sld\b[^>]*\bshow="(0|false)"/.test(String(slideXml || ''))

        const paragraphs = readDrawingParagraphs(slideXml)
        const notes = notesPath ? readDrawingParagraphs(await readPart(notesPath)) : []
        if (!paragraphs.length && !notes.length) continue

        if (budget.lines.length) budget.push('')
        budget.push(`Slide ${index + 1}${hidden ? ' (hidden)' : ''}`)
        paragraphs.forEach(paragraph => budget.push(paragraph))
        if (notes.length) budget.push(`Speaker notes: ${notes.join('\n')}`)
    }
    return budget.lines.join('\n').trim()
}

// ---------------------------------------------------------------------------------------------
// Excel

// Built-in number formats that render a date (ECMA-376 Part 1, 18.8.30).
const BUILT_IN_DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

function isDateFormatCode(code) {
    const stripped = String(code || '')
        .replace(/"[^"]*"/g, '')
        .replace(/\\./g, '')
        .replace(/\[[^\]]*\]/g, '')
    return /[dy]/i.test(stripped)
}

function readDateStyleIndexes(stylesXml) {
    const xml = String(stylesXml || '')
    const customDateFormats = new Set()
    for (const match of xml.matchAll(/<numFmt\b[^>]*>/g)) {
        const attributes = readAttributes(match[0])
        if (isDateFormatCode(attributes.formatCode)) customDateFormats.add(Number(attributes.numFmtId))
    }
    const cellFormats = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)
    const dateStyles = new Set()
    if (!cellFormats) return dateStyles
    ;[...cellFormats[1].matchAll(/<xf\b[^>]*>/g)].forEach((match, index) => {
        const formatId = Number(readAttributes(match[0]).numFmtId)
        if (BUILT_IN_DATE_FORMAT_IDS.has(formatId) || customDateFormats.has(formatId)) dateStyles.add(index)
    })
    return dateStyles
}

function readSharedStrings(xml) {
    const strings = []
    for (const match of String(xml || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
        // Phonetic runs (<rPh>) are reading aids for East Asian text, not part of the value.
        const runs = match[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)
        strings.push([...runs].map(run => decodeXmlText(run[1])).join(''))
    }
    return strings
}

function columnIndex(reference) {
    const letters = (/^([A-Z]+)/i.exec(String(reference || '')) || [])[1]
    if (!letters) return null
    let index = 0
    for (const letter of letters.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64)
    return index - 1
}

function formatSerialDate(serial, date1904) {
    // Day 0 of the 1900 system is 1899-12-30 once Excel's phantom 1900-02-29 is accounted for.
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
    const millis = epoch + Math.round(serial * 86400000)
    const iso = new Date(millis).toISOString()
    return serial % 1 === 0 ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

function formatNumber(raw) {
    const value = Number(raw)
    if (!Number.isFinite(value)) return String(raw || '')
    // Excel stores 17 significant digits; 0.1 + 0.2 written by it reads 0.30000000000000004.
    return String(Number(value.toPrecision(15)))
}

function readCellValue(attributes, inner, { sharedStrings, dateStyles, date1904 }) {
    const value = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1]
    switch (attributes.t) {
        case 's':
            return sharedStrings[Number(value)] ?? ''
        case 'inlineStr':
            return [...String(inner).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
                .map(run => decodeXmlText(run[1]))
                .join('')
        case 'str':
        case 'e':
            return decodeXmlText(value || '')
        case 'b':
            return value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : ''
        default: {
            if (value === undefined || value === '') return ''
            const number = Number(value)
            if (Number.isFinite(number) && dateStyles.has(Number(attributes.s))) {
                return formatSerialDate(number, date1904)
            }
            return formatNumber(value)
        }
    }
}

function readSheetRows(xml, context) {
    const rows = []
    for (const rowMatch of String(xml || '').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = []
        let nextColumn = 0
        for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const attributes = readAttributes(cellMatch[1])
            const column = columnIndex(attributes.r) ?? nextColumn
            nextColumn = column + 1
            const text = String(readCellValue(attributes, cellMatch[2] || '', context))
                .replace(/\s+/g, ' ')
                .trim()
            if (text) cells[column] = text
        }
        if (!cells.some(Boolean)) continue
        rows.push(Array.from(cells, cell => cell || '').join(' | '))
    }
    return rows
}

async function extractXlsxText(buffer, { maxChars = Infinity } = {}) {
    const zip = await openArchive(buffer)
    const readPart = createPartReader(zip)
    const workbook = String((await readPart('xl/workbook.xml')) || '')
    if (!workbook) throw new OfficeDocumentError('The workbook has no sheets.')
    const relationships = readRelationships(await readPart('xl/_rels/workbook.xml.rels'), 'xl')
    const workbookProperties = /<workbookPr\b[^>]*>/.exec(workbook)
    const date1904 = ['1', 'true'].includes(readAttributes(workbookProperties?.[0]).date1904)
    const context = {
        sharedStrings: readSharedStrings(await readPart('xl/sharedStrings.xml')),
        dateStyles: readDateStyleIndexes(await readPart('xl/styles.xml')),
        date1904,
    }

    const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map(match => readAttributes(match[0]))
    if (!sheets.length) throw new OfficeDocumentError('The workbook has no sheets.')

    const budget = createTextBudget(maxChars)
    for (const sheet of sheets.slice(0, MAX_SHEETS)) {
        if (budget.full) break
        const path = relationships[sheet['r:id']]?.path
        if (!path) continue
        const rows = readSheetRows(await readPart(path), context)
        if (!rows.length) continue
        if (budget.lines.length) budget.push('')
        const hidden = ['hidden', 'veryHidden'].includes(sheet.state)
        budget.push(`Sheet: ${sheet.name || path.split('/').pop()}${hidden ? ' (hidden)' : ''}`)
        for (const row of rows) {
            if (budget.full) break
            budget.push(row)
        }
    }
    return budget.lines.join('\n').trim()
}

module.exports = {
    PPTX_MIME_TYPE,
    XLSX_MIME_TYPE,
    OfficeDocumentError,
    isPptxFile,
    isXlsxFile,
    decodeXmlText,
    resolvePartPath,
    extractPptxText,
    extractXlsxText,
}
