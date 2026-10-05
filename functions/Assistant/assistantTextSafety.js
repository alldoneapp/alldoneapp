// Token counting handles untrusted prose, not tokenizer control instructions. In particular,
// an assistant explaining a token (or an error containing one) must not break a whole thread.
const encodeOrdinaryText = (encoder, text) => encoder.encode(text, [], [])

const isInsideCodeFence = (text, position) => {
    let fence = null
    for (const match of text.slice(0, position).matchAll(/^\s*(`{3,}|~{3,})[^\n]*$/gm)) {
        const delimiter = match[1]
        if (!fence) fence = delimiter
        else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = null
    }
    return fence !== null
}

// These are transcript serialization artifacts, not ordinary mentions of special tokens.
// Discard the contaminated suffix rather than promoting its fake user/tool turns to an answer.
// Keep code examples and plain mentions of tokens intact.
const sanitizeAssistantResponseText = text => {
    if (typeof text !== 'string') return text
    const markers = [
        /<\|fim_suffix\|>\s*\(no final emitted\)/g,
        /^\[Replayed tool definitions, not a model response\]\s*\nThe following tool definitions were present during the historical conversation replay\./gm,
        /(?:^|\n)(?:<\|im_end\|>|\[im_end\])?\s*(?:<\|im_start\|>|\[im_start\])(?:system|developer|assistant|user|tool)(?:<\|im_sep\|>|\[im_sep\])/g,
    ]
    let boundary = text.length
    for (const marker of markers) {
        for (const match of text.matchAll(marker)) {
            if (match.index >= boundary || isInsideCodeFence(text, match.index)) continue
            // If the marker is inline, drop its whole line: transport debris can precede it.
            const markerStart = match.index + (match[0].startsWith('\n') ? 1 : 0)
            const lineStart = text.lastIndexOf('\n', markerStart - 1) + 1
            boundary = Math.min(boundary, lineStart)
        }
    }
    return boundary < text.length ? text.slice(0, boundary).trimEnd() : text
}

module.exports = { encodeOrdinaryText, sanitizeAssistantResponseText }
