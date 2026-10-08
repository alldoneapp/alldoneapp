const path = require('node:path')
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(
            /(?:redux\/(?:store|actions)|ProjectHelper|HelperFunctions|WorkstreamHelper|assistantsHelper|backends\/firestore)$/,
            path.join(__dirname, 'dependencies.js')
        ),
    ],
})
