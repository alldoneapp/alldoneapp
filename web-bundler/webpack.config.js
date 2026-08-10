/**
 * Standalone webpack 5 pipeline replacing `expo build:web` (FRONTEND_MIGRATION_PLAN.md
 * Stage 0). Runs on Node 22 from this directory; the app source and its runtime
 * dependencies resolve from the parent directory's node_modules (still installed with
 * the pinned Node 14 / npm 6 until Stage 1+).
 *
 * Contract kept from the old pipeline:
 * - entry is expo/AppEntry.js (same boot chain: Expo.fx → registerRootComponent)
 * - output goes to <repo>/web-build, bundles under static/js/[name].[contenthash]
 * - everything in web/ (except index.html) is copied into the output root;
 *   static/ in this directory carries the assets expo used to generate
 *   (manifest.json, favicon-16/32, pwa/ startup images) and wins on conflict
 * - env injection stays OUTSIDE the bundler: CI seds the BEGIN-ENVS blocks before
 *   building (ci/replace-envs.sh); local dev reads .env via react-native-dotenv
 * - fonts are emitted as fonts/[name].ttf, media as static/media/[name].[hash]
 *
 * webpack 4 → 5 gaps this config closes explicitly:
 * - node core-module polyfills are opt-in now (resolve.fallback + ProvidePlugin);
 *   the y-webrtc/simple-peer chain needs crypto/stream/buffer/process, exactly the
 *   set node-libs-browser used to inject
 * - setImmediate is no longer shimmed; react-native-web 0.11 depends on it, so the
 *   `setimmediate` polyfill is prepended to the entry
 */
const path = require('path')
const webpack = require('webpack')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const CopyPlugin = require('copy-webpack-plugin')

const rootDir = path.resolve(__dirname, '..')
const outputDir = path.join(rootDir, 'web-build')
const appJson = require(path.join(rootDir, 'app.json'))

module.exports = (env, argv) => {
    const mode = argv.mode || 'production'
    const isProd = mode === 'production'

    // expo-constants (pulled in by sentry-expo) reads the manifest that
    // @expo/webpack-config used to inject as process.env.APP_MANIFEST.
    const appManifest = {
        ...appJson.expo,
        // the fields expo's web manifest actually carried at runtime
        env: {},
        bundledAssets: [],
    }

    /**
     * Which files babel-loader must process:
     * - all app source (anything under the repo that is not in node_modules)
     * - the react-native/expo family of packages, which ship untranspiled
     *   Flow + JSX + class properties (same list @expo/webpack-config used)
     * react-native-web 0.11 is included too — its dist still carries Flow
     * annotations (e.g. `class TextInput extends Component<*>`).
     */
    const transpiledNodeModules =
        /node_modules[\\/](react-native|@react-native|expo|@expo|unimodules|@unimodules|react-navigation|sentry-expo|@sentry)/
    const babelInclude = file => {
        if (!file.includes('node_modules')) {
            return file.startsWith(rootDir)
        }
        return transpiledNodeModules.test(file)
    }

    const plugins = [
        new webpack.DefinePlugin({
            __DEV__: JSON.stringify(!isProd),
            'process.env.NODE_ENV': JSON.stringify(mode),
            'process.env.APP_MANIFEST': JSON.stringify(appManifest),
        }),
        new webpack.ProvidePlugin({
            process: 'process/browser.js',
            Buffer: ['buffer', 'Buffer'],
        }),
        // react-native-screens was removed in migration Stage 1. Its only importer,
        // react-navigation-stack, requires it inside a try/catch and guards every
        // use behind Platform.OS !== 'web', so ignoring the module makes the
        // require throw into that catch — the library's designed-optional path.
        new webpack.IgnorePlugin({ resourceRegExp: /^react-native-screens$/ }),
        new HtmlWebpackPlugin({
            template: path.join(__dirname, 'index.html'),
            inject: 'body',
            // Match the old pipeline exactly: synchronous scripts at the end of
            // <body>. With `defer` (the html-webpack-plugin default) Chrome was
            // observed skipping execution of some of the deferred chunks in this
            // template's legacy pre-<head> markup — bundles downloaded but never
            // ran, leaving #root empty with zero console errors.
            scriptLoading: 'blocking',
            minify: isProd
                ? {
                      collapseWhitespace: true,
                      removeComments: true,
                      removeRedundantAttributes: true,
                      removeScriptTypeAttributes: true,
                      removeStyleLinkTypeAttributes: true,
                      useShortDoctype: true,
                      minifyCSS: true,
                      minifyJS: true,
                  }
                : false,
        }),
        new CopyPlugin({
            patterns: [
                {
                    from: path.join(rootDir, 'web'),
                    to: outputDir,
                    globOptions: { ignore: ['**/index.html'] },
                },
                {
                    from: path.join(__dirname, 'static'),
                    to: outputDir,
                    force: true,
                },
            ],
        }),
    ]

    if (process.env.ANALYZE_BUNDLE) {
        const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer')
        plugins.push(new BundleAnalyzerPlugin())
    }

    return {
        mode,
        context: rootDir,
        entry: [path.join(__dirname, 'entry.js')],
        output: {
            path: outputDir,
            publicPath: '/',
            filename: 'static/js/[name].[contenthash].js',
            chunkFilename: 'static/js/[name].[contenthash].chunk.js',
            assetModuleFilename: 'static/media/[name].[hash:8][ext]',
            clean: true,
        },
        devtool: isProd ? 'source-map' : 'eval-cheap-module-source-map',
        resolve: {
            // CI symlinks the checkout's node_modules to /app/node_modules (baked
            // into the image). With webpack's default symlinks:true, modules resolve
            // to their REAL path under /app, so relative escapes back into app
            // source break there while working locally: expo/AppEntry.js's
            // '../../App', and the replacement_node_modules react-native-web patch
            // importing '../../../../../components/...'. The old expo pipeline set
            // symlinks:false for the same reason.
            symlinks: false,
            extensions: ['.web.js', '.web.jsx', '.js', '.jsx', '.web.ts', '.web.tsx', '.ts', '.tsx', '.json'],
            alias: {
                'react-native$': 'react-native-web',
            },
            // Keep webpack's default nearest-first node_modules walk. Putting the
            // root node_modules FIRST here (as an absolute path) breaks packages
            // that rely on their own nested copies — e.g. every @firebase/* package
            // nests tslib 2.3.1 while the hoisted root tslib is 1.11.1 (no
            // __spreadArray), which made the deferred Firebase load throw at runtime.
            // App source lives under the repo root, so the upward walk reaches the
            // root node_modules (also through CI's symlink) without special-casing.
            modules: ['node_modules'],
            fallback: {
                assert: require.resolve('assert/'),
                buffer: require.resolve('buffer/'),
                crypto: require.resolve('crypto-browserify'),
                events: require.resolve('events/'),
                os: require.resolve('os-browserify/browser'),
                path: require.resolve('path-browserify'),
                process: require.resolve('process/browser.js'),
                stream: require.resolve('stream-browserify'),
                url: require.resolve('url/'),
                util: require.resolve('util/'),
                vm: require.resolve('vm-browserify'),
                fs: false,
                child_process: false,
                net: false,
                tls: false,
            },
        },
        module: {
            rules: [
                // Some ESM packages import without file extensions; don't enforce
                // the spec-strict resolution webpack 5 applies to .mjs/ESM contexts.
                {
                    test: /\.m?js$/,
                    resolve: { fullySpecified: false },
                },
                {
                    test: /\.(js|jsx|ts|tsx)$/,
                    include: babelInclude,
                    use: {
                        loader: require.resolve('babel-loader'),
                        options: {
                            configFile: path.join(__dirname, 'babel.config.js'),
                            babelrc: false,
                            cacheDirectory: true,
                            cacheCompression: false,
                            compact: isProd,
                        },
                    },
                },
                {
                    test: /\.css$/,
                    use: [require.resolve('style-loader'), require.resolve('css-loader')],
                },
                {
                    test: /\.(ttf|otf|woff2?|eot)$/,
                    type: 'asset/resource',
                    generator: {
                        filename: 'fonts/[name][ext]',
                    },
                },
                {
                    test: /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/,
                    type: 'asset',
                    parser: {
                        dataUrlCondition: { maxSize: 1000 },
                    },
                },
                {
                    test: /\.(mp4|webm|mov|mp3|wav|m4a|aac|oga|flac)$/,
                    type: 'asset/resource',
                },
            ],
        },
        optimization: {
            minimize: isProd,
            splitChunks: { chunks: 'all' },
            runtimeChunk: true,
        },
        performance: { hints: false },
        plugins,
        devServer: {
            port: 19006,
            historyApiFallback: true,
            hot: true,
            static: [
                { directory: path.join(rootDir, 'web'), publicPath: '/' },
                { directory: path.join(__dirname, 'static'), publicPath: '/' },
            ],
            client: { overlay: { errors: true, warnings: false } },
        },
        // Stats kept quiet but real errors visible.
        stats: 'errors-warnings',
    }
}
