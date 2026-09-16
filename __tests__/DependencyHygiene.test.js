const fs = require('fs')
const path = require('path')

const repoRoot = path.join(__dirname, '..')
const packageJson = require('../package.json')
const packageLock = require('../package-lock.json')

const forbiddenDirectPackages = [
    'expo',
    'react-native',
    'react-native-reanimated',
    'sentry-expo',
    '@expo/webpack-config',
    'babel-preset-expo',
    'metro-react-native-babel-preset',
]

const versionParts = version => version.split('.').map(part => Number.parseInt(part, 10))

const isSafeMinimatchVersion = version => {
    const [major, minor, patch] = versionParts(version)
    if (major !== 3) return true
    return minor > 1 || (minor === 1 && patch >= 4)
}

describe('retired Expo and React Native tooling stays out of the web app dependency tree', () => {
    it.each(forbiddenDirectPackages)('%s is not a direct dependency', packageName => {
        expect(packageJson.dependencies?.[packageName]).toBeUndefined()
        expect(packageJson.devDependencies?.[packageName]).toBeUndefined()
    })

    it('does not retain the legacy optimized-build manifest', () => {
        expect(fs.existsSync(path.join(repoRoot, 'package-optimized-build-bundle.json'))).toBe(false)
    })

    it('contains neither the retired xmldom package nor vulnerable minimatch 3.x releases', () => {
        const packages = Object.entries(packageLock.packages)

        expect(packages.some(([packagePath]) => /node_modules\/xmldom$/.test(packagePath))).toBe(false)

        const unsafeMinimatchPackages = packages
            .filter(([packagePath]) => /node_modules\/minimatch$/.test(packagePath))
            .filter(([, metadata]) => !isSafeMinimatchVersion(metadata.version))
            .map(([packagePath, metadata]) => `${packagePath}@${metadata.version}`)

        expect(unsafeMinimatchPackages).toEqual([])
    })
})
