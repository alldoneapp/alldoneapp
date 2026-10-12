const path = require('node:path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(
            /backends\/Assistants\/assistantRuns$/,
            path.join(__dirname, 'assistantRuns.js')
        ),
        ...[
            /ContactsView\/Utils\/useGetUserPresentationData$/,
            /\/Utils\/HelperFunctions$/,
            /ChatsView\/Utils\/ChatHelper$/,
            /TaskListView\/Utils\/TasksHelper$/,
        ].map(pattern => new webpack.NormalModuleReplacementPlugin(pattern, path.join(__dirname, 'presentation.js'))),
        ...[
            /\/TextParser\/CommentElementsParser$/,
            /Tags\/(HashTag|LinkTag|MentionTag|EmailTag|GmailTag)$/,
            /TaskListView\/EmailLine\/EmailTaskAction$/,
        ].map(pattern => new webpack.NormalModuleReplacementPlugin(pattern, path.join(__dirname, 'empty.js'))),
    ],
})
