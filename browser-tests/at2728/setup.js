const path = require('node:path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(
            /backends\/Assistants\/assistantRuns$/,
            path.join(__dirname, 'assistantRuns.js')
        ),
    ],
})
