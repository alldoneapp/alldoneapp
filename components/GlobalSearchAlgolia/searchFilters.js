// Only leaf modules may be imported here: this module is pure string building
// and must stay loadable without the Firebase env chain (see searchIndexes.js).
import { FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import { DEFAULT_WORKSTREAM_ID } from '../Workstreams/WorkstreamConstants'
import {
    CHATS_INDEX_NAME_PREFIX,
    CONTACTS_INDEX_NAME_PREFIX,
    GOALS_INDEX_NAME_PREFIX,
    NOTES_INDEX_NAME_PREFIX,
    TASKS_INDEX_NAME_PREFIX,
} from './searchIndexes'

// Which Algolia attribute carries "the user who created this object", per index.
// These differ per object type because the underlying Firestore docs differ:
//   tasks/notes  -> userId       (the creator of the task / note)
//   goals        -> creatorId    (deliberately NOT `ownerId`: that is the goal's
//                   assignee-scope and defaults to the `ALL_USERS` sentinel, which
//                   is what virtually every real goal carries, so it can never
//                   match a uid. `creatorId` is written by `GoalsHelper.createGoal`)
//   contacts     -> recorderUserId (the member who added the contact to the project;
//                   deliberately NOT `uid`, which is the contact's own identity —
//                   my own contact card is not something "I created")
//   chats/topics -> creatorId    (added to the index for AT-2258)
// Every one of these is declared as `filterOnly(...)` in `configAlgoliaIndex`
// (functions/searchHelper.js), which is what makes them usable in `filters:`.
export const CREATOR_ATTRIBUTE_BY_INDEX = {
    [TASKS_INDEX_NAME_PREFIX]: 'userId',
    [GOALS_INDEX_NAME_PREFIX]: 'creatorId',
    [NOTES_INDEX_NAME_PREFIX]: 'userId',
    [CONTACTS_INDEX_NAME_PREFIX]: 'recorderUserId',
    [CHATS_INDEX_NAME_PREFIX]: 'creatorId',
}

export const getProjectAccessIds = (loggedUser, projectId) => {
    if (loggedUser.isAnonymous) return [FEED_PUBLIC_FOR_ALL]

    const workstreamIds = loggedUser.workstreams?.[projectId]
    const projectWorkstreamIds = Array.isArray(workstreamIds) ? workstreamIds : []
    return [...new Set([FEED_PUBLIC_FOR_ALL, loggedUser.uid, DEFAULT_WORKSTREAM_ID, ...projectWorkstreamIds])]
}

// Algolia's filter parser rejects unquoted facet values that contain special
// characters (e.g. workstream ids like `ws@default`). Quote string values so
// they parse correctly; leave numeric values (e.g. FEED_PUBLIC_FOR_ALL) as-is
// so they still match the numeric facet.
export const formatFacetValue = value => (typeof value === 'number' ? value : `"${value}"`)

// Algolia only supports flat CNF filters: `(OR…) AND (OR…)`. It rejects ORing
// AND-groups together (`(X AND Y) OR Z`) and nested AND-groups. We therefore
// can't scope access per project inside the filter. Instead we union every
// searched project's access ids into a single OR-group. This is equivalent to
// per-project scoping because workstream ids are globally unique, so an item in
// one project can't accidentally match another project's workstream id.
export const buildProjectsAccessFilter = (projects, loggedUser) => {
    if (!projects.length) return ''

    const projectIdsFilter = projects.map(project => `projectId:${formatFacetValue(project.id)}`).join(' OR ')

    const accessIds = new Set()
    projects.forEach(project => {
        getProjectAccessIds(loggedUser, project.id).forEach(id => accessIds.add(id))
    })
    const accessFilter = [...accessIds].map(id => `isPublicFor:${formatFacetValue(id)}`).join(' OR ')

    return `(${projectIdsFilter}) AND (${accessFilter})`
}

// "Only objects I created" (AT-2258). Returns a single flat conjunct, e.g.
// `userId:"abc"`, or '' when the filter is off / not expressible — an empty
// string means "add nothing", never "match nothing", so an unknown index
// degrades to the previous unfiltered behaviour instead of hiding every result.
export const buildCreatedByMeFilter = (indexPrefix, userId) => {
    if (!userId) return ''

    const creatorAttribute = CREATOR_ATTRIBUTE_BY_INDEX[indexPrefix]
    if (!creatorAttribute) return ''

    return `${creatorAttribute}:${formatFacetValue(userId)}`
}

// Builds the complete `filters:` string for one index. Kept flat
// (`(OR…) AND (OR…) AND x AND y`) — do NOT wrap `projectsAccessFilter` in extra
// parens, it already contains an AND and Algolia rejects nested AND-groups.
// Returns '' when there is nothing to search against (no accessible projects),
// which the caller must treat as "skip this search" rather than "search
// everything", since an empty filter would leak unscoped results.
export const buildSearchFilters = ({ indexPrefix, projects, loggedUser, createdByMeOnly = false }) => {
    const projectsAccessFilter = buildProjectsAccessFilter(projects, loggedUser)
    if (!projectsAccessFilter) return ''

    const conjuncts = [projectsAccessFilter]

    if (indexPrefix === CONTACTS_INDEX_NAME_PREFIX) {
        conjuncts.push('isAssistant:false')
    }

    if (createdByMeOnly) {
        const createdByMeFilter = buildCreatedByMeFilter(indexPrefix, loggedUser?.uid)
        if (createdByMeFilter) conjuncts.push(createdByMeFilter)
    }

    return conjuncts.join(' AND ')
}
