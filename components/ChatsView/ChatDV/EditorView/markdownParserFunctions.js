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
 * Process all lines and return structured markdown data
 * @param {string} text - Full text to parse
 * @returns {array} - Array of parsed line objects
 */
export const parseMarkdownLines = text => {
    if (!text) return []

    const lines = text.split('\n')
    return lines.map((line, index) => {
        const lineData = parseLineType(line)
        // DEBUG: Log bullet parsing
        if (lineData.type === 'bullet') {
            console.log(`=== BULLET LINE ${index} ===`)
            console.log('Original line:', JSON.stringify(line))
            console.log('Parsed text:', JSON.stringify(lineData.text))
            console.log('First char code of text:', lineData.text ? lineData.text.charCodeAt(0) : 'N/A')
        }
        // Parse inline formatting for the text content
        if (lineData.text) {
            lineData.segments = parseInlineFormatting(lineData.text)
        }
        return lineData
    })
}

/**
 * Check if text contains any markdown syntax
 * @param {string} text - Text to check
 * @returns {boolean} - True if contains markdown
 */
export const containsMarkdown = text => {
    if (!text) return false

    const lines = text.split('\n')
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
