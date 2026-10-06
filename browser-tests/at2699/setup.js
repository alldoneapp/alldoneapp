const path = require('path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/redux\/store$/, path.join(__dirname, 'store.js')),
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|[\/])(?:BackendBridge|WrapperMentionsModal|ProjectHelper|TasksHelper|PremiumHelper|TranslationService|LinkingHelper|HelperFunctions|assistantsHelper|RecordVideo|ScreenRecording|NotAvailableScreenRecording|\w+Firestore)(\.js)?$/,
            path.join(__dirname, 'dependencies.js')
        ),
    ],
})
