export const scrollDocumentToTop = () => {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        window.scrollTo(0, 0)
    }

    if (typeof document === 'undefined') return

    const scrollContainers = new Set([document.scrollingElement, document.documentElement, document.body])
    scrollContainers.forEach(container => {
        if (container) {
            container.scrollTop = 0
            container.scrollLeft = 0
        }
    })
}

export const scrollRefToTop = scrollRef => {
    const scrollTarget = scrollRef?.current
    if (!scrollTarget) return

    if (typeof Element !== 'undefined' && scrollTarget instanceof Element) {
        scrollTarget.scrollTop = 0
        scrollTarget.scrollLeft = 0
    } else if (typeof scrollTarget.scrollTo === 'function') {
        scrollTarget.scrollTo({ x: 0, y: 0, animated: false })
    }
}

export const resetDetailedViewScroll = scrollRef => {
    scrollDocumentToTop()
    scrollRefToTop(scrollRef)
}
