import MarkdownTableFormat from './MarkdownTableFormat'
import { markdownTableToMarkdown } from '../../../../functions/Assistant/deltaToMarkdown'

export const markdownTableClipboardText = table => `${markdownTableToMarkdown(table)}\n\n`

export const markdownTableClipboardHtml = table => {
    // Render saved data rather than live DOM, which can contain a draft and controls.
    // A pasted table gets its own identity; the metadata lets Quill restore exact
    // Markdown cells while other rich-text applications receive a normal HTML table.
    const node = MarkdownTableFormat.create({ rows: table.rows, alignments: table.alignments })
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    const textNodes = []
    while (walker.nextNode()) textNodes.push(walker.currentNode)
    textNodes.forEach(text => {
        if (!text.data.includes('\n')) return
        const fragments = text.data
            .split('\n')
            .flatMap((line, index) =>
                index ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)]
            )
        text.replaceWith(...fragments)
    })
    return node.outerHTML
}

export const hasMarkdownTableClipboardHtml = html =>
    !!html &&
    !!new DOMParser().parseFromString(html, 'text/html').querySelector('.ql-markdownTable[data-markdown-table]')
