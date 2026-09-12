// Keep references to real text nodes; never accept model-generated CSS selectors or coordinates.
export function clippedRects(node, root, start = 0, end = node.textContent.length) {
    if (!root || !node.isConnected || !root.contains(node) || !node.parentElement) return []
    const parent = node.parentElement
    const parentBounds = parent.getBoundingClientRect()
    const rootBounds = root.getBoundingClientRect()
    if (
        parentBounds.right <= rootBounds.left ||
        parentBounds.left >= rootBounds.right ||
        parentBounds.bottom <= rootBounds.top ||
        parentBounds.top >= rootBounds.bottom
    )
        return []
    if (
        parent.closest(
            '[hidden], [aria-hidden="true"], script, style, textarea, input, select, [data-anna-highlight-ui]'
        )
    )
        return []
    let clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    for (let element = parent; element; element = element.parentElement) {
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return []
        const bounds = element.getBoundingClientRect()
        if (element === root || /(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflowY)) {
            clip = {
                left: Math.max(clip.left, bounds.left),
                top: Math.max(clip.top, bounds.top),
                right: Math.min(clip.right, bounds.right),
                bottom: Math.min(clip.bottom, bounds.bottom),
            }
        }
    }
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    return [...range.getClientRects()]
        .map(rect => ({
            left: Math.max(rect.left, clip.left),
            top: Math.max(rect.top, clip.top),
            right: Math.min(rect.right, clip.right),
            bottom: Math.min(rect.bottom, clip.bottom),
        }))
        .filter(rect => {
            if (rect.right <= rect.left || rect.bottom <= rect.top) return false
            const hit = document.elementFromPoint?.((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2)
            return !hit || parent.contains(hit) || hit.contains(parent)
        })
        .map(rect => ({
            left: rect.left,
            top: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
        }))
}

export function createHighlightTargetRegistry() {
    const identities = new WeakMap()
    let count = 0
    return root => {
        const targets = []
        const references = new Map()
        const handled = new Set()
        if (!root) return { targets, references }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        let visited = 0
        while ((node = walker.nextNode()) && targets.length < 60 && visited++ < 6000) {
            const group = node.parentElement?.closest('[data-anna-highlight-group]')
            const identity = group || node
            if (handled.has(identity)) continue
            handled.add(identity)
            const candidates = []
            if (group) {
                const words = document.createTreeWalker(group, NodeFilter.SHOW_TEXT)
                let word
                while ((word = words.nextNode()) && candidates.length < 500) candidates.push(word)
            } else candidates.push(node)
            const pieces = []
            let combined = ''
            for (const candidate of candidates) {
                const raw = candidate.textContent
                const remaining = 240 - combined.length - (combined ? 1 : 0)
                if (remaining <= 0) break
                const text = raw.trim().slice(0, remaining)
                if (!text || !/[\p{L}\p{N}]/u.test(text)) continue
                const start = raw.indexOf(text)
                if (!clippedRects(candidate, root, start, start + text.length).length) continue
                if (combined) combined += ' '
                pieces.push({ node: candidate, raw, text, start, offset: combined.length })
                combined += text
                if (combined.length >= 239) break
            }
            if (!pieces.length) continue
            if (!identities.has(identity)) identities.set(identity, `target-${++count}`)
            const id = identities.get(identity)
            targets.push({ id, text: combined })
            references.set(id, { pieces, text: combined })
        }
        return { targets, references }
    }
}

export function resolveHighlightRects(command, snapshot, references, root, now = Date.now()) {
    if (
        !command ||
        !Number.isFinite(command.expiresAt) ||
        command.expiresAt <= now ||
        command.screenId !== snapshot?.id ||
        command.path !== window.location.pathname
    )
        return []
    const target = references.get(command.targetId)
    if (!target || target.pieces.some(piece => !piece.node.isConnected || piece.node.textContent !== piece.raw))
        return []
    const quote = command.quote || target.text
    const offset = target.text.indexOf(quote)
    if (offset < 0 || (command.quote && target.text.indexOf(quote, offset + 1) !== -1)) return []
    return target.pieces.flatMap(piece => {
        const start = Math.max(offset, piece.offset)
        const end = Math.min(offset + quote.length, piece.offset + piece.text.length)
        return end <= start
            ? []
            : clippedRects(piece.node, root, piece.start + start - piece.offset, piece.start + end - piece.offset)
    })
}
