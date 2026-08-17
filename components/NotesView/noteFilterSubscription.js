import { isEqual } from 'lodash'

/**
 * Redux notifies a raw store subscription for every action. All Projects mounts one
 * NotesByProject per project, so returning a new filter array for an unrelated action
 * multiplies one dispatch into a re-render of every project section.
 */
export const getNoteFilterStateUpdate = (currentState, storeState) => {
    const hashtagFilters = Array.from(storeState.hashtagFilters.keys())
    const noteOwnerFilters = storeState.noteOwnerFilters

    return isEqual(currentState.hashtagFilters, hashtagFilters) &&
        isEqual(currentState.noteOwnerFilters, noteOwnerFilters)
        ? null
        : { hashtagFilters, noteOwnerFilters }
}
