const path = require('path')
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        ...[
            /react-redux$/,
            /ModalsManager\/modalsManager$/,
            /ContactsView\/Utils\/ContactsHelper$/,
            /utils\/backends\/firestore$/,
            /utils\/backends\/Chats\/chatsComments$/,
            /utils\/backends\/Chats\/commentOutbox$/,
            /utils\/backends\/Assistants\/browserApprovals$/,
            /utils\/backends\/Assistants\/browserTakeover$/,
            /utils\/assistantHelper$/,
            /utils\/appResume$/,
            /utils\/NavigationService$/,
            /URLSystem\/URLTrigger$/,
            /i18n\/TranslationService$/,
            /AdminPanel\/Assistants\/assistantsHelper$/,
            /UIComponents\/AssistantVoiceCallProvider$/,
            /Feeds\/Utils\/HelperFunctions$/,
            /ChatsView\/Utils\/ChatHelper$/,
            /ChatsView\/ChatDV\/EditorView\/messageLoadingState$/,
        ].map(pattern => new webpack.NormalModuleReplacementPlugin(pattern, path.join(__dirname, 'services.js'))),
        new webpack.NormalModuleReplacementPlugin(/hooks\/Chats\/useGetMessages$/, path.join(__dirname, 'messages.js')),
        new webpack.NormalModuleReplacementPlugin(
            /(AnnaWorkspaceHighlight|useAnnaMessageReadState|VoiceMicrophoneStatus|AssistantVoiceCallButton)$/,
            path.join(__dirname, 'empty.js')
        ),
        new webpack.NormalModuleReplacementPlugin(
            /ChatsView\/ChatDV\/EditorView\/MessageItemBody$/,
            path.join(__dirname, 'message.js')
        ),
    ],
})
