// Web entry (migration Stage 2). Replaces the expo/AppEntry boot chain: with
// react-native-web 0.19+ AppRegistry.runApplication mounts through React 18's
// createRoot, and the expo 36 launch wrappers (Expo.fx / expo-asset / the
// withExpoRoot error-recovery props) are RNW-0.11-era code the app never used.
// Registration name 'main' and the #root/#main lookup match the old behavior.
import 'setimmediate'
import { AppRegistry } from 'react-native'
import App from '../App'

AppRegistry.registerComponent('main', () => App)
AppRegistry.runApplication('main', {
    rootTag: document.getElementById('root') || document.getElementById('main'),
})
