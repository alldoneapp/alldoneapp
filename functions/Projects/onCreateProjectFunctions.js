const SendInBlueManager = require('../SendInBlueManager')
const { inProductionEnvironment } = require('../Utils/HelperFunctionsCloud')

const onCreateProject = async project => {
    if (inProductionEnvironment() && project.isTemplate) await SendInBlueManager.sendEmailForNewTemplate(project)
}

module.exports = { onCreateProject }
