const fs = require('fs')
const path = require('path')

// security audit 2026-11 (NV-41/NV-42): the cleanup only helps if logout runs it, in this order —
// the push token is released while the session still exists (the rules need it), the local stores
// are cleared after sign-out, and only the in-page private-resource sign-out keeps Firestore alive.
const source = fs.readFileSync(path.join(__dirname, '../utils/backends/firestore.js'), 'utf8')
const logoutWeb = source.slice(
    source.indexOf('export function logoutWeb('),
    source.indexOf('export function getNewId(')
)

describe('logoutWeb cleanup wiring', () => {
    test('releases the push token before signing out and clears local data after', () => {
        const release = logoutWeb.indexOf('releaseToken()')
        const signOut = logoutWeb.indexOf('firebase.auth().signOut()')
        const clear = logoutWeb.indexOf('clearLocal()')
        expect(release).toBeGreaterThan(-1)
        expect(signOut).toBeGreaterThan(release)
        expect(clear).toBeGreaterThan(signOut)
        expect(logoutWeb).toMatch(/clearAccountLocalData\(/)
        expect(logoutWeb).toMatch(/releasePushToken\(/)
    })

    test('local data is cleared by default', () => {
        expect(logoutWeb).toMatch(/clearLocalData = true/)
        const sharedHelper = fs.readFileSync(path.join(__dirname, '../utils/SharedHelper.js'), 'utf8')
        expect(sharedHelper).toMatch(/clearLocalData: false/)
    })
})
