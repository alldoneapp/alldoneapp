const crypto = require('crypto')
const { buildGravatarUrl, findProfilePhotoCandidates, normalizeGithubUsername } = require('./profilePhotoFinder')

const response = ({ status = 200, contentType = 'image/jpeg', url = '', json = null } = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ 'content-type': contentType }),
    json: async () => json,
})

describe('buildGravatarUrl', () => {
    test('hashes the trimmed, lower-cased address with SHA-256 and asks for a 404 on a miss', () => {
        const hash = crypto.createHash('sha256').update('anna@example.com').digest('hex')
        expect(buildGravatarUrl('  Anna@Example.com ')).toBe(`https://gravatar.com/avatar/${hash}?s=400&d=404`)
    })

    test('returns null without an address', () => {
        expect(buildGravatarUrl('')).toBeNull()
        expect(buildGravatarUrl('not-an-email')).toBeNull()
    })
})

describe('normalizeGithubUsername', () => {
    test('accepts a bare name, an @handle and a profile URL', () => {
        expect(normalizeGithubUsername('annasomova')).toBe('annasomova')
        expect(normalizeGithubUsername('@annasomova')).toBe('annasomova')
        expect(normalizeGithubUsername('https://github.com/annasomova?tab=repos')).toBe('annasomova')
    })

    test('rejects names GitHub would not accept', () => {
        expect(normalizeGithubUsername('anna somova')).toBe('')
        expect(normalizeGithubUsername('')).toBe('')
    })
})

describe('findProfilePhotoCandidates', () => {
    test('collects Gravatar, GitHub and page images and says where each came from', async () => {
        const fetchImpl = jest.fn(async url => {
            if (url.startsWith('https://gravatar.com/avatar/')) return response({ url })
            if (url.startsWith('https://api.github.com/users/annasomova')) {
                return response({
                    contentType: 'application/json',
                    json: {
                        avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
                        html_url: 'https://github.com/annasomova',
                        name: 'Anna Somova',
                        company: 'Example',
                    },
                })
            }
            throw new Error(`unexpected fetch ${url}`)
        })
        const fetchPage = jest.fn(async url => ({
            success: true,
            title: 'Team | Example',
            ogImage: `${url}/anna.jpg`,
        }))

        const result = await findProfilePhotoCandidates(
            { email: 'anna@example.com', githubUsername: 'annasomova', pageUrls: ['https://example.com/team'] },
            { fetchImpl, fetchPage }
        )

        expect(result.success).toBe(true)
        expect(result.candidates.map(c => c.source)).toEqual(['gravatar', 'github', 'page'])
        expect(result.candidates[1]).toMatchObject({
            url: 'https://avatars.githubusercontent.com/u/1?v=4',
            profileUrl: 'https://github.com/annasomova',
        })
        expect(result.candidates[2]).toMatchObject({
            url: 'https://example.com/team/anna.jpg',
            pageUrl: 'https://example.com/team',
        })
        expect(result.note).toMatch(/photoUrl/)
    })

    test('a Gravatar miss and a GitHub 404 are reported, not thrown, and the page is still checked', async () => {
        const fetchImpl = jest.fn(async url => {
            if (url.startsWith('https://gravatar.com/')) return response({ status: 404, contentType: 'text/plain' })
            if (url.startsWith('https://api.github.com/'))
                return response({ status: 404, contentType: 'application/json' })
            throw new Error(`unexpected fetch ${url}`)
        })
        const fetchPage = jest.fn(async () => ({ success: true, ogImage: null, title: 'About' }))

        const result = await findProfilePhotoCandidates(
            { email: 'nobody@example.com', githubUsername: 'ghost', pageUrls: ['https://example.com/about'] },
            { fetchImpl, fetchPage }
        )

        expect(result.candidates).toEqual([])
        expect(result.checked).toEqual([
            { source: 'gravatar', found: false, reason: expect.stringMatching(/No Gravatar/) },
            { source: 'github', found: false, reason: 'GitHub user not found' },
            {
                source: 'page',
                pageUrl: 'https://example.com/about',
                found: false,
                reason: expect.stringMatching(/no social image/),
            },
        ])
        expect(result.note).toMatch(/No photo found/)
    })

    test('never asks the fetcher for a LinkedIn page', async () => {
        const fetchPage = jest.fn()
        const result = await findProfilePhotoCandidates(
            { pageUrls: ['https://www.linkedin.com/in/anna'] },
            { fetchImpl: jest.fn(), fetchPage }
        )
        expect(fetchPage).not.toHaveBeenCalled()
        expect(result.checked[2]).toMatchObject({
            source: 'page',
            found: false,
            reason: expect.stringMatching(/LinkedIn/),
        })
    })

    test('a lookup that throws is absorbed into `checked`', async () => {
        const fetchImpl = jest.fn(async () => {
            throw new Error('network down')
        })
        const result = await findProfilePhotoCandidates(
            { email: 'anna@example.com' },
            { fetchImpl, fetchPage: jest.fn() }
        )
        expect(result.success).toBe(true)
        expect(result.candidates).toEqual([])
        expect(result.checked[0]).toMatchObject({
            source: 'gravatar',
            found: false,
            reason: expect.stringMatching(/network down/),
        })
    })
})
