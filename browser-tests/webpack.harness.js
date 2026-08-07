/**
 * Webpack config for the browser-level regression harnesses.
 *
 * Reuses the app's real build pipeline (`web-bundler/webpack.config.js`) so the
 * modules under test are compiled exactly the way the shipped bundle compiles
 * them; only the entry, the output directory and the HTML template differ.
 *
 * Run from the repo root with Node 22 and `web-bundler/node_modules` installed:
 *   node browser-tests/at2178/run.js
 */
const path = require('path')

const rootDir = path.resolve(__dirname, '..')

module.exports = (env, argv) => {
    const base = require(path.join(rootDir, 'web-bundler', 'webpack.config.js'))(env, {
        ...argv,
        mode: argv.mode || 'development',
    })

    const entry = env && env.harnessEntry
    const outputDir = (env && env.harnessOut) || path.join(rootDir, 'browser-tests', '.build')

    return {
        ...base,
        entry: [entry],
        output: {
            ...base.output,
            path: outputDir,
            filename: 'harness.js',
            chunkFilename: '[name].chunk.js',
            clean: true,
        },
        devtool: false,
        optimization: { minimize: false },
        plugins: base.plugins.filter(
            plugin => plugin.constructor.name !== 'CopyPlugin' && plugin.constructor.name !== 'HtmlWebpackPlugin'
        ),
        stats: 'errors-warnings',
    }
}
