const path = require('node:path')
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/redux\/store$/, path.join(__dirname, 'store.js')),
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|\/)(?:BackendBridge|ProjectHelper|TasksHelper|GoalsHelper|SocialText|MilestoneCapacityButton|MilestoneCapacityView|MilestoneMoreButton|MilestoneDoneDateTag|ProjectDontExistInInvitationModal|DueDateCalendarModal|DueDateCalendarModalFooter|GoalBasedModal|AutoPostpone|TranslationService|HelperFunctions|myDayOpenTasksHelper|taskPostponeMotion|goalPostponeMotion|projectPostpone|goalsFirestore|tasksFirestore|modalsManager)$/,
            path.join(__dirname, 'dependencies.js')
        ),
    ],
})
