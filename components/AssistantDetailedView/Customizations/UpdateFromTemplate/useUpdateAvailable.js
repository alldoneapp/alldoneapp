import { useSelector } from 'react-redux'

export function useUpdateAvailable(assistant) {
    const globalAssistants = useSelector(state => state.globalAssistants)

    // Return early if assistant doesn't have a template reference
    if (!assistant?.copiedFromTemplateAssistantId) {
        return { isAvailable: false, globalAssistant: null }
    }

    // Find the source global/template assistant
    const globalAssistant = globalAssistants.find(ga => ga.uid === assistant.copiedFromTemplateAssistantId)

    // Global assistant was deleted
    if (!globalAssistant) {
        return { isAvailable: false, globalAssistant: null, wasDeleted: true }
    }

    // Check if the template was updated after the copy was made
    const isAvailable = globalAssistant.lastEditionDate > assistant.copiedFromTemplateAssistantDate

    return { isAvailable, globalAssistant }
}
