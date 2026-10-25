const path = require('node:path')
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/redux\/store$/, path.join(__dirname, 'store.js')),
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|\/)(?:firestore|BackendBridge|NavigationService|usersFirestore|ProjectHelper|EstimationHelper|PremiumHelper|WorkstreamHelper|DateFormatPickerModal|HelperFunctions|chatsComments)$/,
            path.join(__dirname, 'dependencies.js')
        ),
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|\/)(?:AssistantModeButton|ConnectionStatusChip)$/,
            path.join(__dirname, 'leaves.js')
        ),
    ],
})
