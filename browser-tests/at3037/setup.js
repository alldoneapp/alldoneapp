const path = require('path')
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(
            /(?:TranslationService|AdminPanel\/Assistants\/AssistantAvatar)$/,
            path.join(__dirname, 'leaves.js')
        ),
        new webpack.NormalModuleReplacementPlugin(
            /ContactsView\/Utils\/useGetUserPresentationData$/,
            path.join(__dirname, 'userLeaf.js')
        ),
    ],
})
