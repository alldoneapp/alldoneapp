const path = require('path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(
            /(?:^|[\\/])(?:firestore|SettingsHelper|URLsSettings)(\.js)?$/,
            path.join(__dirname, 'fakeIntegrations.js')
        ),
    ],
})
