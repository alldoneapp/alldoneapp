const path = require('path')
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(
            /(?:CommentElementsParser|HashTag|LinkTag|MentionTag|EmailTag|GmailTag|TasksHelper|EmailTaskAction|VmInteractionCard|BrowserApprovalCard|StopAssistantRunButton|AssistantProgress|TranslationService|emailLineHelper|markChatCommentsAsRead|Feeds\/Utils\/HelperFunctions)$/,
            path.join(__dirname, 'leaves.js')
        ),
    ],
})
