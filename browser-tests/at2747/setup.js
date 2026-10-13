const path = require('node:path')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/\/redux\/store$/, path.join(__dirname, 'unusedAppStore.js')),
    ],
})
