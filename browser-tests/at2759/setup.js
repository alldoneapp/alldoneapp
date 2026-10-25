const path = require('node:path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|\/)(?:textInputHelper|TasksHelper|ContactsHelper|ProjectHelper|assistantsHelper|GoalsHelper|WorkstreamHelper)$/,
            path.join(__dirname, 'dependencies.js')
        ),
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|\/)(?:ObjectHeaderParser|SocialText|AssigneesIcon)$/,
            path.join(__dirname, 'textLeaf.js')
        ),
    ],
})
