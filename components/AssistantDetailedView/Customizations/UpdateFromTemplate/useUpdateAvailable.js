import { useSelector } from 'react-redux'

export function useUpdateAvailable(assistant) {
    const globalAssistants = useSelector(state => state.globalAssistants)

    // Debug logging
    console.log('useUpdateAvailable - assistant:', assistant?.uid, {
        copiedFromTemplateAssistantId: assistant?.copiedFromTemplateAssistantId,
        copiedFromTemplateAssistantDate: assistant?.copiedFromTemplateAssistantDate,
    })

    // Return early if assistant doesn't have a template reference
    if (!assistant?.copiedFromTemplateAssistantId) {
        console.log('useUpdateAvailable - No copiedFromTemplateAssistantId, returning false')
        return { isAvailable: false, globalAssistant: null }
    }

    // Find the source global/template assistant
    const globalAssistant = globalAssistants.find(ga => ga.uid === assistant.copiedFromTemplateAssistantId)

    console.log('useUpdateAvailable - Found global assistant:', globalAssistant?.uid, {
        lastEditionDate: globalAssistant?.lastEditionDate,
    })

    // Global assistant was deleted
    if (!globalAssistant) {
        return { isAvailable: false, globalAssistant: null, wasDeleted: true }
    }

    // Check if the template was updated after the copy was made
    const isAvailable = globalAssistant.lastEditionDate > assistant.copiedFromTemplateAssistantDate
    console.log('useUpdateAvailable - isAvailable:', isAvailable, {
        globalLastEditionDate: globalAssistant.lastEditionDate,
        localCopiedDate: assistant.copiedFromTemplateAssistantDate,
    })

    return { isAvailable, globalAssistant }
}
