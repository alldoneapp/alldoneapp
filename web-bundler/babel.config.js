/**
 * Babel config for the standalone webpack pipeline ONLY (web-bundler/webpack.config.js
 * points babel-loader at this file explicitly). The root babel.config.js remains in
 * place for the legacy expo pipeline and Jest — do not merge the two: this one runs
 * on a modern @babel/core under Node 22, the root one on the web-pinned Babel 7.12.
 *
 * Mirrors what babel-preset-expo + metro-react-native-babel-preset provided for web:
 * - Flow stripping for untranspiled react-native/expo packages (all: true — RN-era
 *   files don't always carry the @flow pragma)
 * - classic JSX runtime (React 16.9 has no jsx-runtime entry point)
 * - loose/"set" semantics for class properties (metro preset used loose mode)
 * - transform-runtime with the tooling package's own @babel/runtime (absoluteRuntime),
 *   so helper imports never resolve against the app's pinned @babel/runtime 7.17
 * - react-native-dotenv for the two BEGIN-ENVS import sites; CI builds sed those
 *   imports away before building, so the plugin only activates for local dev
 */
const path = require('path')

module.exports = {
    assumptions: {
        setPublicClassFields: true,
    },
    presets: [
        [
            require.resolve('@babel/preset-env'),
            {
                targets: 'defaults',
                bugfixes: true,
            },
        ],
        [
            require.resolve('@babel/preset-react'),
            {
                runtime: 'classic',
            },
        ],
    ],
    overrides: [
        {
            // Flow for the RN-dialect .js sources (babel-preset-expo did the same);
            // TypeScript for the few .ts api clients.
            test: /\.(js|jsx|mjs|cjs)$/,
            presets: [[require.resolve('@babel/preset-flow'), { all: true }]],
        },
        {
            test: /\.(ts|tsx)$/,
            presets: [[require.resolve('@babel/preset-typescript'), { allowDeclareFields: true }]],
        },
    ],
    plugins: [
        // Reproduce the legacy pipeline's module semantics EXACTLY. The metro
        // preset compiled every module to sloppy-mode CommonJS with var-hoisted
        // bindings, and the app relies on that in ways strict ES modules break
        // at runtime on logged-in code paths (production incident 2026-08-04):
        // - assignments to undeclared identifiers (versionUnsub, lastPushTime
        //   in utils/backends/firestore.js) throw ReferenceError under strict
        //   mode but silently create globals in sloppy mode;
        // - use-before-declaration (openTasks.js) throws a TDZ ReferenceError
        //   under real let/const but reads undefined under var hoisting.
        // Keep these two transforms until an ESLint no-undef /
        // no-use-before-define sweep makes the codebase strict-clean; only
        // then can the CJS transform be dropped for tree-shaking.
        [
            require.resolve('@babel/plugin-transform-modules-commonjs'),
            {
                strictMode: false,
                allowTopLevelThis: true,
                loose: true,
            },
        ],
        require.resolve('@babel/plugin-transform-block-scoping'),
        [
            require.resolve('@babel/plugin-transform-runtime'),
            {
                helpers: true,
                regenerator: true,
                absoluteRuntime: path.dirname(require.resolve('@babel/runtime/package.json')),
            },
        ],
        [
            require.resolve('react-native-dotenv'),
            {
                moduleName: 'react-native-dotenv',
                path: path.resolve(__dirname, '..', '.env'),
                allowUndefined: false,
            },
        ],
    ],
}
