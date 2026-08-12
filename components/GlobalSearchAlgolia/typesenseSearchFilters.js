// Typesense port of searchFilters.js (TYPESENSE_MIGRATION.md Phase 3). Same contract:
// - two access conjuncts (project membership + isPublicFor privacy scope), CNF
// - '' means "skip this search", never "search everything"
// The access-id derivation (getProjectAccessIds) and the per-index creator attribute map
// are imported from searchFilters.js so the two engines can never disagree on the access
// model while both exist. Only the string syntax differs:
//   Algolia  (projectId:"a" OR projectId:"b") AND (isPublicFor:0 OR ...) AND userId:"me"
//   Typesense projectId:=[`a`,`b`] && isPublicFor:=[`0`, ...] && userId:=`me`
// isPublicFor is a string[] in Typesense (the numeric FEED_PUBLIC_FOR_ALL sentinel is
// stringified at index time by normalizeDocumentForTypesense), so every access id is
// compared as a string here.
import { CREATOR_ATTRIBUTE_BY_INDEX, getProjectAccessIds } from './searchFilters'
import { CONTACTS_INDEX_NAME_PREFIX } from './searchIndexes'

// Backticks let values with special characters (ws@default, push ids) parse; a backtick
// inside a value would break out of the quoting, so it is stripped — no legitimate id
// carries one.
export const formatTypesenseValue = value => '`' + String(value).replace(/`/g, '') + '`'

export const buildTypesenseProjectsAccessFilter = (projects, loggedUser) => {
    if (!projects.length) return ''

    const projectIdsList = projects.map(project => formatTypesenseValue(project.id)).join(',')

    const accessIds = new Set()
    projects.forEach(project => {
        getProjectAccessIds(loggedUser, project.id).forEach(id => accessIds.add(String(id)))
    })
    const accessList = [...accessIds].map(formatTypesenseValue).join(',')

    return `projectId:=[${projectIdsList}] && isPublicFor:=[${accessList}]`
}

export const buildTypesenseCreatedByMeFilter = (indexPrefix, userId) => {
    if (!userId) return ''

    const creatorAttribute = CREATOR_ATTRIBUTE_BY_INDEX[indexPrefix]
    if (!creatorAttribute) return ''

    return `${creatorAttribute}:=${formatTypesenseValue(userId)}`
}

export const buildTypesenseSearchFilters = ({ indexPrefix, projects, loggedUser, createdByMeOnly = false }) => {
    const projectsAccessFilter = buildTypesenseProjectsAccessFilter(projects, loggedUser)
    if (!projectsAccessFilter) return ''

    const conjuncts = [projectsAccessFilter]

    if (indexPrefix === CONTACTS_INDEX_NAME_PREFIX) {
        conjuncts.push('isAssistant:=false')
    }

    if (createdByMeOnly) {
        const createdByMeFilter = buildTypesenseCreatedByMeFilter(indexPrefix, loggedUser?.uid)
        if (createdByMeFilter) conjuncts.push(createdByMeFilter)
    }

    return conjuncts.join(' && ')
}
