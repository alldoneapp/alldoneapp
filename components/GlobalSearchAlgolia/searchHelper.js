export {
    TASKS_INDEX_NAME_PREFIX,
    GOALS_INDEX_NAME_PREFIX,
    NOTES_INDEX_NAME_PREFIX,
    CONTACTS_INDEX_NAME_PREFIX,
    CHATS_INDEX_NAME_PREFIX,
} from './searchIndexes'

// startGlobalAssistantsIndexationInAlgolia was removed in Phase 4 of the Typesense
// migration together with the algoliaIndexation trigger flow it fed. Global assistants
// are reindexed with: node migration/backfillTypesense.js --project-id=globalProject
