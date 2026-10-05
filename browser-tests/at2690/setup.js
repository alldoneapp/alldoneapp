const path = require('path')
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/connectionState$/, path.join(__dirname, 'connectionState.js')),
    ],
})
