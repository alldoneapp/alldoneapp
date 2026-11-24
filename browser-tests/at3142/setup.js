const path = require('path')

// The REAL "Plan my day" chain stays real: DailyPlanEntry → DailyPlanModal (WorkspaceModal,
// useModalSizing, the review and postpone steps, the model) → AppPopover summary, the redux
// filter actions and the real translations. Only the store, the project helper and the callable
// wrapper (utils/backends/Tasks/dailyPlan.js) are replaced, so nothing can reach a network.
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/redux\/store$/, path.join(__dirname, 'store.js')),
        new webpack.NormalModuleReplacementPlugin(
            /ProjectsSettings\/ProjectHelper(\.js)?$/,
            path.join(__dirname, 'projectHelper.js')
        ),
        new webpack.NormalModuleReplacementPlugin(
            /backends\/Tasks\/dailyPlan(\.js)?$/,
            path.join(__dirname, 'dailyPlanBackend.js')
        ),
    ],
})
