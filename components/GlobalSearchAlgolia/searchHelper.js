import { getDb } from '../../utils/backends/firestore'
import { GLOBAL_PROJECT_ID } from '../AdminPanel/Assistants/assistantsHelper'

export const TASKS_INDEX_NAME_PREFIX = 'dev_tasks'
export const GOALS_INDEX_NAME_PREFIX = 'dev_goals'
export const NOTES_INDEX_NAME_PREFIX = 'dev_notes'
export const CONTACTS_INDEX_NAME_PREFIX = 'dev_contacts'
export const CHATS_INDEX_NAME_PREFIX = 'dev_updates'

export const startGlobalAssistantsIndexationInAlgolia = async () => {
    await getDb().doc(`algoliaIndexation/${GLOBAL_PROJECT_ID}/objectTypes/assistants`).set({
        activeFullSearchDate: null,
    })
}
