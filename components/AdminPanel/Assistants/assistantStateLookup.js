/**
 * Pure, dependency-free assistant lookups over the redux state shape.
 *
 * This lives in its own module rather than inside `assistantsHelper.js` so that lightweight
 * presentation helpers can resolve an assistant without inheriting that module's transitive
 * imports: `assistantsHelper` reaches `utils/backends/firestore.js`, which requires build-time
 * dotenv variables and therefore cannot be imported from store-only helpers or their unit
 * tests. `assistantsHelper` re-exports `getAssistantFromState` so there is still exactly one
 * implementation.
 */

/**
 * Find an assistant by id anywhere the client can see it: the shared global pool first, then
 * every project the logged user has loaded.
 *
 * Assistants are stored per project (`assistants/{projectId}/items`) plus one shared
 * `assistants/globalProject/items` pool, and `state.projectAssistants` is populated for ALL of
 * the user's active projects at login (see `loadProjectsDataFromFirebase` in
 * `utils/InitialLoad/loggedUserHelper.js`) — not just the selected one. So an assistant that
 * belongs to another of the user's projects IS resolvable client-side, and must be resolved:
 * objects legitimately keep an assistant from the user's default project while living in a
 * different project (see `getAssignedAssistantInProjectContext` in `assistantsHelper.js`).
 *
 * Returns null when the id belongs to no visible assistant (a human, a contact, a workstream,
 * or an assistant in a project this user is not a member of).
 */
export const getAssistantFromState = (state, assistantId) => {
    if (!assistantId) return null

    const globalAssistant = (state?.globalAssistants || []).find(assistant => assistant.uid === assistantId)
    if (globalAssistant) return globalAssistant

    const projectAssistants = state?.projectAssistants || {}
    for (const assistants of Object.values(projectAssistants)) {
        const assistant = (assistants || []).find(item => item.uid === assistantId)
        if (assistant) return assistant
    }

    return null
}
