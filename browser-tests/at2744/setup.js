const path = require('node:path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/redux\/store$/, path.join(__dirname, 'store.js')),
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|\/)(?:BackendBridge|firestore|goalsFirestore|ProjectHelper|ProjectsSettings|ContactsHelper|TasksHelper|GoalsHelper|WorkstreamHelper|NavigationService|URLTrigger|guidesHelper|DateFormatPickerModal|TranslationService|LinkingHelper|modalsManager|PremiumHelper)$|backends\/Goals\/goalFocusAreas$/,
            path.join(__dirname, 'dependencies.js')
        ),
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|\/)(?:GoalSwipeDateRangeWrapper|GoalCommentsWrapper|ParentMilestonesWrapper|ObjectNoteTag|PrivacyTag|BacklinksTag|DescriptionTag|AssigneesIcon|ProjectMoveIndicator|SocialText|GoalsProgressModal|GoalsDoneProgressModal|ScheduleModeModal|GoalAssigneeCapacityModal|DueDateModal|FocusAreaPicker)$/,
            path.join(__dirname, 'leaves.js')
        ),
    ],
})
