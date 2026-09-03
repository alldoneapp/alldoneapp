// AT-2393 — an @-mention must show only genuine matches for what was typed.
//
// Two independent reasons the logged-in user turned up in (almost) every mention search,
// both of which are about the CONTACTS tab and neither of which is a bug in the modal:
//
// 1. The contacts collection is searched by `displayName,cleanDescription,role,company`
//    (TYPESENSE_QUERY_CONFIG, inherited verbatim from the Algolia index settings), and
//    `cleanDescription` is the contact's whole free-text description. That is right for
//    global search — "which contact works at BCG?" — and wrong for an @-mention, which is
//    a name picker. It only became visible when the assistant started writing a long
//    auto-generated user description onto the user's own profile: the reporting account's
//    is 2,624 characters / 273 distinct words, which covers 25 of the 26 single letters
//    and most two-letter prefixes. Typesense prefix-matches the last query token, so
//    "@a", "@an", "@ka", "@ma" … all matched the author's own record. Nobody else has a
//    description like that, which is why the symptom reads as "it always shows ME".
//
// 2. A member is indexed once per project they belong to, and the mention search is
//    deliberately cross-project (commit ce768cd2af). The reporting account is a member of
//    140 projects, so the index holds ~140 records for the same human — all carrying that
//    same description.
//
//    Only 14 of those 140 are ACTIVE: `loggedUserProjectsMap` holds what the sidebar
//    holds, and `updateInactiveProjectsData` has already removed guides (64), templates
//    (31) and archived projects (31). The modal filters its hits against exactly that map,
//    so at most 14 of the duplicates were ever displayed. The damage was on the other
//    side of the wire: the contacts and notes mention filters carried NO project scope at
//    all (just `isPublicFor`), so the 100-hit page was drawn from all 140 projects and the
//    ~126 unusable records were fetched and then thrown away client-side. A single
//    much-duplicated person could therefore consume the whole page and genuine matches
//    never reached the client at all. Global search never had this — it scopes to explicit
//    project ids (`buildTypesenseProjectsAccessFilter`); the mention search just never did.
//
// So: fix 1 is a narrower `query_by`; fix 2 is asking the engine for the same projects the
// modal was going to keep anyway (`buildMentionProjectsScope`). The scope cannot change what
// is displayed — it mirrors a filter that already ran — it only stops real results being
// crowded off the page.
//
// Collapsing those remaining per-project rows into one was considered and DECLINED: a
// cross-project mention is selected per project (the row's project decides whether you
// mention the existing member or copy the contact across via `copyContactToProject`), and
// the project header is what tells you which one you are picking. Reopen that only with a
// product decision, not as a tidy-up.
import { formatTypesenseValue } from '../../../GlobalSearchAlgolia/typesenseSearchFilters'

// Identity fields only. Role and company stay searchable on purpose — "@ceo" / "@alldone"
// are short, deliberate, and how people look someone up when the name escapes them. The
// long description does not: it is prose about a person, not a handle for them.
export const MENTION_CONTACTS_QUERY_BY = 'displayName,role,company'

/**
 * `projectId:=[…]` for the projects whose records the modal would keep anyway — i.e. the
 * active projects in `loggedUserProjectsMap`, plus any extra ids the caller allows through
 * (the contacts tab passes GLOBAL_PROJECT_ID so global assistants stay mentionable).
 *
 * Returns '' when there is nothing to scope to, which leaves the filter exactly as it was
 * before. That matters during boot, when the projects map can still be empty: an empty
 * `projectId:=[]` would match nothing and blank the tab, whereas the unscoped filter plus
 * the existing client-side check simply behaves as it always has.
 */
export const buildMentionProjectsScope = (projectIds, extraProjectIds = []) => {
    const ids = [...new Set([...(projectIds || []), ...extraProjectIds])].filter(Boolean)
    if (ids.length === 0) return ''

    return `projectId:=[${ids.map(formatTypesenseValue).join(',')}]`
}

// AT-2497 — the notes tab is ONE page shared by every project the user belongs to, so the
// project being written in can contribute nothing at all.
//
// The engine side was never the problem: a page of `per_page` notes ordered by
// `lastEditionDate:desc` is exactly what the modal asks for and exactly what comes back.
// But it is a page of the user's *globally* most recent notes, and on the reporting account
// the 20 most recently edited notes are 16 notes from one project plus four from four
// others — the project this very ticket lives in has not made that page for two weeks. So
// typing "@" in a note there and opening the Notes tab offers, correctly and uselessly,
// twenty notes from somewhere else.
//
// The fix is a second, current-project-scoped page merged in front of the cross-project one.
// It is not "current project only": mention search is deliberately cross-project (AT-2393),
// and a note you want to link frequently lives elsewhere. It is a reserved block at the top
// so the project you are actually in can never be crowded off the page.
export const MENTION_NOTES_PAGE_SIZE = 20
export const MENTION_NOTES_CURRENT_PROJECT_SLOTS = 8

const getMentionHitKey = hit => {
    if (!hit) return ''
    if (hit.objectID) return String(hit.objectID)
    if (hit.id) return `${hit.projectId || ''}:${hit.id}`
    return ''
}

/**
 * Merge the current project's page in front of the cross-project page.
 *
 * `reserved` slots are guaranteed to the current project when it has that many results;
 * everything after that is filled from the cross-project page (which is the globally most
 * recent set and may itself contain current-project notes — deduplicated here), and only
 * then topped up from whatever is left over. Both inputs arrive already ordered by
 * recency, and this preserves that order inside each block.
 *
 * A short page on either side is never padded with a placeholder: fewer suggestions is a
 * correct answer, an invented one is not.
 */
export const mergeMentionPages = (currentProjectHits, crossProjectHits, options = {}) => {
    const reserved = options.reserved != null ? options.reserved : MENTION_NOTES_CURRENT_PROJECT_SLOTS
    const limit = options.limit != null ? options.limit : MENTION_NOTES_PAGE_SIZE

    const current = Array.isArray(currentProjectHits) ? currentProjectHits : []
    const cross = Array.isArray(crossProjectHits) ? crossProjectHits : []

    const seen = new Set()
    const merged = []
    const push = hit => {
        const key = getMentionHitKey(hit)
        if (!key || seen.has(key) || merged.length >= limit) return
        seen.add(key)
        merged.push(hit)
    }

    current.slice(0, Math.max(0, reserved)).forEach(push)
    cross.forEach(push)
    current.forEach(push)

    return merged
}
