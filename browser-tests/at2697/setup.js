const path = require('path')

// Keep the real blot, wrapper, row and responsive popup shell. Replace backend,
// navigation and secondary tag controls so the fixture needs no account/network.
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/redux\/store$/, path.join(__dirname, 'store.js')),
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|[\\/])(?:NotesEditorView|CustomTextInput3|textInputHelper|ManageTaskModal|RemovedTaskModal|modalsManager|SharedHelper|HelperFunctions|BackendBridge|tasksFirestore|LinkingHelper|ProjectHelper|assistantsHelper|TasksHelper|EstimationHelper|TaskEstimation|DescriptionTag|TaskRecurrence|PrivacyTag|TaskSubTasks|TaskSummation|TaskCommentsWrapper|DateTagButton|Icon|SVGGenericUser)(\.js)?$/,
            path.join(__dirname, 'dependencies.js')
        ),
    ],
})
