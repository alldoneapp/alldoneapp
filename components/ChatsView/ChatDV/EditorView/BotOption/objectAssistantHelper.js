import { setTaskAssistant } from '../../../../../utils/backends/Tasks/tasksFirestore'
import { updateChatAssistant } from '../../../../../utils/backends/Chats/chatsFirestore'
import { setNoteAssistant } from '../../../../../utils/backends/Notes/notesFirestore'
import { setContactAssistant } from '../../../../../utils/backends/Contacts/contactsFirestore'
import { setUserAssistant } from '../../../../../utils/backends/Users/usersFirestore'
import { setSkillAssistant } from '../../../../../utils/backends/Skills/skillsFirestore'
import { setGoalAssistant } from '../../../../../utils/backends/Goals/goalsFirestore'

export const normalizeAssistantObjectType = objectType => {
    switch (objectType) {
        case 'task':
            return 'tasks'
        case 'chat':
            return 'chats'
        case 'topic':
            return 'topics'
        case 'note':
            return 'notes'
        case 'contact':
            return 'contacts'
        case 'user':
            return 'users'
        case 'skill':
            return 'skills'
        case 'goal':
            return 'goals'
        default:
            return objectType
    }
}

export const setAssistantForObject = async (projectId, objectId, objectType, assistantId, needGenerateUpdate) => {
    const normalizedObjectType = normalizeAssistantObjectType(objectType)

    switch (normalizedObjectType) {
        case 'tasks':
            await setTaskAssistant(projectId, objectId, assistantId, needGenerateUpdate)
            break
        case 'chats':
        case 'topics':
            await updateChatAssistant(projectId, objectId, assistantId)
            break
        case 'notes':
            await setNoteAssistant(projectId, objectId, assistantId, needGenerateUpdate)
            break
        case 'contacts':
            await setContactAssistant(projectId, objectId, assistantId, needGenerateUpdate)
            break
        case 'users':
            await setUserAssistant(projectId, objectId, assistantId, needGenerateUpdate)
            break
        case 'skills':
            await setSkillAssistant(projectId, objectId, assistantId, needGenerateUpdate)
            break
        case 'goals':
            await setGoalAssistant(projectId, objectId, assistantId, needGenerateUpdate)
            break
        default:
            return false
    }

    return true
}
