/**
 * Babel config for the browser-test harnesses.
 *
 * Identical to the app's real build config (`web-bundler/babel.config.js`) with
 * exactly one override: where react-native-dotenv reads its values from.
 *
 * The plugin runs with `allowUndefined: false` and resolves every
 * `react-native-dotenv` import while Babel is still transforming the file, so a
 * missing `.env` is a hard build failure — and `.env` is not in the repository
 * (CI seds the real values into the BEGIN-ENVS blocks instead). Harnesses only
 * render components and measure the DOM, so the values are irrelevant and only
 * the names have to exist. Use the developer's real `.env` when there is one,
 * and fall back to the committed placeholder otherwise.
 */
const fs = require('fs')
const path = require('path')

const base = require('../web-bundler/babel.config.js')

const ROOT_ENV = path.resolve(__dirname, '..', '.env')
const FALLBACK_ENV = path.join(__dirname, 'env.harness')
const envPath = fs.existsSync(ROOT_ENV) ? ROOT_ENV : FALLBACK_ENV

const isDotenvPlugin = plugin => Array.isArray(plugin) && String(plugin[0]).includes('react-native-dotenv')

module.exports = {
    ...base,
    plugins: (base.plugins || []).map(plugin =>
        isDotenvPlugin(plugin) ? [plugin[0], { ...plugin[1], path: envPath }] : plugin
    ),
}
