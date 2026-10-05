import Delta from 'quill-delta'

const linkedEmbed = insert =>
    insert && typeof insert === 'object' && !!(insert.url || insert.mention || insert.taskTagFormat)

/** Inspect only changed/deleted spans. Plain typing and inline styles cannot change embed links. */
export const noteDeltaWork = (change, previous) => {
    let index = 0
    let links = false
    let text = false
    let removedTasks = false
    for (const op of change.ops) {
        if (op.insert !== undefined) {
            links ||= linkedEmbed(op.insert)
            text ||= typeof op.insert === 'string'
        }
        if (op.attributes?.link !== undefined) links = true
        if (op.delete) {
            // Without an old Delta we must conservatively invalidate, never lose backlinks.
            if (!previous) {
                links = text = removedTasks = true
            } else
                for (const old of new Delta(previous.ops).slice(index, index + op.delete).ops) {
                    links ||= linkedEmbed(old.insert)
                    text ||= typeof old.insert === 'string'
                    removedTasks ||= !!old.insert?.taskTagFormat
                }
        }
        index += op.retain || op.delete || 0
    }
    return { links, text, removedTasks }
}
