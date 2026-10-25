const path = require('path')

// Keep the real blot, wrapper, row and responsive popup shell. Replace backend,
// navigation and secondary tag controls so the fixture needs no account/network.
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/useFloatPopupLock$/, path.join(__dirname, 'popupLock.js')),
        new webpack.NormalModuleReplacementPlugin(/redux\/store$/, path.join(__dirname, 'store.js')),
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|[\\/])(?:NotesEditorView|CustomTextInput3|textInputHelper|ManageTaskModal|RemovedTaskModal|modalsManager|SharedHelper|HelperFunctions|BackendBridge|tasksFirestore|LinkingHelper|ProjectHelper|assistantsHelper|TasksHelper|EstimationHelper|TaskEstimation|DescriptionTag|TaskRecurrence|PrivacyTag|TaskSubTasks|TaskSummation|TaskCommentsWrapper|DueDateModal|DateFormatPickerModal)(\.js)?$/,
            path.join(__dirname, 'dependencies.js')
        ),
    ],
})
