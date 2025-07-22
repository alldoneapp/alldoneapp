const createExpoWebpackConfigAsync = require('@expo/webpack-config')
// const {BundleAnalyzerPlugin} = require('webpack-bundle-analyzer');

module.exports = async function (env, argv) {
    const config = await createExpoWebpackConfigAsync({ ...env, offline: false }, argv)

    // Customize the config before returning it.
    if (env.mode === 'production') {
        config.output.filename = 'static/js/[name].[contenthash].js'
        config.output.chunkFilename = 'static/js/[name].[contenthash].chunk.js'
        // config.plugins.push(new BundleAnalyzerPlugin());
    }
    return config
}
