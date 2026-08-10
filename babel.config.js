/**
 * Root babel config — since migration Stage 5 its only live consumer is Jest
 * (babel-jest 30 on Node 22). The shipped web build uses web-bundler/babel.config.js;
 * keep the two aligned on SEMANTICS (sloppy-mode CJS, var hoisting, set-semantics
 * class fields, flow stripping without pragma, classic JSX runtime) so tests run the
 * same dialect that ships. The babel-preset-expo / metro-react-native-babel-preset
 * chain this replaced required the old @babel/core 7.12 pin and content-sniffed
 * per-file plugin sets — its transform-symbol-member plugin silently skipped the
 * CommonJS transform for any file importing a binding named `Symbol`
 * (e.g. lodash-es/_baseGetTag.js), which jest 30's stricter pipeline surfaced.
 *
 * Differences from web-bundler/babel.config.js, both deliberate:
 * - preset-env targets the running Node (tests execute in Node, not browsers);
 * - the CommonJS + block-scoping transforms apply to node_modules too, because
 *   jest's CJS runtime cannot consume ESM (webpack can, so the shipped build
 *   excludes node_modules from those transforms). Which node_modules get
 *   transformed at all is governed by transformIgnorePatterns in package.json.
 */
module.exports = function (api) {
    api.cache(true)
    return {
        assumptions: {
            // Class fields as assignments ([[Set]]), matching metro's loose mode
            // and the shipped web-bundler config.
            setPublicClassFields: true,
        },
        presets: [
            [
                require.resolve('@babel/preset-env'),
                {
                    targets: { node: 'current' },
                    modules: false, // module transform is the explicit sloppy-mode plugin below
                    bugfixes: true,
                },
            ],
            [require.resolve('@babel/preset-react'), { runtime: 'classic' }],
            // Reads .env and backs the two `from 'react-native-dotenv'` import sites.
            'module:react-native-dotenv',
        ],
        overrides: [
            {
                // RN-dialect sources don't always carry the @flow pragma.
                test: /\.(js|jsx|mjs|cjs)$/,
                presets: [[require.resolve('@babel/preset-flow'), { all: true }]],
            },
            {
                test: /\.(ts|tsx)$/,
                presets: [[require.resolve('@babel/preset-typescript'), { allowDeclareFields: true }]],
            },
        ],
        plugins: [
            [
                // Shared helpers from @babel/runtime instead of per-file inlining.
                // Not an optimization: _interopRequireWildcard caches namespace
                // objects in a WeakMap, and only a SHARED helper gives every module
                // the same namespace copy of a mocked module — several suites
                // mutate a mock through `import * as X` (bookingLanguage.test.js)
                // and expect other modules to observe it, which the metro preset's
                // shared-runtime behavior always guaranteed.
                require.resolve('@babel/plugin-transform-runtime'),
                {
                    helpers: true,
                    // Without the real runtime version the plugin assumes an
                    // ancient @babel/runtime and silently inlines any helper
                    // newer than 7.0 — including interopRequireWildcard's current
                    // form — defeating the shared-WeakMap behavior above.
                    version: require('@babel/runtime/package.json').version,
                },
            ],
            // `export default from './x'` — stage-1 proposal syntax the metro
            // preset always enabled; several app files and mocks use it.
            require.resolve('@babel/plugin-proposal-export-default-from'),
            [
                // Sloppy-mode CJS with var hoisting is load-bearing: app code
                // assigns undeclared identifiers (utils/backends/firestore.js) and
                // reads let/const before declaration (openTasks.js) — strict ESM
                // semantics turn both into ReferenceErrors (production incident
                // 2026-08-04, see web-bundler/babel.config.js).
                require.resolve('@babel/plugin-transform-modules-commonjs'),
                { strictMode: false, allowTopLevelThis: true, loose: true },
            ],
            require.resolve('@babel/plugin-transform-block-scoping'),
            // Forced even though Node supports class fields natively, so the
            // setPublicClassFields assumption above applies and test semantics
            // match the shipped transform rather than native [[Define]].
            require.resolve('@babel/plugin-transform-class-properties'),
        ],
    }
}
