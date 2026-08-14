const webpack = require('webpack')
const createExpoWebpackConfigAsync = require('@expo/webpack-config')
// const {BundleAnalyzerPlugin} = require('webpack-bundle-analyzer');

module.exports = async function (env, argv) {
    const config = await createExpoWebpackConfigAsync({ ...env, offline: false }, argv)

    // react-native-screens was removed in migration Stage 1. Its only importer,
    // react-navigation-stack, requires it inside a try/catch and guards every use
    // behind Platform.OS !== 'web', so ignoring the module makes the require throw
    // into that catch — the library's designed-optional path.
    config.plugins.push(new webpack.IgnorePlugin(/^react-native-screens$/))

    // Customize the config before returning it.
    if (env.mode === 'production') {
        config.output.filename = 'static/js/[name].[contenthash].js'
        config.output.chunkFilename = 'static/js/[name].[contenthash].chunk.js'
        // config.plugins.push(new BundleAnalyzerPlugin());
    }
    return config
}
