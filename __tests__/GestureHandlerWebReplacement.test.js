const fs = require('fs')
const path = require('path')

const replacementPath = path.join(
    __dirname,
    '..',
    'replacement_node_modules',
    'react-native-gesture-handler',
    'GestureComponents.web.js'
)

describe('react-native-gesture-handler web replacement', () => {
    const source = fs.readFileSync(replacementPath, 'utf8')

    it('does not statically import the removed react-native-web DrawerLayoutAndroid export', () => {
        expect(source).not.toContain('DrawerLayoutAndroid as RNDrawerLayoutAndroid')
        expect(source).toContain('export const DrawerLayoutAndroid = undefined')
    })
})
