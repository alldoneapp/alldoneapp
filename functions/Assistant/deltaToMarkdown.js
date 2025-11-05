/**
 * Delta to Markdown Converter
 * Converts Quill Delta operations to Markdown format
 */

/**
 * Convert Quill Delta ops to markdown text
 * @param {Array} ops - Quill Delta operations
 * @returns {string} Markdown formatted text
 */
function deltaToMarkdown(ops) {
    if (!ops || !Array.isArray(ops)) {
        return ''
    }

    let markdown = ''
    let listLevel = 0
    let inList = false

    for (let i = 0; i < ops.length; i++) {
        const op = ops[i]
        const { insert, attributes } = op

        // Handle different types of inserts
        if (typeof insert === 'string') {
            let text = insert

            // Apply text formatting if attributes exist
            if (attributes) {
                // Bold
                if (attributes.bold) {
                    text = `**${text}**`
                }

                // Italic
                if (attributes.italic) {
                    text = `*${text}*`
                }

                // Code
                if (attributes.code) {
                    text = `\`${text}\``
                }

                // Strike
                if (attributes.strike) {
                    text = `~~${text}~~`
                }

                // Link
                if (attributes.link) {
                    text = `[${text}](${attributes.link})`
                }
            }

            markdown += text
        } else if (typeof insert === 'object') {
            // Handle embedded objects
            const { mention, email, url, hashtag, image } = insert

            if (mention) {
                // User mention - format as @username
                const { text } = mention
                markdown += `@${text}`
            } else if (email) {
                // Email - keep as is
                const { email: emailAddr } = email
                markdown += emailAddr
            } else if (url) {
                // URL object - extract the actual URL
                const { url: link } = url
                markdown += link
            } else if (hashtag) {
                // Hashtag
                const { text } = hashtag
                markdown += `#${text}`
            } else if (image) {
                // Image
                const imageUrl = typeof image === 'string' ? image : image.url || ''
                markdown += `![image](${imageUrl})`
            }
        }

        // Handle newlines and formatting at line level
        if (attributes && insert === '\n') {
            // Headers
            if (attributes.header) {
                const headerLevel = attributes.header
                const headerPrefix = '#'.repeat(headerLevel)
                // Insert header prefix before the last line
                const lines = markdown.split('\n')
                const lastLine = lines[lines.length - 1]
                lines[lines.length - 1] = `${headerPrefix} ${lastLine}`
                markdown = lines.join('\n') + '\n'
                continue
            }

            // Lists
            if (attributes.list) {
                const listType = attributes.list // 'bullet', 'ordered', 'checked', 'unchecked'
                const lines = markdown.split('\n')
                const lastLine = lines[lines.length - 1]

                let prefix = ''
                if (listType === 'bullet') {
                    prefix = '- '
                } else if (listType === 'ordered') {
                    prefix = '1. '
                } else if (listType === 'checked') {
                    prefix = '- [x] '
                } else if (listType === 'unchecked') {
                    prefix = '- [ ] '
                }

                lines[lines.length - 1] = `${prefix}${lastLine}`
                markdown = lines.join('\n') + '\n'
                inList = true
                continue
            }

            // Blockquote
            if (attributes.blockquote) {
                const lines = markdown.split('\n')
                const lastLine = lines[lines.length - 1]
                lines[lines.length - 1] = `> ${lastLine}`
                markdown = lines.join('\n') + '\n'
                continue
            }

            // Code block
            if (attributes['code-block']) {
                const lines = markdown.split('\n')
                const lastLine = lines[lines.length - 1]
                lines[lines.length - 1] = `    ${lastLine}`
                markdown = lines.join('\n') + '\n'
                continue
            }

            // Regular newline
            if (inList && !attributes.list) {
                inList = false
            }
        }
    }

    return markdown.trim()
}

module.exports = {
    deltaToMarkdown,
}
