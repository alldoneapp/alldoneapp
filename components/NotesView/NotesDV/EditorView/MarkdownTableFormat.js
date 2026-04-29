import ReactQuill from 'react-quill'
import v4 from 'uuid/v4'

const Embed = ReactQuill.Quill.import('blots/embed')

const DEFAULT_TABLE_DATA = { rows: [], alignments: [] }

const parseInlineFormatting = text => {
    if (!text) return [{ text: '', bold: false, italic: false, strike: false }]

    const segments = []
    let remaining = text

    const findNextMatch = str => {
        const matches = []
        const boldItalicMatch = /\*\*\*(.+?)\*\*\*/.exec(str)
        if (boldItalicMatch) {
            matches.push({
                index: boldItalicMatch.index,
                length: boldItalicMatch[0].length,
                text: boldItalicMatch[1],
                bold: true,
                italic: true,
                strike: false,
            })
        }

        const boldMatch = /\*\*(.+?)\*\*/.exec(str)
        if (boldMatch && (!boldItalicMatch || boldMatch.index < boldItalicMatch.index)) {
            const beforeBold = str.substring(0, boldMatch.index)
            const afterBold = str.substring(boldMatch.index + boldMatch[0].length)
            if (!beforeBold.endsWith('*') && !afterBold.startsWith('*')) {
                matches.push({
                    index: boldMatch.index,
                    length: boldMatch[0].length,
                    text: boldMatch[1],
                    bold: true,
                    italic: false,
                    strike: false,
                })
            }
        }

        let italicSearchStart = 0
        while (italicSearchStart < str.length) {
            const searchStr = str.substring(italicSearchStart)
            const italicMatch = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/.exec(searchStr)
            if (!italicMatch) break

            const actualIndex = italicSearchStart + italicMatch.index
            const before = str.substring(0, actualIndex)
            const after = str.substring(actualIndex + italicMatch[0].length)
            if (!before.endsWith('*') && !after.startsWith('*')) {
                matches.push({
                    index: actualIndex,
                    length: italicMatch[0].length,
                    text: italicMatch[1],
                    bold: false,
                    italic: true,
                    strike: false,
                })
                break
            }
            italicSearchStart = actualIndex + 1
        }

        const strikeMatch = /~~(.+?)~~/.exec(str)
        if (strikeMatch) {
            matches.push({
                index: strikeMatch.index,
                length: strikeMatch[0].length,
                text: strikeMatch[1],
                bold: false,
                italic: false,
                strike: true,
            })
        }

        if (matches.length === 0) return null
        return matches.reduce((earliest, current) => (current.index < earliest.index ? current : earliest))
    }

    while (remaining.length > 0) {
        const match = findNextMatch(remaining)
        if (!match) {
            segments.push({ text: remaining, bold: false, italic: false, strike: false })
            break
        }

        if (match.index > 0) {
            segments.push({
                text: remaining.substring(0, match.index),
                bold: false,
                italic: false,
                strike: false,
            })
        }

        segments.push({
            text: match.text,
            bold: match.bold,
            italic: match.italic,
            strike: match.strike,
        })

        remaining = remaining.substring(match.index + match.length)
    }

    return segments.length > 0 ? segments : [{ text: '', bold: false, italic: false, strike: false }]
}

const appendFormattedText = (node, text) => {
    parseInlineFormatting(text).forEach(segment => {
        const span = document.createElement('span')
        span.textContent = segment.text
        if (segment.bold) span.style.fontWeight = '700'
        if (segment.italic) span.style.fontStyle = 'italic'
        if (segment.strike) span.style.textDecoration = 'line-through'
        node.appendChild(span)
    })
}

const createCell = (tagName, text, alignment) => {
    const cell = document.createElement(tagName)
    if (alignment) {
        cell.style.textAlign = alignment
    }
    appendFormattedText(cell, text)
    return cell
}

export default class MarkdownTableFormat extends Embed {
    static create(tableData = DEFAULT_TABLE_DATA) {
        const node = super.create()
        const id = tableData.id || v4()
        const rows = Array.isArray(tableData.rows) ? tableData.rows : []
        const alignments = Array.isArray(tableData.alignments) ? tableData.alignments : []

        node.setAttribute('data-id', id)
        node.setAttribute('data-markdown-table', JSON.stringify({ rows, alignments }))
        node.setAttribute('contenteditable', false)

        const scrollWrapper = document.createElement('div')
        scrollWrapper.className = 'ql-markdown-table-scroll'

        const table = document.createElement('table')
        table.className = 'ql-markdown-table'

        rows.forEach((row, rowIndex) => {
            const tableRow = document.createElement('tr')
            const cellTag = rowIndex === 0 ? 'th' : 'td'
            row.forEach((cellText, cellIndex) => {
                tableRow.appendChild(createCell(cellTag, cellText, alignments[cellIndex]))
            })
            table.appendChild(tableRow)
        })

        scrollWrapper.appendChild(table)
        node.appendChild(scrollWrapper)
        return node
    }

    static value(domNode) {
        try {
            return JSON.parse(domNode.getAttribute('data-markdown-table')) || DEFAULT_TABLE_DATA
        } catch (error) {
            return DEFAULT_TABLE_DATA
        }
    }
}

MarkdownTableFormat.blotName = 'markdownTable'
MarkdownTableFormat.className = 'ql-markdownTable'
MarkdownTableFormat.tagName = 'span'
