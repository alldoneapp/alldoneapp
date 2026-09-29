/**
 * What a rage-mode shot hit, answered from the live page WITHOUT changing it.
 *
 * This is the load-bearing rule of the whole feature: the arena never mutates the app's DOM. React
 * owns that DOM, and so do Quill and the React roots inside Quill embeds — CLAUDE.md documents the
 * `NotFoundError` crashes that follow when anything else moves their nodes. So a "destroyed" letter
 * is not removed from the page: it is measured here (`Range.getClientRects`), then covered on the
 * arena canvas with the colour behind it, while a copy of the glyph flies off as a 3D piece.
 * Leaving rage mode clears the canvas and the page is exactly what it was.
 *
 * Every function here only READS (computed style, client rects, hit testing).
 */

export const RAGE_LAYER_ATTRIBUTE = 'data-rage-mode-layer'

const MAX_BOX_AREA = 90000
const MIN_BOX_AREA = 120
const MAX_IMAGE_AREA_FRACTION = 0.6
const GLYPH_SCAN_RADIUS = 60
const HIT_TOLERANCE = 2

export const isTransparentColor = color => {
    if (!color || color === 'transparent') return true
    const match = /rgba?\(([^)]+)\)/.exec(color)
    if (!match) return false
    const parts = match[1].split(/[\s,/]+/).filter(Boolean)
    return parts.length >= 4 && parseFloat(parts[3]) === 0
}

const isRageLayer = element =>
    !!element && element.nodeType === 1 && !!element.closest && !!element.closest(`[${RAGE_LAYER_ATTRIBUTE}]`)

/**
 * The colour a hole must be painted to look like "nothing is there any more": the first opaque
 * background on the way up, else the document's, else white.
 */
export const resolveBackgroundColor = (element, getStyle = window.getComputedStyle.bind(window)) => {
    let node = element && element.nodeType === 1 ? element : element && element.parentElement
    while (node && node.nodeType === 1) {
        const color = getStyle(node).backgroundColor
        if (!isTransparentColor(color)) return color
        node = node.parentElement
    }
    return '#ffffff'
}

/**
 * Hit testing has to look THROUGH the arena's own input layer, which covers the whole viewport so
 * that no click can ever reach the app underneath. Hit testing honours `pointer-events`, so the
 * layer is switched off for the duration of one synchronous query and back on before any event can
 * be dispatched to the page.
 */
export const withLayerTransparent = (layer, query) => {
    if (!layer) return query()
    const previous = layer.style.pointerEvents
    layer.style.pointerEvents = 'none'
    try {
        return query()
    } finally {
        layer.style.pointerEvents = previous
    }
}

const caretAt = (x, y) => {
    if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(x, y)
        return range ? { node: range.startContainer, offset: range.startOffset } : null
    }
    if (document.caretPositionFromPoint) {
        const position = document.caretPositionFromPoint(x, y)
        return position ? { node: position.offsetNode, offset: position.offset } : null
    }
    return null
}

const charRect = (node, index) => {
    const range = document.createRange()
    range.setStart(node, index)
    range.setEnd(node, index + 1)
    const rects = range.getClientRects()
    // A character split across a line break reports two rects; the first is the one that is drawn.
    const rect = rects && rects.length ? rects[0] : range.getBoundingClientRect()
    return rect && rect.width > 0 && rect.height > 0 ? rect : null
}

const contains = (rect, x, y, tolerance = HIT_TOLERANCE) =>
    x >= rect.left - tolerance &&
    x <= rect.right + tolerance &&
    y >= rect.top - tolerance &&
    y <= rect.bottom + tolerance

export const glyphStyle = element => {
    const style = window.getComputedStyle(element)
    return {
        font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
        color: style.color,
        transform: style.textTransform,
    }
}

const displayedChar = (char, transform) => {
    if (transform === 'uppercase') return char.toUpperCase()
    if (transform === 'lowercase') return char.toLowerCase()
    return char
}

/**
 * The visible characters within `radius` of the impact, if the impact is ON text. Returns null when
 * the point is merely near text: `caretRangeFromPoint` always answers with the nearest caret, even
 * from the empty space beside a paragraph, and a bolt flying through a margin must not knock letters
 * out of the line next to it.
 */
export const findGlyphHit = (x, y, radius, destroyed) => {
    const caret = caretAt(x, y)
    if (!caret || !caret.node || caret.node.nodeType !== 3) return null
    const node = caret.node
    const text = node.textContent || ''
    const parent = node.parentElement
    if (!parent || isRageLayer(parent)) return null

    // A letter that is already gone is a hole: a bolt flies straight through it.
    const gone = destroyed.get(node) || new Set()
    const start = Math.max(0, caret.offset - 1)
    let onText = false
    for (let i = start; i <= Math.min(text.length - 1, caret.offset); i++) {
        const rect = !gone.has(i) && /\S/.test(text[i]) ? charRect(node, i) : null
        if (rect && contains(rect, x, y)) {
            onText = true
            break
        }
    }
    if (!onText) return null

    const style = glyphStyle(parent)
    const background = resolveBackgroundColor(parent)
    const glyphs = []
    const from = Math.max(0, caret.offset - GLYPH_SCAN_RADIUS)
    const to = Math.min(text.length - 1, caret.offset + GLYPH_SCAN_RADIUS)
    for (let i = from; i <= to; i++) {
        if (gone.has(i) || !/\S/.test(text[i])) continue
        const rect = charRect(node, i)
        if (!rect) continue
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        if (Math.hypot(cx - x, cy - y) > radius) continue
        glyphs.push({
            char: displayedChar(text[i], style.transform),
            index: i,
            rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        })
    }
    if (!glyphs.length) return null
    return { kind: 'text', node, glyphs, style, background }
}

const imageSource = (element, style) => {
    if (element.tagName === 'IMG') return element.currentSrc || element.src || null
    const match = /url\(["']?([^"')]+)["']?\)/.exec(style.backgroundImage || '')
    return match ? match[1] : null
}

/**
 * An image, icon or small solid block under the point, looking at most a few ancestors up (a click
 * on an avatar usually lands on a wrapper, not on the `<img>` itself). Large containers are never a
 * target: shooting the page background must fly through it, like in any side-scroller.
 */
export const findBlockHit = (element, destroyed, viewport) => {
    let node = element
    for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++, node = node.parentElement) {
        if (isRageLayer(node) || node === document.body || node === document.documentElement) return null
        if (destroyed.has(node)) return null
        const rect = node.getBoundingClientRect()
        const area = rect.width * rect.height
        if (!area) continue
        const style = window.getComputedStyle(node)
        if (style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue

        const src = imageSource(node, style)
        if (src && area <= viewport.width * viewport.height * MAX_IMAGE_AREA_FRACTION) {
            return {
                kind: 'image',
                element: node,
                src,
                rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                background: resolveBackgroundColor(node.parentElement),
                radius: parseFloat(style.borderTopLeftRadius) || 0,
            }
        }

        if (area < MIN_BOX_AREA || area > MAX_BOX_AREA) continue
        if (!isTransparentColor(style.backgroundColor)) {
            return {
                kind: 'box',
                element: node,
                color: style.backgroundColor,
                rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                background: resolveBackgroundColor(node.parentElement),
                radius: parseFloat(style.borderTopLeftRadius) || 0,
            }
        }
    }
    return null
}

/**
 * Everything a projectile at (x, y) hit, text first (letters are the most satisfying thing on a
 * productivity app's screen, and they are most of it), then images and blocks.
 */
export const resolveHit = ({ x, y, radius, layer, destroyedGlyphs, destroyedBlocks, viewport }) =>
    withLayerTransparent(layer, () => {
        const text = findGlyphHit(x, y, radius, destroyedGlyphs)
        if (text) return text
        const stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : []
        const element = stack.find(candidate => !isRageLayer(candidate))
        return element ? findBlockHit(element, destroyedBlocks, viewport) : null
    })

/* ------------------------------------------------------------------------------------------------ */
/* Scrolling                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

const isScrollable = element => {
    if (!element || element.nodeType !== 1) return false
    const overflowY = window.getComputedStyle(element).overflowY
    return /(auto|scroll|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight + 1
}

/**
 * The element that scrolls `element` vertically: the nearest scrollable ancestor, else the
 * document's own scroller when the page itself scrolls, else null (nothing to scroll).
 */
export const findScrollContainer = element => {
    let node = element && element.nodeType === 1 ? element : element && element.parentElement
    while (node && node !== document.body && node !== document.documentElement) {
        if (isScrollable(node)) return node
        node = node.parentElement
    }
    const page = document.scrollingElement
    return page && page.scrollHeight > page.clientHeight + 1 ? page : null
}

/** The scroll container under a screen point, looking through the arena's own layers. */
export const scrollContainerAt = (x, y, layer) =>
    withLayerTransparent(layer, () => {
        const stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : []
        const element = stack.find(candidate => !isRageLayer(candidate))
        return element ? findScrollContainer(element) : null
    })

/* ------------------------------------------------------------------------------------------------ */
/* Task rows (the snakes)                                                                           */
/* ------------------------------------------------------------------------------------------------ */

// Every task row in the app carries `nativeID={`task_body_${projectId}_${taskId}_…`}` (TaskPresentation),
// which react-native-web renders as the DOM id. Read-only: the arena never touches the row itself.
export const TASK_ROW_SELECTOR = '[id^="task_body_"]'

/** Task rows fully inside the play area (below the HUD, above the bottom edge), not yet taken. */
export const findTaskRows = (viewport, taken, top = 64) =>
    Array.from(document.querySelectorAll(TASK_ROW_SELECTOR)).filter(row => {
        if (taken.has(row)) return false
        const rect = row.getBoundingClientRect()
        return (
            rect.width > 40 &&
            rect.height > 12 &&
            rect.top >= top &&
            rect.bottom <= viewport.height - 8 &&
            rect.left >= 0 &&
            rect.right <= viewport.width
        )
    })

/**
 * The visible letters of a row's text, in reading order, with the style they are drawn in — up to
 * `max` of them. Letters clipped out of the row (an ellipsised title) are skipped.
 */
export const rowGlyphs = (row, max) => {
    const rowRect = row.getBoundingClientRect()
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    const glyphs = []
    let node = walker.nextNode()
    while (node && glyphs.length < max) {
        const text = node.textContent || ''
        const parent = node.parentElement
        if (parent && text.trim()) {
            const style = glyphStyle(parent)
            for (let i = 0; i < text.length && glyphs.length < max; i++) {
                if (!/\S/.test(text[i])) continue
                const rect = charRect(node, i)
                if (!rect || rect.right > rowRect.right + 1 || rect.bottom > rowRect.bottom + 1) continue
                glyphs.push({
                    char: displayedChar(text[i], style.transform),
                    node,
                    index: i,
                    style,
                    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                })
            }
        }
        node = walker.nextNode()
    }
    return glyphs
}
