// Templates synced from alldone.team's catalog (functions/Assistants/alldoneTeamSpecialists.js).
export const isAlldoneTeamSpecialist = assistant => assistant?.externalSource?.provider === 'alldone.team'

/**
 * The alldone.team specialists this project can still add (offered by alldone.team and not already
 * copied into the project), and the other templates. Templates the project references directly
 * (`globalAssistantIds`) are in neither.
 */
export function splitGlobalTemplates(globalAssistants, project, projectAssistantsInProject = []) {
    const addedTemplateIds = new Set(
        projectAssistantsInProject.map(assistant => assistant.copiedFromTemplateAssistantId).filter(Boolean)
    )
    const referencedIds = project.globalAssistantIds || []
    const notReferenced = globalAssistants.filter(assistant => !referencedIds.includes(assistant.uid))
    return {
        specialists: notReferenced.filter(
            assistant =>
                isAlldoneTeamSpecialist(assistant) &&
                assistant.externalSource.available !== false &&
                !addedTemplateIds.has(assistant.uid)
        ),
        templates: notReferenced.filter(assistant => !isAlldoneTeamSpecialist(assistant)),
    }
}
