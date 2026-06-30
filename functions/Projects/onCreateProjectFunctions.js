const SendInBlueManager = require('../SendInBlueManager')
const { inProductionEnvironment } = require('../Utils/HelperFunctionsCloud')
const {
    safelySyncHeartbeatSchedules,
    syncHeartbeatSchedulesForProject,
} = require('../Assistant/assistantHeartbeatSchedule')

const onCreateProject = async project => {
    if (inProductionEnvironment() && project.isTemplate) await SendInBlueManager.sendEmailForNewTemplate(project)
    if (project?.id) {
        await safelySyncHeartbeatSchedules(
            () => syncHeartbeatSchedulesForProject(project.id, { projectData: project }),
            {
                source: 'project_created',
                projectId: project.id,
            }
        )
    }
}

module.exports = { onCreateProject }
