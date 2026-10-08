const path = require('path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/redux\/store$/, path.join(__dirname, '../at2699/store.js')),
        new webpack.NormalModuleReplacementPlugin(/(?:^|[\/])MentionsModal$/, path.join(__dirname, 'picker.js')),
        new webpack.NormalModuleReplacementPlugin(
            /ModalsManager\/modalsManager$/,
            path.join(__dirname, 'dependencies.js')
        ),
        new webpack.NormalModuleReplacementPlugin(
            /NotesView\/NotesDV\/EditorView\/mentionsHelper$/,
            path.join(__dirname, 'dependencies.js')
        ),
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|[\/])(?:BackendBridge|ProjectHelper|TasksHelper|PremiumHelper|TranslationService|LinkingHelper|HelperFunctions|assistantsHelper|assistantHelper|RecordVideo|ScreenRecording|NotAvailableScreenRecording|\w+Firestore)(\.js)?$/,
            path.join(__dirname, 'dependencies.js')
        ),
    ],
})
