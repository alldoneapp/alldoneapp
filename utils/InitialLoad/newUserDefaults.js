import { getNewDefaultAssistant } from '../../components/AdminPanel/Assistants/assistantsHelper'
import { getAssistantTemplateState } from '../../functions/Assistants/templateMerge'
import { getDefaultProfilePhotoURL } from '../defaultProfilePhotos'

export const generateInitialAssistant = (template, userId, assistantId) => {
    const now = Date.now()
    const defaults = getNewDefaultAssistant(userId)
    const photoURL =
        template?.photoURL || template?.photoURL300 || template?.photoURL50 || getDefaultProfilePhotoURL(true)

    return {
        ...defaults,
        ...template,
        uid: assistantId,
        displayName: template?.displayName || 'Anna',
        description: template?.description || 'Your AI chief of staff for tasks, ideas, and everyday planning.',
        instructions:
            template?.instructions ||
            'You are Anna, the user’s AI chief of staff in Alldone. Help them capture and organize tasks, clarify priorities, and turn ideas into practical next steps. Be warm, concise, and specific. Use the available tools when needed, and ask for clarification when the user’s intent is unclear.',
        photoURL,
        photoURL50: template?.photoURL50 || photoURL,
        photoURL300: template?.photoURL300 || photoURL,
        model: template?.model || defaults.model,
        noteIdsByProject: {},
        lastVisitBoard: {},
        commentsData: null,
        creatorId: userId,
        lastEditorId: userId,
        createdDate: now,
        lastEditionDate: now,
        isDefault: true,
        // A built-in fallback has no remote template to synchronize with.
        ...(template?.uid
            ? {
                  copiedFromTemplateAssistantId: template.uid,
                  copiedFromTemplateAssistantDate: now,
                  templateSyncSnapshot: getAssistantTemplateState(template),
                  templateSyncConflicts: [],
                  templateSyncStatus: 'synced',
                  templateSyncedAt: now,
              }
            : {}),
    }
}

export const getWelcomeMessage = assistant =>
    `Welcome to Alldone! My name is ${assistant.displayName}. Think of me as your AI chief of staff. I can help you capture tasks and ideas, plan your day, and decide what to do next. What can I do for you today?`
