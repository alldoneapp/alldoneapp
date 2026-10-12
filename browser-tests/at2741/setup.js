const path = require('node:path')
module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/backends\/Tasks\/tasksFirestore$/, resource => {
            if (resource.context.endsWith('TaskDetailedView/Properties')) {
                resource.request = path.join(__dirname, 'writes.js')
            }
        }),
    ],
})
