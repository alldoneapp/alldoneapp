/** @jest-environment-options {"url":"https://localhost:19006"} */
jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: {
        app: () => ({ options: { apiKey: 'local-key', projectId: 'alldonestaging' } }),
        auth: () => ({ currentUser: { uid: 'local-user', getIdToken: async () => 'local-token' } }),
    },
}))
jest.mock('../BackendBridge', () => ({
    __esModule: true,
    default: {
        getFirebaseProjectId: () => 'alldonestaging',
        getFunctionsRegion: () => 'europe-west1',
    },
}))

import { readDocumentDirectlyFromServer, updateDocumentDirectlyFromServer } from './firestoreDirectRead'
import { reportNewDayStatisticsError } from './Users/reportNewDayStatisticsError'
import { buildBrowserBounceUrl } from '../openInNewWindow'

const originalFetch = global.fetch
afterEach(() => {
    global.fetch = originalFetch
})

it('keeps REST recovery reads, writes and error reports on localhost without a query flag', async () => {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ missing: 'projects/alldonestaging/databases/(default)/documents/users/local-user' }],
    })
    await readDocumentDirectlyFromServer('users/local-user')
    await updateDocumentDirectlyFromServer('users/local-user', {}, 'version')
    await reportNewDayStatisticsError(new Error('Local failure'), { userId: 'local-user', projectId: 'local-project' })

    expect(global.fetch).toHaveBeenCalledTimes(3)
    for (const [url] of global.fetch.mock.calls) {
        expect(new URL(url).origin).toBe('http://127.0.0.1:8080')
    }
})

it('routes the browser bounce through the local Functions emulator', () => {
    expect(buildBrowserBounceUrl('https://localhost:19006/tasks')).toMatch(
        /^http:\/\/127\.0\.0\.1:5001\/alldonestaging\/europe-west1\//
    )
})
