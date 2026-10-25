const path = require('path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(
            /AssistantOptions[\\/]Search[\\/]AssistantTaskSearchModal(\.js)?$/,
            path.join(__dirname, 'AssistantTaskSearchModal.js')
        ),
    ],
})
