const path = require('path')
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(
            /UIComponents\/AssistantVoiceCallProvider$/,
            path.join(__dirname, 'voice-call.js')
        ),
    ],
})
