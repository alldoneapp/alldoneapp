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

    const localCopiedDate =
        typeof assistant.copiedFromTemplateAssistantDate === 'number' ? assistant.copiedFromTemplateAssistantDate : 0

    // Single source of truth: template lastEditionDate.
    const isAvailable = globalAssistant.lastEditionDate > localCopiedDate
    console.log('useUpdateAvailable - isAvailable:', isAvailable, {
        globalLastEditionDate: globalAssistant.lastEditionDate,
        localCopiedDate,
    })

    return { isAvailable, globalAssistant }
}
