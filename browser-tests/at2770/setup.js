const path = require('path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(
            /(?:BackendBridge|Observers|HelperFunctions|ContactsHelper|EstimationHelper|\w+Firestore|UserDataCache|newDayAcknowledgement|reportNewDayStatisticsError|appResume|DayRateTimeLogHelper|happinessProjects|EndDayStatisticsHelper|DateFormatPickerModal|connectionHealth|TranslationService|NavigationService|ProjectHelper|assistantsHelper|suggestedTaskBulkActions|redux\/store|redux\/actions|backends\/firestore)$/,
            path.join(__dirname, 'dependencies.js')
        ),
        new webpack.NormalModuleReplacementPlugin(
            /(?:lottie-react|GoalProgress|ProjectDayActivity|ProjectHappinessRatingList|KickUserConfirmPopup|NotificationTimeout|RevisionHistoryConfirmationModal|PushNotificationsModalMandatory)$/,
            path.join(__dirname, 'empty.js')
        ),
    ],
})
