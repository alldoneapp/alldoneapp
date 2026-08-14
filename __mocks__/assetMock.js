// The react-native preset turns an imported image into { testUri: <path> },
// and that path is computed relative to the transformer's own directory. CI
// symlinks node_modules to /app, so the same asset serialises differently there
// than in a normal checkout and any snapshot holding one cannot match in both
// places. Resolving assets to a fixed stub keeps snapshots portable.
module.exports = 'test-asset'
