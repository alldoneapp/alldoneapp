import { FEED_PUBLIC_FOR_ALL } from '../../Utils/FeedsConstants'

// `isPublicFor` mixes the numeric FEED_PUBLIC_FOR_ALL sentinel with uid / workstream id
// strings, and the two sources that feed the mention + search lists disagree on its type:
// Redux-sourced objects keep the raw number 0, while Typesense search hits carry the
// string '0' (normalizeDocumentForTypesense stringifies the whole array so it matches the
// declared string[] facet type — the search FILTERS compare stringified too).
// A strict `includes(FEED_PUBLIC_FOR_ALL)` therefore never matched a search hit, and the
// lock icon was drawn on EVERY global-search result. Compare as strings.
export const isPublicForAll = isPublicFor =>
    Array.isArray(isPublicFor) && isPublicFor.some(value => String(value) === String(FEED_PUBLIC_FOR_ALL))

export const isPrivateObject = object => {
    if (!object) return false
    return !!object.isPrivate || (Array.isArray(object.isPublicFor) && !isPublicForAll(object.isPublicFor))
}
