/**
 * Which catalog a skill belongs to (AT-2450).
 *
 * A skill catalog is keyed by the project that owns it:
 *   `globalProject`   — the administrator-curated catalog every user can read
 *                       and only the administrator may write.
 *   any real project  — that project's own skills, readable and writable by its
 *                       members, and available to its assistants with no
 *                       per-assistant enablement.
 *
 * The id deliberately repeats `GLOBAL_PROJECT_ID` from
 * `components/AdminPanel/Assistants/assistantsHelper.js` rather than importing
 * it. That module reaches the project-settings component tree, which drags in
 * react-native-gesture-handler and most of the app — far too much weight for one
 * string, and enough to break the mocks of any suite that renders a skills
 * component. The server keeps its own copy in `functions/Assistant/assistantSkills.js`
 * for the same reason Cloud Functions cannot import app code at all.
 */
export const GLOBAL_SKILL_CATALOG_ID = 'globalProject'

export function isGlobalSkillCatalog(projectId) {
    return !projectId || projectId === GLOBAL_SKILL_CATALOG_ID
}
