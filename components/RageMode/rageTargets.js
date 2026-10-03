/**
 * What rage mode reads from the live page — WITHOUT changing it.
 *
 * This is the load-bearing rule of the whole feature: the arena never mutates the app's DOM. React
 * owns that DOM, and so do Quill and the React roots inside Quill embeds — CLAUDE.md documents the
 * `NotFoundError` crashes that follow when anything else moves their nodes. So a destroyed task row
 * is not removed from the page: it is measured, then covered on the arena canvas with the colour
 * behind it. Leaving rage mode clears the canvas and the page is exactly what it was.
 *
 * Every function here only READS (computed style).
 */

export const RAGE_LAYER_ATTRIBUTE = 'data-rage-mode-layer'

export const isTransparentColor = color => {
    if (!color || color === 'transparent') return true
    const match = /rgba?\(([^)]+)\)/.exec(color)
    if (!match) return false
    const parts = match[1].split(/[\s,/]+/).filter(Boolean)
    return parts.length >= 4 && parseFloat(parts[3]) === 0
}

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

export const glyphStyle = element => {
    const style = window.getComputedStyle(element)
    return {
        font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
        color: style.color,
        transform: style.textTransform,
    }
}

// Every task row in the app carries `nativeID={`task_body_${projectId}_${taskId}_…`}` (TaskPresentation),
// which react-native-web renders as the DOM id. Read-only: the arena never touches the row itself.
export const TASK_ROW_SELECTOR = '[id^="task_body_"]'
