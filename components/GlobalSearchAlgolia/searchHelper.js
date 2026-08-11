import { getDb } from '../../utils/backends/firestore'
import { GLOBAL_PROJECT_ID } from '../AdminPanel/Assistants/assistantsHelper'

export {
    TASKS_INDEX_NAME_PREFIX,
    GOALS_INDEX_NAME_PREFIX,
    NOTES_INDEX_NAME_PREFIX,
    CONTACTS_INDEX_NAME_PREFIX,
    CHATS_INDEX_NAME_PREFIX,
} from './searchIndexes'

export const startGlobalAssistantsIndexationInAlgolia = async () => {
    await getDb().doc(`algoliaIndexation/${GLOBAL_PROJECT_ID}/objectTypes/assistants`).set({
        activeFullSearchDate: null,
    })
}
