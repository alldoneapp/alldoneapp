import { BREAKLINE_CODE } from '../../../Feeds/Utils/HelperFunctions'

// Regex patterns for markdown elements
export const REGEX_BOLD_ITALIC = /\*\*\*(.*?)\*\*\*/g
export const REGEX_BOLD = /\*\*(.*?)\*\*/g
export const REGEX_ITALIC = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g
export const REGEX_STRIKETHROUGH = /~~(.*?)~~/g

// Line-based markdown patterns
export const REGEX_HEADER_1 = /^#\s+(.+)$/
export const REGEX_HEADER_2 = /^##\s+(.+)$/
export const REGEX_HEADER_3 = /^###\s+(.+)$/
export const REGEX_BULLET_LIST = /^[-*]\s+(.+)$/
export const REGEX_NUMBERED_LIST = /^(\d+)\.\s+(.+)$/
export const REGEX_HORIZONTAL_RULE = /^(-{3,}|_{3,}|\*{3,})$/
export const REGEX_CHECKBOX_UNCHECKED = /^-\s+\[ \]\s+(.+)$/
export const REGEX_CHECKBOX_CHECKED = /^-\s+\[x\]\s+(.+)$/i

// Table separator cell: at least 3 dashes with optional alignment colons
const REGEX_TABLE_SEPARATOR_CELL = /^\s*:?-{3,}:?\s*$/

/**
 * Check if a line contains an unescaped pipe character
 */
const hasUnescapedPipe = line => {
    let backslashCount = 0
    for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '\\') {
            backslashCount += 1
        } else {
            if (char === '|' && backslashCount % 2 === 0) {
                return true
            }
            backslashCount = 0
        }
    }
    return false
}

/**
 * Check if a line ends with an unescaped pipe
 */
const endsWithUnescapedPipe = line => {
    const trimmed = line.trim()
    if (!trimmed.endsWith('|')) return false
    let backslashCount = 0
    for (let i = trimmed.length - 2; i >= 0 && trimmed[i] === '\\'; i--) {
        backslashCount += 1
    }
    return backslashCount % 2 === 0
}

/**
 * Strip leading/trailing pipes from a table row
 */
const trimOuterTablePipes = line => {
    let trimmed = line.trim()
    if (trimmed.startsWith('|')) {
        trimmed = trimmed.substring(1)
    }
    if (endsWithUnescapedPipe(trimmed)) {
        trimmed = trimmed.substring(0, trimmed.length - 1)
    }
    return trimmed
}

/**
 * Split a table row by unescaped pipe characters, trimming each cell
 */
export const splitMarkdownTableRow = line => {
    const row = trimOuterTablePipes(line)
    const cells = []
    let cell = ''

    for (let i = 0; i < row.length; i++) {
        const char = row[i]
        const nextChar = row[i + 1]

        if (char === '\\' && nextChar === '|') {
            cell += '|'
            i += 1
        } else if (char === '|') {
            cells.push(cell.trim())
            cell = ''
        } else {
            cell += char
        }
    }

    cells.push(cell.trim())
    return cells
}

/**
 * Parse a line as a table row. Returns array of cell strings if valid, or null.
 */
const parseTableRow = line => {
    if (!hasUnescapedPipe(line)) return null
    const cells = splitMarkdownTableRow(line)
    return cells.length > 1 ? cells : null
}

/**
 * Parse a separator row and return alignment array, or null if not a valid separator.
 */
const parseTableAlignments = line => {
    const cells = parseTableRow(line)
    if (!cells || cells.length < 2) return null

    const alignments = []
    for (const cell of cells) {
        const trimmed = cell.trim()
        if (!REGEX_TABLE_SEPARATOR_CELL.test(trimmed)) {
            return null
        }
        const isLeftAligned = trimmed.startsWith(':')
        const isRightAligned = trimmed.endsWith(':')
        alignments.push(
            isLeftAligned && isRightAligned ? 'center' : isRightAligned ? 'right' : isLeftAligned ? 'left' : null
        )
    }
    return alignments
}

/**
 * Normalize a row to the expected column count
 */
const normalizeTableRow = (row, columnCount) => {
    const normalized = row.slice(0, columnCount)
    while (normalized.length < columnCount) {
        normalized.push('')
    }
    return normalized
}

/**
 * Try to parse a markdown table starting at startIndex in the lines array.
 * Returns { rows, alignments, endIndex } or null.
 */
export const getMarkdownTableAt = (lines, startIndex) => {
    if (startIndex + 1 >= lines.length) return null

    const headerCells = parseTableRow(lines[startIndex])
    const alignments = parseTableAlignments(lines[startIndex + 1])
    if (!headerCells || !alignments) return null

    const columnCount = Math.max(headerCells.length, alignments.length)
    const rows = [normalizeTableRow(headerCells, columnCount)]
    let endIndex = startIndex + 1

    for (let lineIndex = startIndex + 2; lineIndex < lines.length; lineIndex++) {
        const rowCells = parseTableRow(lines[lineIndex])
        if (!rowCells || parseTableAlignments(lines[lineIndex])) {
            break
        }
        rows.push(normalizeTableRow(rowCells, columnCount))
        endIndex = lineIndex
    }

    return {
        rows,
        alignments: normalizeTableRow(alignments, columnCount),
        endIndex,
    }
}

/**
 * Scan all lines for any markdown table
 */
const findMarkdownTable = lines => {
    for (let i = 0; i < lines.length - 1; i++) {
        if (getMarkdownTableAt(lines, i)) {
            return true
        }
    }
    return false
}

/**
 * Parse a single line and determine its markdown type
 * @param {string} line - The line to parse
 * @returns {object} - Object with type and content
 */
export const parseLineType = line => {
    const trimmedLine = line.trim()

    // Check for horizontal rule first (before checking bullets with dashes)
    if (REGEX_HORIZONTAL_RULE.test(trimmedLine)) {
        return { type: 'hr', text: '' }
    }

    // Check for headers
    const h3Match = trimmedLine.match(REGEX_HEADER_3)
    if (h3Match) {
        return { type: 'h3', text: h3Match[1] }
    }
    const h2Match = trimmedLine.match(REGEX_HEADER_2)
    if (h2Match) {
        return { type: 'h2', text: h2Match[1] }
    }
    const h1Match = trimmedLine.match(REGEX_HEADER_1)
    if (h1Match) {
        return { type: 'h1', text: h1Match[1] }
    }

    // Check for checkboxes
    const uncheckedMatch = trimmedLine.match(REGEX_CHECKBOX_UNCHECKED)
    if (uncheckedMatch) {
        return { type: 'checkbox', text: uncheckedMatch[1], checked: false }
    }
    const checkedMatch = trimmedLine.match(REGEX_CHECKBOX_CHECKED)
    if (checkedMatch) {
        return { type: 'checkbox', text: checkedMatch[1], checked: true }
    }

    // Check for bullet lists
    const bulletMatch = trimmedLine.match(REGEX_BULLET_LIST)
    if (bulletMatch) {
        return { type: 'bullet', text: bulletMatch[1] }
    }

    // Check for numbered lists
    const numberedMatch = trimmedLine.match(REGEX_NUMBERED_LIST)
    if (numberedMatch) {
        return { type: 'numbered', text: numberedMatch[2], number: numberedMatch[1] }
    }

    // Regular text
    return { type: 'text', text: line }
}

/**
 * Parse inline formatting (bold, italic, strikethrough) in text
 * Returns array of segments with their formatting
 * @param {string} text - Text to parse
 * @returns {array} - Array of { text, bold, italic, strikethrough } objects
 */
export const parseInlineFormatting = text => {
    if (!text) return [{ text: '', bold: false, italic: false, strikethrough: false }]

    const segments = []
    let remaining = text

    // Helper to find the next match
    const findNextMatch = str => {
        const matches = []

        // Bold+Italic (must check first as it contains ** and *)
        const boldItalicMatch = /\*\*\*(.+?)\*\*\*/.exec(str)
        if (boldItalicMatch) {
            matches.push({
                index: boldItalicMatch.index,
                length: boldItalicMatch[0].length,
                text: boldItalicMatch[1],
                bold: true,
                italic: true,
                strikethrough: false,
            })
        }

        // Bold
        const boldMatch = /\*\*(.+?)\*\*/.exec(str)
        if (boldMatch && (!boldItalicMatch || boldMatch.index < boldItalicMatch.index)) {
            // Make sure it's not part of a bold+italic
            const beforeBold = str.substring(0, boldMatch.index)
            const afterBold = str.substring(boldMatch.index + boldMatch[0].length)
            if (!beforeBold.endsWith('*') && !afterBold.startsWith('*')) {
                matches.push({
                    index: boldMatch.index,
                    length: boldMatch[0].length,
                    text: boldMatch[1],
                    bold: true,
                    italic: false,
                    strikethrough: false,
                })
            }
        }

        // Italic (single asterisk, not preceded or followed by another asterisk)
        let italicSearchStart = 0
        let italicMatch = null
        while (italicSearchStart < str.length) {
            const searchStr = str.substring(italicSearchStart)
            const match = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/.exec(searchStr)
            if (match) {
                const actualIndex = italicSearchStart + match.index
                // Verify it's not part of bold or bold+italic
                const before = str.substring(0, actualIndex)
                const after = str.substring(actualIndex + match[0].length)
                if (!before.endsWith('*') && !after.startsWith('*')) {
                    italicMatch = {
                        index: actualIndex,
                        length: match[0].length,
                        text: match[1],
                        bold: false,
                        italic: true,
                        strikethrough: false,
                    }
                    break
                }
                italicSearchStart = actualIndex + 1
            } else {
                break
            }
        }
        if (italicMatch) {
            matches.push(italicMatch)
        }

        // Strikethrough
        const strikeMatch = /~~(.+?)~~/.exec(str)
        if (strikeMatch) {
            matches.push({
                index: strikeMatch.index,
                length: strikeMatch[0].length,
                text: strikeMatch[1],
                bold: false,
                italic: false,
                strikethrough: true,
            })
        }

        // Return the earliest match
        if (matches.length === 0) return null
        return matches.reduce((earliest, current) => (current.index < earliest.index ? current : earliest))
    }

    while (remaining.length > 0) {
        const match = findNextMatch(remaining)

        if (!match) {
            // No more matches, add remaining text
            if (remaining.length > 0) {
                segments.push({ text: remaining, bold: false, italic: false, strikethrough: false })
            }
            break
        }

        // Add text before the match
        if (match.index > 0) {
            segments.push({
                text: remaining.substring(0, match.index),
                bold: false,
                italic: false,
                strikethrough: false,
            })
        }

        // Add the formatted segment
        segments.push({
            text: match.text,
            bold: match.bold,
            italic: match.italic,
            strikethrough: match.strikethrough,
        })

        // Continue with remaining text
        remaining = remaining.substring(match.index + match.length)
    }

    return segments.length > 0 ? segments : [{ text: '', bold: false, italic: false, strikethrough: false }]
}

/**
 * Process all lines and return structured markdown data.
 * Handles multi-line table blocks by consuming consecutive table lines.
 * @param {string} text - Full text to parse
 * @returns {array} - Array of parsed line objects
 */
export const parseMarkdownLines = text => {
    if (!text) return []

    const lines = text.split('\n')
    const result = []
    let i = 0

    while (i < lines.length) {
        // Try to detect a table starting at this line
        const table = getMarkdownTableAt(lines, i)
        if (table) {
            result.push({
                type: 'table',
                rows: table.rows,
                alignments: table.alignments,
            })
            i = table.endIndex + 1
            continue
        }

        const lineData = parseLineType(lines[i])
        // Parse inline formatting for the text content
        if (lineData.text) {
            lineData.segments = parseInlineFormatting(lineData.text)
        }
        result.push(lineData)
        i++
    }

    return result
}

/**
 * Check if text contains any markdown syntax
 * @param {string} text - Text to check
 * @returns {boolean} - True if contains markdown
 */
export const containsMarkdown = text => {
    if (!text) return false

    const lines = text.split('\n')

    // Check for tables
    if (findMarkdownTable(lines)) {
        return true
    }

    for (const line of lines) {
        const trimmed = line.trim()
        // Check line-level markdown
        if (
            /^#\s+/.test(trimmed) ||
            /^##\s+/.test(trimmed) ||
            /^###\s+/.test(trimmed) ||
            /^[-*]\s+/.test(trimmed) ||
            /^\d+\.\s+/.test(trimmed) ||
            REGEX_HORIZONTAL_RULE.test(trimmed)
        ) {
            return true
        }
    }

    // Check inline markdown
    if (
        /\*\*\*.+?\*\*\*/.test(text) ||
        /\*\*.+?\*\*/.test(text) ||
        /(?<!\*)\*(?!\*).+?(?<!\*)\*(?!\*)/.test(text) ||
        /~~.+?~~/.test(text)
    ) {
        return true
    }

    return false
}
