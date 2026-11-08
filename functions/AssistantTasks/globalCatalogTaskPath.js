// The curated global catalog keeps its tasks at assistantTasks/globalProject/preConfigTasks/{taskId}
// (getAssistantTasksCollectionPath in utils/backends/Assistants/assistantsFirestore.js). The
// assistant-task triggers match any assistantTasks/globalProject/{segment}/{taskId}, and whatever they
// accept there is fanned out into every tenant's derived assistants (functions/Assistants/
// templateSync.js), so anything outside the catalog collection is ignored (security audit 2026-11).
const GLOBAL_CATALOG_TASKS_SEGMENT = 'preConfigTasks'

const isGlobalCatalogTaskPath = pathSegment => pathSegment === GLOBAL_CATALOG_TASKS_SEGMENT

module.exports = { GLOBAL_CATALOG_TASKS_SEGMENT, isGlobalCatalogTaskPath }
