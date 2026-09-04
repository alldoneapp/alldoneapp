/**
 * Webpack setup for the AT-2511 real-chain harness: swap the three Firestore leaf modules the
 * last-comment subtree imports for the fakes next door, so the REAL container can be mounted in a
 * real browser.
 *
 * `NormalModuleReplacementPlugin` rather than `resolve.alias` because every import in that subtree
 * is RELATIVE (`../../../../utils/backends/...`). An alias matches the request string, which never
 * equals those; the plugin matches the RESOLVED path, which always does.
 */
const path = require('path')

const FAKES = path.join(__dirname, 'fakes')

const REPLACEMENTS = [
    [/utils[\\/]backends[\\/]Chats[\\/]chatsComments(\.js)?$/, path.join(FAKES, 'chatsComments.js')],
    [/utils[\\/]backends[\\/]Chats[\\/]chatsFirestore(\.js)?$/, path.join(FAKES, 'chatsFirestore.js')],
    [/utils[\\/]backends[\\/]firestore(\.js)?$/, path.join(FAKES, 'firestore.js')],
]

module.exports = (config, webpack) => ({
    ...config,
    plugins: [
        ...config.plugins,
        ...REPLACEMENTS.map(
            ([pattern, replacement]) =>
                new webpack.NormalModuleReplacementPlugin(pattern, resource => {
                    // Leave the fakes themselves alone, or the replacement is recursive.
                    if (resource.request.includes(`${path.sep}fakes${path.sep}`)) return
                    resource.request = replacement
                })
        ),
    ],
})
