// The wiki index lists the most recently updated page first, and a search above it narrows the list
// down. Both are pure so the order and the matching can be tested without rendering anything.

const updatedAtOf = page => {
    const value = Number(page?.updatedAt)
    return Number.isFinite(value) && value > 0 ? value : null
}

const compareText = (left, right) => String(left || '').localeCompare(String(right || ''))

// Newest `updatedAt` first: the same timestamp the index shows as "Last updated". A page without a
// date goes last, and equal dates fall back to the title and then the slug, so the order never
// depends on how Firestore happened to return the documents.
export function compareWikiPagesByUpdatedAt(left, right) {
    const leftUpdated = updatedAtOf(left)
    const rightUpdated = updatedAtOf(right)
    if (leftUpdated !== rightUpdated) {
        if (leftUpdated === null) return 1
        if (rightUpdated === null) return -1
        return rightUpdated - leftUpdated
    }
    return compareText(left?.title, right?.title) || compareText(left?.slug, right?.slug)
}

export function sortWikiPagesByUpdatedAt(pages) {
    return [...(pages || [])].sort(compareWikiPagesByUpdatedAt)
}

// Lower case without accents, so "überblick" finds "Überblick" and "uberblick" alike.
export function normalizeWikiSearchText(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
}

export function getWikiSearchTerms(query) {
    return normalizeWikiSearchText(query).split(/\s+/).filter(Boolean)
}

// Only what the index row shows is searched (title and summary), so a match is always visible.
// Every word of the query has to occur, in any order.
export function wikiPageMatchesSearch(page, query) {
    const terms = getWikiSearchTerms(query)
    if (terms.length === 0) return true
    const haystack = normalizeWikiSearchText(`${page?.title || ''}\n${page?.summary || ''}`)
    return terms.every(term => haystack.includes(term))
}

export function getWikiIndexPages(pages, query) {
    return sortWikiPagesByUpdatedAt(pages).filter(page => wikiPageMatchesSearch(page, query))
}
