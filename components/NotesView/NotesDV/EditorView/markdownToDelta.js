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
    if (!text || !containsMarkdown(text)) {
        return null // Return null if no markdown to convert
    }

    const delta = new Delta()
    const lines = text.split('\n')

    lines.forEach((line, lineIndex) => {
        const parsed = parseLineType(line)
        const isLastLine = lineIndex === lines.length - 1

        if (parsed.type === 'empty') {
            // Empty line - just insert a newline (no list formatting)
            if (!isLastLine) {
                delta.insert('\n')
            }
        } else if (parsed.type === 'hr') {
            // Insert a divider/horizontal rule - Quill doesn't have native HR, use a styled block
            delta.insert('───────────────────────────────────────')
            if (!isLastLine) {
                delta.insert('\n')
            }
        } else if (parsed.type === 'header') {
            // Parse inline formatting within the header text
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                const attrs = { header: parsed.level }
                if (segment.bold) attrs.bold = true
                if (segment.italic) attrs.italic = true
                if (segment.strike) attrs.strike = true
                delta.insert(segment.text, attrs)
            })
            // Header formatting is applied via newline attributes in Quill
            delta.insert('\n', { header: parsed.level })
        } else if (parsed.type === 'bullet') {
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                const attrs = {}
                if (segment.bold) attrs.bold = true
                if (segment.italic) attrs.italic = true
                if (segment.strike) attrs.strike = true
                delta.insert(segment.text, Object.keys(attrs).length > 0 ? attrs : undefined)
            })
            // Apply indent level for nested lists
            const listAttrs = { list: 'bullet' }
            if (parsed.indent > 0) {
                listAttrs.indent = Math.min(parsed.indent, 8) // Quill supports up to 8 indent levels
            }
            delta.insert('\n', listAttrs)
        } else if (parsed.type === 'ordered') {
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                const attrs = {}
                if (segment.bold) attrs.bold = true
                if (segment.italic) attrs.italic = true
                if (segment.strike) attrs.strike = true
                delta.insert(segment.text, Object.keys(attrs).length > 0 ? attrs : undefined)
            })
            // Apply indent level for nested lists
            const listAttrs = { list: 'ordered' }
            if (parsed.indent > 0) {
                listAttrs.indent = Math.min(parsed.indent, 8)
            }
            delta.insert('\n', listAttrs)
        } else if (parsed.type === 'checkbox') {
            // Quill doesn't have native checkboxes, convert to bullet with indicator
            const prefix = parsed.checked ? '☑ ' : '☐ '
            delta.insert(prefix)
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                const attrs = {}
                if (segment.bold) attrs.bold = true
                if (segment.italic) attrs.italic = true
                if (segment.strike || parsed.checked) attrs.strike = true
                delta.insert(segment.text, Object.keys(attrs).length > 0 ? attrs : undefined)
            })
            // Apply indent level for nested checkboxes
            const listAttrs = { list: 'bullet' }
            if (parsed.indent > 0) {
                listAttrs.indent = Math.min(parsed.indent, 8)
            }
            delta.insert('\n', listAttrs)
        } else {
            // Regular text - parse inline formatting
            const segments = parseInlineFormatting(parsed.text)
            segments.forEach(segment => {
                const attrs = {}
                if (segment.bold) attrs.bold = true
                if (segment.italic) attrs.italic = true
                if (segment.strike) attrs.strike = true
                delta.insert(segment.text, Object.keys(attrs).length > 0 ? attrs : undefined)
            })
            if (!isLastLine) {
                delta.insert('\n')
            }
        }
    })

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
