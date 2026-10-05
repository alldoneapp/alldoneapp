const path = require('path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|[\\/])(?:ProjectHelper|SharedHelper|ContactsHelper|PrivacyModal|RecurrenceModal|EstimationModal|BackendBridge|tasksFirestore|EstimationHelper|usersFirestore|URLTrigger|NavigationService|HelperFunctions|LinkingHelper|TasksHelper)(\.js)?$/,
            path.join(__dirname, 'fakeDependencies.js')
        ),
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|[\\/])DvBotButton(\.js)?$/,
            path.join(__dirname, 'AssistantButton.js')
        ),
    ],
})
