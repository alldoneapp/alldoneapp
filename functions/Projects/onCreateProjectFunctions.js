const SendInBlueManager = require('../SendInBlueManager')
const { inProductionEnvironment } = require('../Utils/HelperFunctionsCloud')
const {
    safelySyncHeartbeatSchedules,
    syncHeartbeatSchedulesForProject,
} = require('../Assistant/assistantHeartbeatSchedule')

const onCreateProject = async project => {
    if (inProductionEnvironment() && project.isTemplate) await SendInBlueManager.sendEmailForNewTemplate(project)
    if (project?.id) {
        // A new project has one member, the only one who can have configured its assistants (NV-17).
        const admin = require('firebase-admin')
        const { confirmHeartbeatsForSoleMember } = require('../Assistant/heartbeatOptIn')
        await confirmHeartbeatsForSoleMember({ db: admin.firestore(), projectId: project.id, project })
        await safelySyncHeartbeatSchedules(
            () => syncHeartbeatSchedulesForProject(project.id, { projectData: project }),
            {
                source: 'project_created',
                projectId: project.id,
            }
        )
        // The project wiki is on by default; never throws.
        const { applyKnowledgeBaseDefaultForNewProject } = require('../KnowledgeBase/knowledgeBaseDefaults')
        await applyKnowledgeBaseDefaultForNewProject({ project })
    }
}

module.exports = { onCreateProject }
