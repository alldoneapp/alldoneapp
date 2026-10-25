const { ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY } = require('../Utils/HelperFunctionsCloud')

// Used with set(..., { merge: true }): dotted keys here would be stored as literal
// field names, leaving the nested maps read by LastCommentArea unchanged.
function buildAssistantCommentPointer(projectId, objectType, objectId, assistantId, date = Date.now()) {
    const pointer = { objectType, objectId, creatorId: assistantId, creatorType: 'assistant', date }
    const pointers = {
        [projectId]: pointer,
        [ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY]: { ...pointer, projectId },
    }
    return {
        lastAssistantCommentData: pointers,
        lastAssistantCommentDataByAssistant: { [assistantId]: pointers },
    }
}

module.exports = { buildAssistantCommentPointer }
