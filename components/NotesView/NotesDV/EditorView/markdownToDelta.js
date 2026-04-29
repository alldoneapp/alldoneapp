/**
 * Markdown to Quill Delta converter
 * Converts markdown syntax to Quill Delta operations for rich text rendering
 */

// Regex patterns for markdown detection
const REGEX_HEADER_1 = /^# (.+)$/
const REGEX_HEADER_2 = /^## (.+)$/
const REGEX_HEADER_3 = /^### (.+)$/
const REGEX_BULLET_LIST = /^[-*] (.+)$/
const REGEX_NUMBERED_LIST = /^(\d+)[.\)] (.+)$/ // Support both "1." and "1)" formats
const REGEX_HORIZONTAL_RULE = /^(-{3,}|_{3,}|\*{3,})$/
const REGEX_CHECKBOX_UNCHECKED = /^- \[ \] (.+)$/
const REGEX_CHECKBOX_CHECKED = /^- \[x\] (.+)$/i
const REGEX_TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/

// Inline markdown patterns
const REGEX_BOLD_ITALIC = /\*\*\*(.+?)\*\*\*/g
const REGEX_BOLD = /\*\*(.+?)\*\*/g
const REGEX_ITALIC = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g
const REGEX_STRIKETHROUGH = /~~(.+?)~~/g

/**
 * Check if text contains markdown syntax that should be converted
 * @param {string} text - Text to check
 * @returns {boolean} - True if contains convertible markdown
 */
export const containsMarkdown = text => {
    if (!text) return false

    const lines = text.split('\n')
    if (findMarkdownTable(lines)) {
        return true
    }

    for (const line of lines) {
        const trimmed = line.trim()
        // Skip empty lines
        if (!trimmed) continue

        // Check line-level markdown
        if (
            REGEX_HEADER_1.test(trimmed) ||
            REGEX_HEADER_2.test(trimmed) ||
            REGEX_HEADER_3.test(trimmed) ||
            REGEX_BULLET_LIST.test(trimmed) ||
            REGEX_NUMBERED_LIST.test(trimmed) ||
            REGEX_HORIZONTAL_RULE.test(trimmed) ||
            REGEX_CHECKBOX_UNCHECKED.test(trimmed) ||
            REGEX_CHECKBOX_CHECKED.test(trimmed)
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

const endsWithUnescapedPipe = line => {
    const trimmed = line.trim()
    if (!trimmed.endsWith('|')) return false

    let backslashCount = 0
    for (let i = trimmed.length - 2; i >= 0 && trimmed[i] === '\\'; i--) {
        backslashCount += 1
    }
    return backslashCount % 2 === 0
}

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

const parseTableRow = line => {
    if (!hasUnescapedPipe(line)) return null

    const cells = splitMarkdownTableRow(line)
    return cells.length > 1 ? cells : null
}

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

const normalizeTableRow = (row, columnCount) => {
    const normalized = row.slice(0, columnCount)
    while (normalized.length < columnCount) {
        normalized.push('')
    }
    return normalized
}

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

const findMarkdownTable = lines => {
    for (let i = 0; i < lines.length - 1; i++) {
        if (getMarkdownTableAt(lines, i)) {
            return true
        }
    }
    return false
}

/**
 * Parse inline formatting and return array of segments with their formatting
 * @param {string} text - Text to parse
 * @returns {array} - Array of { text, bold, italic, strike } objects
 */
const parseInlineFormatting = text => {
    if (!text) return [{ text: '', bold: false, italic: false, strike: false }]

    const segments = []
    let remaining = text

    const findNextMatch = str => {
        const matches = []

        // Bold+Italic (must check first)
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

        // Bold
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

        // Italic
        let italicSearchStart = 0
        let italicMatch = null
        while (italicSearchStart < str.length) {
            const searchStr = str.substring(italicSearchStart)
            const match = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/.exec(searchStr)
            if (match) {
                const actualIndex = italicSearchStart + match.index
                const before = str.substring(0, actualIndex)
                const after = str.substring(actualIndex + match[0].length)
                if (!before.endsWith('*') && !after.startsWith('*')) {
                    italicMatch = {
                        index: actualIndex,
                        length: match[0].length,
                        text: match[1],
                        bold: false,
                        italic: true,
                        strike: false,
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
                strike: true,
            })
        }

        if (matches.length === 0) return null
        return matches.reduce((earliest, current) => (current.index < earliest.index ? current : earliest))
    }

    while (remaining.length > 0) {
        const match = findNextMatch(remaining)

        if (!match) {
            if (remaining.length > 0) {
                segments.push({ text: remaining, bold: false, italic: false, strike: false })
            }
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

/**
 * Calculate indentation level from leading whitespace
 * @param {string} line - Line to check
 * @returns {number} - Indent level (0, 1, 2, etc.)
 */
const getIndentLevel = line => {
    const match = line.match(/^(\s*)/)
    if (!match) return 0
    const whitespace = match[1]
    // Count spaces (2-4 spaces = 1 indent level) or tabs
    const spaces = whitespace.replace(/\t/g, '    ').length
    return Math.floor(spaces / 2) // Every 2+ spaces is one indent level
}

/**
 * Parse a line and determine its markdown type
 * @param {string} line - Line to parse
 * @returns {object} - { type, text, number?, checked?, indent? }
 */
const parseLineType = line => {
    const trimmed = line.trim()
    const indent = getIndentLevel(line)

    // Empty line - preserve as blank line (not a list item)
    if (!trimmed) {
        return { type: 'empty', text: '', indent: 0 }
    }

    // Skip lines that are just bullet markers with no content (e.g., "- " or "* ")
    if (/^[-*]\s*$/.test(trimmed)) {
        console.log(`[markdownToDelta] Skipping empty bullet marker: "${trimmed}"`)
        return { type: 'empty', text: '', indent: 0 }
    }

    // Horizontal rule
    if (REGEX_HORIZONTAL_RULE.test(trimmed)) {
        return { type: 'hr', text: '', indent: 0 }
    }

    // Headers
    const h3Match = trimmed.match(REGEX_HEADER_3)
    if (h3Match) {
        return { type: 'header', level: 3, text: h3Match[1], indent: 0 }
    }
    const h2Match = trimmed.match(REGEX_HEADER_2)
    if (h2Match) {
        return { type: 'header', level: 2, text: h2Match[1], indent: 0 }
    }
    const h1Match = trimmed.match(REGEX_HEADER_1)
    if (h1Match) {
        return { type: 'header', level: 1, text: h1Match[1], indent: 0 }
    }

    // Checkboxes
    const uncheckedMatch = trimmed.match(REGEX_CHECKBOX_UNCHECKED)
    if (uncheckedMatch) {
        return { type: 'checkbox', text: uncheckedMatch[1], checked: false, indent }
    }
    const checkedMatch = trimmed.match(REGEX_CHECKBOX_CHECKED)
    if (checkedMatch) {
        return { type: 'checkbox', text: checkedMatch[1], checked: true, indent }
    }

    // Bullet list
    const bulletMatch = trimmed.match(REGEX_BULLET_LIST)
    if (bulletMatch) {
        return { type: 'bullet', text: bulletMatch[1], indent }
    }

    // Numbered list (supports both "1." and "1)" formats)
    const numberedMatch = trimmed.match(REGEX_NUMBERED_LIST)
    if (numberedMatch) {
        return { type: 'ordered', text: numberedMatch[2], number: numberedMatch[1], indent }
    }

    // Regular text
    return { type: 'text', text: line, indent: 0 }
}

/**
 * Convert markdown text to Quill Delta operations
 * @param {string} text - Markdown text to convert
 * @param {function} Delta - Quill Delta constructor
 * @returns {Delta} - Quill Delta with converted content
 */
export const markdownToDelta = (text, Delta) => {
    console.log('[markdownToDelta] ========== START ==========')
    console.log('[markdownToDelta] Input text:', JSON.stringify(text))
    console.log('[markdownToDelta] Contains markdown:', containsMarkdown(text))

    if (!text || !containsMarkdown(text)) {
        console.log('[markdownToDelta] No markdown detected, returning null')
        return null // Return null if no markdown to convert
    }

    const delta = new Delta()
    const lines = text.split('\n')
    let previousWasList = false
    let previousWasHeader = false

    console.log('[markdownToDelta] Split into', lines.length, 'lines')

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const table = getMarkdownTableAt(lines, lineIndex)
        if (table) {
            const isLastTableLine = table.endIndex === lines.length - 1
            console.log(`[markdownToDelta] Line ${lineIndex}: inserting markdown table`)
            delta.insert({ markdownTable: { rows: table.rows, alignments: table.alignments } })
            if (!isLastTableLine) {
                if (previousWasList) {
                    delta.insert('\n', { list: null })
                } else {
                    delta.insert('\n')
                }
            }
            previousWasList = false
            previousWasHeader = false
            lineIndex = table.endIndex
            continue
        }

        const line = lines[lineIndex]
        const parsed = parseLineType(line)
        const isLastLine = lineIndex === lines.length - 1
        const isListItem = parsed.type === 'bullet' || parsed.type === 'ordered' || parsed.type === 'checkbox'

        console.log(
            `[markdownToDelta] Line ${lineIndex}: "${line}" -> type: ${parsed.type}, previousWasList: ${previousWasList}, previousWasHeader: ${previousWasHeader}`
        )

        if (parsed.type === 'empty') {
            // Skip empty lines immediately after headers to avoid excessive spacing
            if (previousWasHeader) {
                console.log(`[markdownToDelta]   -> Skipping empty line after header`)
                previousWasHeader = false
                previousWasList = false
                continue // Skip this empty line
            }
            // Empty line after a list needs explicit list:null to break the list context
            // Quill may otherwise inherit list formatting from the previous line
            if (!isLastLine) {
                if (previousWasList) {
                    console.log(`[markdownToDelta]   -> Inserting empty line with {list: null} to break list context`)
                    delta.insert('\n', { list: null })
                } else {
                    console.log(`[markdownToDelta]   -> Inserting empty line (plain \\n)`)
                    delta.insert('\n')
                }
            }
            previousWasList = false
            previousWasHeader = false
        } else if (parsed.type === 'hr') {
            // Horizontal rule - if coming after a list, explicitly break list formatting (shorter to fit mobile)
            console.log(`[markdownToDelta]   -> Inserting HR`)
            delta.insert('───────────')
            if (!isLastLine) {
                if (previousWasList) {
                    console.log(`[markdownToDelta]   -> HR newline with {list: null}`)
                    delta.insert('\n', { list: null })
                } else {
                    console.log(`[markdownToDelta]   -> HR newline (plain)`)
                    delta.insert('\n')
                }
            }
            previousWasList = false
            previousWasHeader = false
        } else if (parsed.type === 'header') {
            // Parse inline formatting within the header text
            console.log(`[markdownToDelta]   -> Inserting header level ${parsed.level}: "${parsed.text}"`)
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                // Explicitly set all formatting attributes to prevent inheritance
                // In Quill Delta, passing undefined allows attribute inheritance from adjacent text
                // We must explicitly set attributes to null/false to clear them
                const attrs = {
                    bold: segment.bold ? true : null,
                    italic: segment.italic ? true : null,
                    strike: segment.strike ? true : null,
                }
                delta.insert(segment.text, attrs)
            })
            // Header formatting is applied via newline attributes in Quill
            delta.insert('\n', { header: parsed.level })
            previousWasList = false
            previousWasHeader = true
        } else if (parsed.type === 'bullet') {
            console.log(`[markdownToDelta]   -> Inserting bullet: "${parsed.text}", indent: ${parsed.indent}`)
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                // Explicitly set all formatting attributes to prevent inheritance
                const attrs = {
                    bold: segment.bold ? true : null,
                    italic: segment.italic ? true : null,
                    strike: segment.strike ? true : null,
                }
                delta.insert(segment.text, attrs)
            })
            // Apply indent level for nested lists
            const listAttrs = { list: 'bullet' }
            if (parsed.indent > 0) {
                listAttrs.indent = Math.min(parsed.indent, 8) // Quill supports up to 8 indent levels
            }
            console.log(`[markdownToDelta]   -> Bullet newline attrs:`, JSON.stringify(listAttrs))
            delta.insert('\n', listAttrs)
            previousWasList = true
            previousWasHeader = false
        } else if (parsed.type === 'ordered') {
            console.log(`[markdownToDelta]   -> Inserting ordered: "${parsed.text}", indent: ${parsed.indent}`)
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                // Explicitly set all formatting attributes to prevent inheritance
                const attrs = {
                    bold: segment.bold ? true : null,
                    italic: segment.italic ? true : null,
                    strike: segment.strike ? true : null,
                }
                delta.insert(segment.text, attrs)
            })
            // Apply indent level for nested lists
            const listAttrs = { list: 'ordered' }
            if (parsed.indent > 0) {
                listAttrs.indent = Math.min(parsed.indent, 8)
            }
            console.log(`[markdownToDelta]   -> Ordered newline attrs:`, JSON.stringify(listAttrs))
            delta.insert('\n', listAttrs)
            previousWasList = true
            previousWasHeader = false
        } else if (parsed.type === 'checkbox') {
            // Convert checkbox to bullet item (without separate checkbox prefix to avoid double indicators)
            console.log(
                `[markdownToDelta]   -> Inserting checkbox as bullet: "${parsed.text}", checked: ${parsed.checked}`
            )
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                // Explicitly set all formatting attributes to prevent inheritance
                const attrs = {
                    bold: segment.bold ? true : null,
                    italic: segment.italic ? true : null,
                    // Strike through checked items
                    strike: segment.strike || parsed.checked ? true : null,
                }
                delta.insert(segment.text, attrs)
            })
            // Apply indent level for nested checkboxes
            const listAttrs = { list: 'bullet' }
            if (parsed.indent > 0) {
                listAttrs.indent = Math.min(parsed.indent, 8)
            }
            delta.insert('\n', listAttrs)
            previousWasList = true
            previousWasHeader = false
        } else {
            // Regular text - parse inline formatting
            console.log(`[markdownToDelta]   -> Inserting regular text: "${parsed.text}"`)
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                // Explicitly set all formatting attributes to prevent inheritance
                const attrs = {
                    bold: segment.bold ? true : null,
                    italic: segment.italic ? true : null,
                    strike: segment.strike ? true : null,
                }
                delta.insert(segment.text, attrs)
            })
            if (!isLastLine) {
                // If previous line was a list, explicitly remove list formatting
                if (previousWasList) {
                    console.log(`[markdownToDelta]   -> Text newline with {list: null} to break list`)
                    delta.insert('\n', { list: null })
                } else {
                    console.log(`[markdownToDelta]   -> Text newline (plain)`)
                    delta.insert('\n')
                }
            }
            previousWasList = false
            previousWasHeader = false
        }
    }

    console.log('[markdownToDelta] Final delta ops:', JSON.stringify(delta.ops, null, 2))
    console.log('[markdownToDelta] ========== END ==========')
    return delta
}

/**
 * Process pasted text, converting markdown if detected
 * Falls back to original processing if no markdown found
 * @param {string} text - Pasted text
 * @param {function} Delta - Quill Delta constructor
 * @param {function} fallbackProcessor - Original paste processor function
 * @param {array} fallbackArgs - Arguments for fallback processor
 * @returns {Delta} - Processed Delta
 */
export const processMarkdownPaste = (text, Delta, fallbackProcessor, fallbackArgs) => {
    const markdownDelta = markdownToDelta(text, Delta)

    if (markdownDelta) {
        return markdownDelta
    }

    // No markdown detected, use original processor
    return fallbackProcessor(...fallbackArgs)
}
