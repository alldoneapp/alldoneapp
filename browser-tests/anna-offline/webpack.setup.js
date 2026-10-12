const path = require('path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        ...[
            /redux\/store$/,
            /redux\/actions$/,
            /utils\/backends\/firestore$/,
            /utils\/backends\/Chats\/chatsComments$/,
            /utils\/backends\/Chats\/commentOutbox$/,
            /AdminPanel\/Assistants\/assistantsHelper$/,
            /InitialLoad\/bootIntegrityHealer$/,
            /connectionHealth$/,
        ].map(pattern => new webpack.NormalModuleReplacementPlugin(pattern, path.join(__dirname, 'transport.js'))),
    ],
})
