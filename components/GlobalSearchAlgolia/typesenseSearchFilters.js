// Search filter builder (Typesense; sole engine since Phase 5). The contract:
// - two access conjuncts (project membership + isPublicFor privacy scope), CNF
//   e.g. projectId:=[`a`,`b`] && isPublicFor:=[`0`, ...] && userId:=`me`
// - '' means "skip this search", never "search everything"
// isPublicFor is a string[] in the index (the numeric FEED_PUBLIC_FOR_ALL sentinel is
// stringified at index time by normalizeDocumentForTypesense), so every access id is
// compared as a string here.
import { FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import { DEFAULT_WORKSTREAM_ID } from '../Workstreams/WorkstreamConstants'
import {
    CHATS_INDEX_NAME_PREFIX,
    CONTACTS_INDEX_NAME_PREFIX,
    GOALS_INDEX_NAME_PREFIX,
    NOTES_INDEX_NAME_PREFIX,
    TASKS_INDEX_NAME_PREFIX,
} from './searchIndexes'

// Which record attribute carries "the user who created this object", per collection.
// These differ per object type because the underlying Firestore docs differ:
//   tasks/notes  -> userId       (the creator of the task / note)
//   goals        -> creatorId    (deliberately NOT `ownerId`: that is the assignee-scope
//                   and is the ALL_USERS sentinel on virtually every real goal)
//   contacts     -> recorderUserId (the member who added the contact; NOT `uid`, which is
//                   the contact's own identity)
//   chats/topics -> creatorId
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
