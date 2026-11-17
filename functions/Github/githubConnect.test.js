// AM-1304: connecting a GitHub repo checks whether the token can read the pipeline, so a token made
// with only Contents + Pull requests is flagged at connect time instead of by a confused VM run.
jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('firebase-functions/v2/https', () => ({
    HttpsError: class HttpsError extends Error {
        constructor(code, message) {
            super(message)
            this.code = code
        }
    },
}))

const { findMissingCiPermissions } = require('./githubConnect')

const originalFetch = global.fetch

afterEach(() => {
    global.fetch = originalFetch
})

function mockGithub(statusByPath) {
    global.fetch = jest.fn(async url => {
        const match = Object.keys(statusByPath).find(path => url.includes(path))
        if (match && statusByPath[match] === 'network') throw new Error('ECONNRESET')
        return { status: match ? statusByPath[match] : 200 }
    })
}

describe('findMissingCiPermissions', () => {
    test('names both permissions when GitHub refuses runs and statuses', async () => {
        mockGithub({ '/actions/runs': 403, '/status': 403 })
        await expect(findMissingCiPermissions('https://api.github.com', 'acme/app', 'main', 'token')).resolves.toEqual([
            'Actions: read',
            'Commit statuses: read',
        ])
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.github.com/repos/acme/app/actions/runs?per_page=1',
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) })
        )
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.github.com/repos/acme/app/commits/main/status',
            expect.anything()
        )
    })

    test('reports nothing when the token can read both', async () => {
        mockGithub({})
        await expect(findMissingCiPermissions('https://api.github.com', 'acme/app', 'main', 'token')).resolves.toEqual(
            []
        )
    })

    test('only a 403 counts as missing: 404 and network errors do not warn', async () => {
        mockGithub({ '/actions/runs': 'network', '/status': 404 })
        await expect(findMissingCiPermissions('https://api.github.com', 'acme/app', 'main', 'token')).resolves.toEqual(
            []
        )
    })
})
