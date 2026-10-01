const path = require('path')
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/textInputHelper$/, resource => {
            if (resource.context.endsWith('CommentsTextInput')) {
                resource.request = path.join(__dirname, 'textInputMeta.js')
            }
        }),
        new webpack.NormalModuleReplacementPlugin(
            /(?:BackendBridge|PremiumHelper|LinkingHelper|HelperFunctions|attachmentFileUtils)$/,
            resource => {
                if (resource.context.endsWith('CommentsTextInput')) {
                    resource.request = path.join(__dirname, 'clipboardDependencies.js')
                }
            }
        ),
    ],
})
