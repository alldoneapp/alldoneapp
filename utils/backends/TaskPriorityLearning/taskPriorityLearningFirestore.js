import { getDb } from '../firestore'
import store from '../../../redux/store'

export const TASK_PRIORITY_LEARNING_PRIVATE_DOC = 'taskPriorityLearning'
export const TASK_PRIORITY_LEARNING_SCHEMA_VERSION = 1

export const DEFAULT_TASK_PRIORITY_LEARNING = {
    enabled: true,
    learnedRules: '',
    learnedRulesUpdatedAt: null,
    schemaVersion: TASK_PRIORITY_LEARNING_SCHEMA_VERSION,
}

function getLoggedUserId() {
    return store.getState().loggedUser.uid
}

function getTaskPriorityLearningRef(userId = getLoggedUserId()) {
    return getDb().doc(`users/${userId}/private/${TASK_PRIORITY_LEARNING_PRIVATE_DOC}`)
}

export function normalizeTaskPriorityLearning(data = {}) {
    return {
        ...DEFAULT_TASK_PRIORITY_LEARNING,
        ...data,
        enabled: data.enabled !== false,
        learnedRules: typeof data.learnedRules === 'string' ? data.learnedRules : '',
        schemaVersion: data.schemaVersion || TASK_PRIORITY_LEARNING_SCHEMA_VERSION,
    }
}

export async function getTaskPriorityLearning(userId = getLoggedUserId()) {
    const doc = await getTaskPriorityLearningRef(userId).get()
    return normalizeTaskPriorityLearning(doc.exists ? doc.data() : {})
}

export async function saveTaskPriorityLearning({ enabled = true, learnedRules = '' }, userId = getLoggedUserId()) {
    const data = {
        enabled: enabled !== false,
        learnedRules: typeof learnedRules === 'string' ? learnedRules.trim() : '',
        learnedRulesUpdatedAt: Date.now(),
        schemaVersion: TASK_PRIORITY_LEARNING_SCHEMA_VERSION,
    }
    await getTaskPriorityLearningRef(userId).set(data, { merge: true })
    return normalizeTaskPriorityLearning(data)
}

export async function resetTaskPriorityLearning(userId = getLoggedUserId()) {
    const data = {
        enabled: true,
        learnedRules: '',
        learnedRulesUpdatedAt: Date.now(),
        schemaVersion: TASK_PRIORITY_LEARNING_SCHEMA_VERSION,
    }
    await getTaskPriorityLearningRef(userId).set(data, { merge: true })
    return normalizeTaskPriorityLearning(data)
}
