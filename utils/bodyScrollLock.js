// Reference-counted lock for the document scroller. The web shell keeps
// `body { overflow-y: auto }` as a safety valve (AT-2177), so while a
// full-screen popup is open the document must be locked explicitly — inner
// CustomScrollViews are unaffected and keep scrolling.
let lockCount = 0
let previousOverflow = ''

export const lockBodyScroll = () => {
    if (typeof document === 'undefined' || !document.body) return
    if (lockCount === 0) {
        previousOverflow = document.body.style.overflowY
        document.body.style.overflowY = 'hidden'
    }
    lockCount++
}

export const unlockBodyScroll = () => {
    if (typeof document === 'undefined' || !document.body) return
    if (lockCount === 0) return
    lockCount--
    if (lockCount === 0) {
        document.body.style.overflowY = previousOverflow
    }
}

export const isBodyScrollLocked = () => lockCount > 0
