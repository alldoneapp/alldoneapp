const path = require('path')
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(
            /(?:TranslationService|AdminPanel\/Assistants\/AssistantAvatar)$/,
            path.join(__dirname, 'leaves.js')
        ),
    ],
})
