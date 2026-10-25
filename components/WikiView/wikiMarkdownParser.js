import { normalizeKnowledgePageSlug, parseKnowledgeSourceKey } from '../../functions/KnowledgeBase/knowledgeBaseModel'

// A small markdown parser for wiki pages. It covers exactly the subset an ingest run writes —
// headings, paragraphs, nested lists, quotes, fenced code, rules, pipe tables, emphasis, inline code,
// links — plus the wiki's own tokens: [[slug|label]] page links and [[task:ID|label]] source
// references. It produces a plain tree that WikiMarkdown.js turns into React elements; nothing is
// ever rendered as HTML, so markup a page might contain is shown as text, never executed.

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/
const FENCE = /^\s*(```|~~~)/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

const INLINE_PATTERNS = [
    { type: 'code', regex: /`([^`\n]+)`/ },
    { type: 'token', regex: /\[\[([^[\]\n|]{1,200})(?:\|([^[\]\n]{1,200}))?\]\]/ },
    { type: 'link', regex: /\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/ },
    { type: 'bold', regex: /\*\*(?=\S)([^\n]*?\S)\*\*|__(?=\S)([^\n]*?\S)__/ },
    { type: 'italic', regex: /\*(?=\S)([^*\n]*?\S)\*|(?:^|(?<=\W))_(?=\S)([^_\n]*?\S)_(?=\W|$)/ },
    { type: 'url', regex: /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/ },
]

function isSafeUrl(url) {
    return /^https?:\/\//i.test(url)
}

function classifyToken(inner, label) {
    const trimmedLabel = label ? label.trim() : ''
    const source = parseKnowledgeSourceKey(inner.trim())
    if (source) {
        return {
            type: 'source',
            key: `${source.type}:${source.id}`,
            objectType: source.type,
            id: source.id,
            label: trimmedLabel,
        }
    }
    const slug = normalizeKnowledgePageSlug(inner)
    if (!slug) return { type: 'text', text: `[[${inner}${label ? `|${label}` : ''}]]` }
    return { type: 'pageLink', slug, label: trimmedLabel || inner.trim() }
}

export function parseInline(text) {
    const nodes = []
    let rest = String(text || '')

    while (rest) {
        let earliest = null
        for (const pattern of INLINE_PATTERNS) {
            const match = pattern.regex.exec(rest)
            if (match && (!earliest || match.index < earliest.match.index)) earliest = { pattern, match }
        }
        if (!earliest) {
            nodes.push({ type: 'text', text: rest })
            break
        }

        const { pattern, match } = earliest
        if (match.index > 0) nodes.push({ type: 'text', text: rest.slice(0, match.index) })

        switch (pattern.type) {
            case 'code':
                nodes.push({ type: 'code', text: match[1] })
                break
            case 'token':
                nodes.push(classifyToken(match[1], match[2]))
                break
            case 'link':
                nodes.push(
                    isSafeUrl(match[2])
                        ? { type: 'link', url: match[2], children: parseInline(match[1]) }
                        : { type: 'text', text: match[1] }
                )
                break
            case 'url':
                nodes.push({ type: 'link', url: match[0], children: [{ type: 'text', text: match[0] }] })
                break
            default:
                nodes.push({ type: pattern.type, children: parseInline(match[1] ?? match[2]) })
        }
        rest = rest.slice(match.index + match[0].length)
    }

    // Adjacent text nodes are merged so a renderer never has to.
    return nodes.reduce((merged, node) => {
        const last = merged[merged.length - 1]
        if (node.type === 'text' && last?.type === 'text') last.text += node.text
        else merged.push(node)
        return merged
    }, [])
}

function splitTableRow(line) {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => parseInline(cell.trim()))
}

function indentOf(line) {
    return line.match(/^\s*/)[0].replace(/\t/g, '    ').length
}

const isOrderedMarker = match => /\d/.test(match[2])

function parseList(lines, start) {
    const items = []
    const baseIndent = indentOf(lines[start])
    const ordered = isOrderedMarker(LIST_ITEM.exec(lines[start]))
    let index = start

    while (index < lines.length) {
        const line = lines[index]
        const match = LIST_ITEM.exec(line)
        const indent = indentOf(line)
        if (!line.trim()) {
            // A blank line ends the list unless the next item continues it.
            const next = lines[index + 1]
            const nextMatch = next && LIST_ITEM.exec(next)
            if (nextMatch && indentOf(next) >= baseIndent && isOrderedMarker(nextMatch) === ordered) {
                index += 1
                continue
            }
            break
        }
        if (match && indent === baseIndent) {
            // A different kind of list at the same depth starts a list of its own.
            if (isOrderedMarker(match) !== ordered) break
            items.push({ inline: parseInline(match[3]), children: [] })
            index += 1
        } else if (match && indent > baseIndent && items.length) {
            const nested = parseList(lines, index)
            items[items.length - 1].children.push(nested.block)
            index = nested.next
        } else if (!match && indent > baseIndent && items.length) {
            // A continuation line of the previous item.
            const item = items[items.length - 1]
            item.inline = [...item.inline, { type: 'text', text: ' ' }, ...parseInline(line.trim())]
            index += 1
        } else {
            break
        }
    }

    return { block: { type: 'list', ordered, items }, next: index }
}

export function parseWikiMarkdown(markdown) {
    const lines = String(markdown || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
    const blocks = []
    let index = 0

    while (index < lines.length) {
        const line = lines[index]

        if (!line.trim()) {
            index += 1
            continue
        }

        if (FENCE.test(line)) {
            const fence = FENCE.exec(line)[1]
            const body = []
            index += 1
            while (index < lines.length && !lines[index].trim().startsWith(fence)) body.push(lines[index++])
            index += 1
            blocks.push({ type: 'code', text: body.join('\n') })
            continue
        }

        const heading = HEADING.exec(line)
        if (heading) {
            blocks.push({ type: 'heading', level: Math.min(heading[1].length, 4), inline: parseInline(heading[2]) })
            index += 1
            continue
        }

        if (RULE.test(line)) {
            blocks.push({ type: 'rule' })
            index += 1
            continue
        }

        if (QUOTE.test(line)) {
            const quoted = []
            while (index < lines.length && QUOTE.test(lines[index])) quoted.push(QUOTE.exec(lines[index++])[1])
            blocks.push({ type: 'quote', blocks: parseWikiMarkdown(quoted.join('\n')) })
            continue
        }

        if (LIST_ITEM.test(line)) {
            const { block, next } = parseList(lines, index)
            blocks.push(block)
            index = next
            continue
        }

        if (line.includes('|') && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1])) {
            const header = splitTableRow(line)
            const rows = []
            index += 2
            while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
                rows.push(splitTableRow(lines[index++]))
            }
            blocks.push({ type: 'table', header, rows })
            continue
        }

        const paragraph = []
        while (
            index < lines.length &&
            lines[index].trim() &&
            !HEADING.test(lines[index]) &&
            !FENCE.test(lines[index]) &&
            !QUOTE.test(lines[index]) &&
            !LIST_ITEM.test(lines[index]) &&
            !RULE.test(lines[index])
        ) {
            paragraph.push(lines[index].trim())
            index += 1
        }
        blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join(' ')) })
    }

    return blocks
}
