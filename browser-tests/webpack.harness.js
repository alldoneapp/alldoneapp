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

    // Same babel pipeline, but pointed at a placeholder .env when the checkout
    // has none — see browser-tests/babel.harness.js. Without this the build dies
    // in react-native-dotenv long before any component renders.
    const harnessBabelConfig = path.join(__dirname, 'babel.harness.js')
    const useHarnessBabelConfig = rule => {
        if (!rule || typeof rule !== 'object') return rule
        const patched = { ...rule }
        if (patched.use && patched.use.options && patched.use.options.configFile) {
            patched.use = { ...patched.use, options: { ...patched.use.options, configFile: harnessBabelConfig } }
        }
        if (Array.isArray(patched.oneOf)) patched.oneOf = patched.oneOf.map(useHarnessBabelConfig)
        if (Array.isArray(patched.rules)) patched.rules = patched.rules.map(useHarnessBabelConfig)
        return patched
    }

    /**
     * Optional per-harness hook: `--env harnessSetup=<path>` names a module exporting
     * `(config, webpack) => config`. Inert unless a harness passes it.
     *
     * It exists so a harness can render a REAL container — one that imports the Firestore backend —
     * by replacing those leaf modules with fakes, the way a jest suite does with `jest.mock`.
     * Without it a browser harness can only ever mount presentational components with hand-fed
     * props, which is precisely the blind spot that let AT-2511 ship an animation that could not run
     * (see `at2511/realChain.entry.js`).
     */
    const applyHarnessSetup = config => {
        const setupPath = env && env.harnessSetup
        if (!setupPath) return config
        /**
         * webpack resolved from web-bundler, NOT from the repo root. The root still carries
         * webpack 4 (`node_modules/webpack@4.43.0`, an expo-era leftover) while these harnesses
         * build on web-bundler's webpack 5 — and a plugin instance from the wrong major taps the
         * same hooks with the wrong contract, so the build dies with "beforeResolve ... is no
         * longer a waterfall hook" rather than anything that names the mismatch.
         */
        const webpack = require(require.resolve('webpack', { paths: [path.join(rootDir, 'web-bundler')] }))
        return require(setupPath)(config, webpack)
    }

    return applyHarnessSetup({
        ...base,
        module: { ...base.module, rules: (base.module.rules || []).map(useHarnessBabelConfig) },
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
    })
}
