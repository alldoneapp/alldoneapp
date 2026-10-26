/**
 * Webpack setup for the AT-2867 harness: replace ProjectHelper (which imports the whole app
 * store) with a fake, so the REAL CommentPopupProjectLine can be mounted on its own.
 */
const path = require('path')

const FAKE = path.join(__dirname, 'fakes', 'ProjectHelper.js')

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        new webpack.NormalModuleReplacementPlugin(/ProjectsSettings[\\/]ProjectHelper(\.js)?$/, resource => {
            resource.request = FAKE
        }),
    ],
})
