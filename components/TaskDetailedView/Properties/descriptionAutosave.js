// Drafts outlive the editor so a failed save (including local image URLs) can be
// retried after navigating away and back within the same app session.
const drafts = new Map()

const protectPendingDrafts = event => {
    if (![...drafts.values()].some(draft => draft.pending)) return
    drafts.forEach(draft => draft.flush())
    event.preventDefault()
    event.returnValue = ''
}

export const createDescriptionAutosave = ({
    initialText = '',
    upload,
    save,
    debounceMs = 1000,
    onRetain,
    onRelease,
}) => {
    let text = initialText || ''
    let savedText = text
    let status = 'idle'
    let running = null
    let timer = null
    const listeners = new Set()
    const uploadedTokens = new Map()
    const normalize = value =>
        value
            .split(' ')
            .map(word => uploadedTokens.get(word) || word)
            .join(' ')
    const pending = () => !!running || text !== savedText
    const snapshot = () => ({ text, status, pending: pending() })
    const notify = () => listeners.forEach(listener => listener(snapshot()))
    const release = () => {
        if (!listeners.size && !pending()) onRelease?.()
    }
    const clearTimer = () => {
        clearTimeout(timer)
        timer = null
    }
    const flush = () => {
        clearTimer()
        if (running) return running
        if (text === savedText) {
            status = 'idle'
            notify()
            release()
            return Promise.resolve()
        }
        const captured = text
        const previous = savedText
        status = 'saving'
        // Defer execution so running is set even when upload/save throw synchronously.
        running = Promise.resolve()
            .then(async () => {
                const finalText = await upload(captured, uploadedTokens)
                // Canonicalize new edits too; the live Quill editor may still emit
                // the original local tokens. Never upload the same embed twice.
                text = normalize(text)
                if (text === captured) text = finalText
                await save(finalText, previous)
                savedText = finalText
                status = 'saved'
            })
            .catch(() => {
                text = normalize(text)
                status = 'error'
            })
            .then(() => {
                running = null
                notify()
                if (status !== 'error' && text !== savedText) return flush()
                release()
            })
        notify()
        return running
    }
    return {
        get pending() {
            return pending()
        },
        snapshot,
        flush,
        setSave(callback) {
            save = callback
        },
        change(value, immediate = false) {
            const next = normalize(value || '')
            if (next === text) return
            text = next
            clearTimer()
            if (!running) status = text === savedText ? 'idle' : 'pending'
            notify()
            // Quill retains local embed tokens while editing. Decide after
            // normalization so typing beside an uploaded image still debounces.
            if (typeof immediate === 'function' ? immediate(next) : immediate) flush()
            else timer = setTimeout(flush, debounceMs)
        },
        receiveRemote(value) {
            if (pending()) return false
            text = savedText = value || ''
            status = 'idle'
            notify()
            return true
        },
        subscribe(listener) {
            onRetain?.()
            listeners.add(listener)
            listener(snapshot())
            return () => {
                listeners.delete(listener)
                flush()
                release()
            }
        },
    }
}

export const getDescriptionDraft = (key, options) => {
    if (!drafts.has(key)) {
        const retain = () => {
            if (!drafts.size && typeof window !== 'undefined')
                window.addEventListener('beforeunload', protectPendingDrafts)
            drafts.set(key, draft)
        }
        const draft = createDescriptionAutosave({
            ...options,
            onRetain: retain,
            onRelease: () => {
                drafts.delete(key)
                if (!drafts.size && typeof window !== 'undefined') {
                    window.removeEventListener('beforeunload', protectPendingDrafts)
                }
            },
        })
        retain()
    }
    const draft = drafts.get(key)
    draft.setSave(options.save)
    return draft
}
