const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')

function generateAssistantObjectModel(currentMilliseconds, assistant, assistantId) {
    return {
        type: 'assistant',
        lastChangeDate: currentMilliseconds,
        assistantId: assistantId,
        name: assistant.displayName,
        isDeleted: false,
        isPublicFor: [FEED_PUBLIC_FOR_ALL],
        photoURL: assistant.photoURL50,
    }
}

module.exports = { generateAssistantObjectModel }
