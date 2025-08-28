import 'react-native-gesture-handler'
import { AppRegistry, Platform } from 'react-native'
import App from './App'

AppRegistry.registerComponent('alldone', () => App)

if (Platform.OS === 'web') {
    const rootTag = document.getElementById('root') || document.getElementById('main')
    AppRegistry.runApplication('alldone', { rootTag })
}
