const path = require('node:path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/^\.\/helper$/, resource => {
            if (resource.context.endsWith('/AssistantOptions')) resource.request = path.join(__dirname, 'services.js')
        }),
        ...[
            /react-redux$/,
            /redux\/store$/,
            /AssistantOptions\/helper$/,
            /utils\/assistantHelper$/,
            /utils\/backends\/firestore$|^\.\.\/firestore$/,
            /AssistantVoiceCallProvider$/,
            /i18n\/TranslationService$/,
            /ModalsManager\/modalsManager$/,
            /ContactsView\/Utils\/ContactsHelper$/,
            /NotesView\/NotesDV\/EditorView\/mentionsHelper$/,
            /(?:^|[\/])(?:BackendBridge|WrapperMentionsModal|ProjectHelper|TasksHelper|PremiumHelper|LinkingHelper|HelperFunctions|assistantsHelper|RecordVideo|ScreenRecording|NotAvailableScreenRecording|\w+Firestore)(\.js)?$/,
        ].map(pattern => new webpack.NormalModuleReplacementPlugin(pattern, path.join(__dirname, 'services.js'))),
        new webpack.NormalModuleReplacementPlugin(
            /hooks\/useRambleRecorder$/,
            path.join(__dirname, '../anna-workspace/recorder.js')
        ),
        new webpack.NormalModuleReplacementPlugin(
            /(?:RageModeButton|RunOutOfGoldAssistantModal|AssistantTaskSearchButtonWrapper|QuickActionsMeasurer|OptionButtons|GoalProgress)$/,
            path.join(__dirname, '../anna-workspace/empty.js')
        ),
    ],
})
