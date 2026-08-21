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
