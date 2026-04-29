/**
 * Markdown to Yjs Converter
 * Converts markdown syntax to Yjs text insertions with Quill-compatible formatting
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

/**
 * Check if text contains markdown syntax that should be converted
 * @param {string} text - Text to check
 * @returns {boolean} - True if contains convertible markdown
 */
function containsMarkdown(text) {
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
    if (/\*\*\*.+?\*\*\*/.test(text) || /\*\*.+?\*\*/.test(text) || /~~.+?~~/.test(text)) {
        return true
    }

    return false
}

function hasUnescapedPipe(line) {
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

function endsWithUnescapedPipe(line) {
    const trimmed = line.trim()
    if (!trimmed.endsWith('|')) return false

    let backslashCount = 0
    for (let i = trimmed.length - 2; i >= 0 && trimmed[i] === '\\'; i--) {
        backslashCount += 1
    }
    return backslashCount % 2 === 0
}

function trimOuterTablePipes(line) {
    let trimmed = line.trim()
    if (trimmed.startsWith('|')) {
        trimmed = trimmed.substring(1)
    }
    if (endsWithUnescapedPipe(trimmed)) {
        trimmed = trimmed.substring(0, trimmed.length - 1)
    }
    return trimmed
}

function splitMarkdownTableRow(line) {
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

function parseTableRow(line) {
    if (!hasUnescapedPipe(line)) return null

    const cells = splitMarkdownTableRow(line)
    return cells.length > 1 ? cells : null
}

function parseTableAlignments(line) {
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

function normalizeTableRow(row, columnCount) {
    const normalized = row.slice(0, columnCount)
    while (normalized.length < columnCount) {
        normalized.push('')
    }
    return normalized
}

function getMarkdownTableAt(lines, startIndex) {
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

function findMarkdownTable(lines) {
    for (let i = 0; i < lines.length - 1; i++) {
        if (getMarkdownTableAt(lines, i)) {
            return true
        }
    }
    return false
}

/**
 * Calculate indentation level from leading whitespace
 * @param {string} line - Line to check
 * @returns {number} - Indent level (0, 1, 2, etc.)
 */
function getIndentLevel(line) {
    const match = line.match(/^(\s*)/)
    if (!match) return 0
    const whitespace = match[1]
    const spaces = whitespace.replace(/\t/g, '    ').length
    return Math.floor(spaces / 2)
}

/**
 * Parse inline formatting and return array of segments
 * @param {string} text - Text to parse
 * @returns {array} - Array of { text, bold, italic, strike } objects
 */
function parseInlineFormatting(text) {
    if (!text) return [{ text: '', bold: false, italic: false, strike: false }]

    const segments = []
    let remaining = text

    const findNextMatch = str => {
        const matches = []

        // Bold+Italic
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
 * Parse a line and determine its markdown type
 * @param {string} line - Line to parse
 * @returns {object} - { type, text, level?, indent? }
 */
function parseLineType(line) {
    const trimmed = line.trim()
    const indent = getIndentLevel(line)

    // Empty line - preserve as blank line (not a list item)
    if (!trimmed) {
        return { type: 'empty', text: '', indent: 0 }
    }

    // Skip lines that are just bullet markers with no content (e.g., "- " or "* ")
    if (/^[-*]\s*$/.test(trimmed)) {
        console.log(`[markdownToYjs] Skipping empty bullet marker: "${trimmed}"`)
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

    // Numbered list
    const numberedMatch = trimmed.match(REGEX_NUMBERED_LIST)
    if (numberedMatch) {
        return { type: 'ordered', text: numberedMatch[2], number: numberedMatch[1], indent }
    }

    // Regular text
    return { type: 'text', text: line, indent: 0 }
}

/**
 * Insert markdown-formatted content into a Yjs Y.Text at a given position
 * Converts markdown syntax to Quill-compatible formatting attributes
 *
 * @param {Y.Text} ytext - The Yjs text object
 * @param {number} startPosition - Position to start inserting
 * @param {string} markdownContent - Markdown text to convert and insert
 * @returns {number} - The new position after all insertions
 */
function insertMarkdownToYjs(ytext, startPosition, markdownContent) {
    console.log('[markdownToYjs] ========== START ==========')
    console.log('[markdownToYjs] Input content:', JSON.stringify(markdownContent))
    console.log('[markdownToYjs] Start position:', startPosition)
    console.log('[markdownToYjs] Contains markdown:', containsMarkdown(markdownContent))

    if (!markdownContent || !containsMarkdown(markdownContent)) {
        // No markdown, insert as plain text
        console.log('[markdownToYjs] No markdown detected, inserting as plain text')
        ytext.insert(startPosition, markdownContent)
        return startPosition + markdownContent.length
    }

    let currentPosition = startPosition
    const lines = markdownContent.split('\n')
    let previousWasList = false
    let previousWasHeader = false

    console.log('[markdownToYjs] Split into', lines.length, 'lines')

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const table = getMarkdownTableAt(lines, lineIndex)
        if (table) {
            const isLastTableLine = table.endIndex === lines.length - 1
            console.log(`[markdownToYjs] Line ${lineIndex}: inserting markdown table at pos ${currentPosition}`)
            ytext.insert(currentPosition, { markdownTable: { rows: table.rows, alignments: table.alignments } })
            currentPosition += 1
            if (!isLastTableLine) {
                if (previousWasList) {
                    ytext.insert(currentPosition, '\n', { list: null })
                } else {
                    ytext.insert(currentPosition, '\n')
                }
                currentPosition += 1
            }
            previousWasList = false
            previousWasHeader = false
            lineIndex = table.endIndex
            continue
        }

        const line = lines[lineIndex]
        const parsed = parseLineType(line)
        const isLastLine = lineIndex === lines.length - 1

        console.log(
            `[markdownToYjs] Line ${lineIndex}: "${line}" -> type: ${parsed.type}, previousWasList: ${previousWasList}, previousWasHeader: ${previousWasHeader}`
        )

        if (parsed.type === 'empty') {
            // Skip empty lines immediately after headers to avoid excessive spacing
            if (previousWasHeader) {
                console.log(`[markdownToYjs]   -> Skipping empty line after header`)
                previousWasHeader = false
                previousWasList = false
                continue // Skip this empty line
            }
            // Empty line after a list needs explicit list:null to break the list context
            if (!isLastLine) {
                if (previousWasList) {
                    console.log(`[markdownToYjs]   -> Inserting empty line with {list: null} at pos ${currentPosition}`)
                    ytext.insert(currentPosition, '\n', { list: null })
                } else {
                    console.log(`[markdownToYjs]   -> Inserting empty line (plain \\n) at pos ${currentPosition}`)
                    ytext.insert(currentPosition, '\n')
                }
                currentPosition += 1
            }
            previousWasList = false
            previousWasHeader = false
        } else if (parsed.type === 'hr') {
            // Horizontal rule - insert visual divider (shorter to fit mobile screens)
            console.log(`[markdownToYjs]   -> Inserting HR at pos ${currentPosition}`)
            const hrText = '────────────────────'
            ytext.insert(currentPosition, hrText)
            currentPosition += hrText.length
            if (!isLastLine) {
                if (previousWasList) {
                    console.log(`[markdownToYjs]   -> HR newline with {list: null} at pos ${currentPosition}`)
                    ytext.insert(currentPosition, '\n', { list: null })
                } else {
                    console.log(`[markdownToYjs]   -> HR newline (plain) at pos ${currentPosition}`)
                    ytext.insert(currentPosition, '\n')
                }
                currentPosition += 1
            }
            previousWasList = false
            previousWasHeader = false
        } else if (parsed.type === 'header') {
            // Insert header text with inline formatting
            console.log(
                `[markdownToYjs]   -> Inserting header level ${parsed.level}: "${parsed.text}" at pos ${currentPosition}`
            )
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                // Explicitly set all formatting attributes to prevent inheritance
                // In Yjs, passing undefined allows attribute inheritance from adjacent text
                // We must explicitly set attributes to null to clear them
                const attrs = {
                    bold: segment.bold ? true : null,
                    italic: segment.italic ? true : null,
                    strike: segment.strike ? true : null,
                }
                ytext.insert(currentPosition, segment.text, attrs)
                currentPosition += segment.text.length
            })
            // Insert newline with header formatting
            ytext.insert(currentPosition, '\n', { header: parsed.level })
            currentPosition += 1
            previousWasList = false
            previousWasHeader = true
        } else if (parsed.type === 'bullet' || parsed.type === 'ordered') {
            // Insert list item text with inline formatting
            console.log(
                `[markdownToYjs]   -> Inserting ${parsed.type}: "${parsed.text}", indent: ${parsed.indent} at pos ${currentPosition}`
            )
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                // Explicitly set all formatting attributes to prevent inheritance
                // In Yjs, passing undefined allows attribute inheritance from adjacent text
                // We must explicitly set attributes to null to clear them
                const attrs = {
                    bold: segment.bold ? true : null,
                    italic: segment.italic ? true : null,
                    strike: segment.strike ? true : null,
                }
                ytext.insert(currentPosition, segment.text, attrs)
                currentPosition += segment.text.length
            })
            // Insert newline with list formatting
            const listAttrs = { list: parsed.type === 'bullet' ? 'bullet' : 'ordered' }
            if (parsed.indent > 0) {
                listAttrs.indent = Math.min(parsed.indent, 8)
            }
            console.log(`[markdownToYjs]   -> List newline attrs:`, JSON.stringify(listAttrs))
            ytext.insert(currentPosition, '\n', listAttrs)
            currentPosition += 1
            previousWasList = true
            previousWasHeader = false
        } else if (parsed.type === 'checkbox') {
            // Insert checkbox as bullet item (without separate checkbox prefix to avoid double indicators)
            console.log(
                `[markdownToYjs]   -> Inserting checkbox as bullet: "${parsed.text}", checked: ${parsed.checked} at pos ${currentPosition}`
            )

            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                // Explicitly set all formatting attributes to prevent inheritance
                // In Yjs, passing undefined allows attribute inheritance from adjacent text
                // We must explicitly set attributes to null to clear them
                const attrs = {
                    bold: segment.bold ? true : null,
                    italic: segment.italic ? true : null,
                    // Strike through checked items
                    strike: segment.strike || parsed.checked ? true : null,
                }
                ytext.insert(currentPosition, segment.text, attrs)
                currentPosition += segment.text.length
            })
            // Insert newline with bullet formatting (checkbox becomes a simple bullet item)
            const listAttrs = { list: 'bullet' }
            if (parsed.indent > 0) {
                listAttrs.indent = Math.min(parsed.indent, 8)
            }
            console.log(`[markdownToYjs]   -> Checkbox newline attrs:`, JSON.stringify(listAttrs))
            ytext.insert(currentPosition, '\n', listAttrs)
            currentPosition += 1
            previousWasList = true
            previousWasHeader = false
        } else {
            // Regular text - parse inline formatting
            console.log(`[markdownToYjs]   -> Inserting regular text: "${parsed.text}" at pos ${currentPosition}`)
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                // Explicitly set all formatting attributes to prevent inheritance
                // In Yjs, passing undefined allows attribute inheritance from adjacent text
                // We must explicitly set attributes to null to clear them
                const attrs = {
                    bold: segment.bold ? true : null,
                    italic: segment.italic ? true : null,
                    strike: segment.strike ? true : null,
                }
                ytext.insert(currentPosition, segment.text, attrs)
                currentPosition += segment.text.length
            })
            if (!isLastLine) {
                if (previousWasList) {
                    console.log(`[markdownToYjs]   -> Text newline with {list: null} at pos ${currentPosition}`)
                    ytext.insert(currentPosition, '\n', { list: null })
                } else {
                    console.log(`[markdownToYjs]   -> Text newline (plain) at pos ${currentPosition}`)
                    ytext.insert(currentPosition, '\n')
                }
                currentPosition += 1
            }
            previousWasList = false
            previousWasHeader = false
        }
    }

    console.log('[markdownToYjs] Final position:', currentPosition)
    console.log('[markdownToYjs] ========== END ==========')
    return currentPosition
}

module.exports = {
    containsMarkdown,
    insertMarkdownToYjs,
    parseInlineFormatting,
    parseLineType,
    splitMarkdownTableRow,
    getMarkdownTableAt,
}
