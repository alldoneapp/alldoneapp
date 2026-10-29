const path = require('node:path')
module.exports = (config, webpack) => {
    const stubs = [
        'connectionState',
        'firestore',
        'assistantHelper',
        'FloatingAssistantVoiceCall',
        'useGetMessages',
        'AnnaMessageBody',
        'useAnnaMessageReadState',
        'useAnnaContextNotices',
        'useAnnaActivityNotices',
        'useAnnaMessageSends',
        'annaWorkspaceWorkState',
        'ContactsHelper',
        'Icon',
        'RambleButton',
        'AddFeedAttachButton',
        'useRambleRecorder',
        'AnnaChatComposer',
        'AnnaMessageAuthor',
        'AnnaTimestamp',
        'AnnaActivityNotice',
        'AssistantProgress',
        'ChatHelper',
    ]
    return {
        ...config,
        module: {
            ...config.module,
            rules: [
                ...(process.env.AT2778_BASELINE
                    ? [
                          {
                              test: /(?:AnnaConversation|useAssistantVoiceCall|assistantCallConnectingTone)\.js$/,
                              enforce: 'pre',
                              use: path.join(__dirname, 'baseline-loader.js'),
                          },
                      ]
                    : []),
                ...config.module.rules,
            ],
        },
        plugins: [
            ...config.plugins,
            new webpack.NormalModuleReplacementPlugin(new RegExp(`(?:^|/)(?:${stubs.join('|')})$`), resource => {
                resource.request = path.join(
                    __dirname,
                    resource.request.endsWith('useAnnaMessageSends')
                        ? 'sends.js'
                        : resource.request.endsWith('useGetMessages')
                          ? 'messages.js'
                          : /useAnna(?:MessageReadState|ContextNotices|ActivityNotices)$/.test(resource.request)
                            ? 'notices.js'
                            : resource.request.endsWith('AnnaChatComposer')
                              ? 'composer.js'
                              : 'stubs.js'
                )
            }),
        ],
    }
}
