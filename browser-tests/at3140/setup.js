const path = require('path')

// Same isolation as at2699: the composer, Quill, the attachment insertion path and the REAL
// image/video blots stay real; backend, translations and premium checks are faked.
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
