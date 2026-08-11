// Algolia index names. Deliberately a dependency-free leaf module: these
// constants used to live only in `searchHelper.js`, which imports the Firestore
// backend (and therefore the whole Firebase env chain), so anything wanting
// just an index name pulled that in too. `searchHelper.js` re-exports these, so
// existing import sites are unchanged.
export const TASKS_INDEX_NAME_PREFIX = 'dev_tasks'
export const GOALS_INDEX_NAME_PREFIX = 'dev_goals'
export const NOTES_INDEX_NAME_PREFIX = 'dev_notes'
export const CONTACTS_INDEX_NAME_PREFIX = 'dev_contacts'
export const CHATS_INDEX_NAME_PREFIX = 'dev_updates'
