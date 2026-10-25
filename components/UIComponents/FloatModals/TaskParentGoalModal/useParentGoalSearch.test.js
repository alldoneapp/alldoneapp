import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { __resetTypesenseCredentialCacheForTests } from '../../../../utils/typesenseSearch'
import useParentGoalSearch from './useParentGoalSearch'

jest.mock('../../../../utils/BackendBridge', () => ({
    getCurrentUserId: jest.fn(() => 'user'),
    getTypesenseScopedSearchCredentials: jest.fn(async () => ({
        userId: 'user',
        origin: 'https://search.example.com',
        apiKey: 'test-key',
        expiresAt: 4102444800,
    })),
}))

const projectsMap = { other: { index: 0 }, privat: { index: 100 } }
const goal = (id, projectId = 'privat') => ({
    document: { id: id + projectId, projectId, name: id, isPublicFor: ['0'] },
})
const page = (hits, found = hits.length) => ({ hits, found })
const response = (...results) => ({ ok: true, json: async () => ({ results }) })
const deferred = () => {
    let resolve
    const promise = new Promise(done => (resolve = done))
    return { resolve, promise }
}

describe('parent goal picker search with real Typesense request and response adaptation', () => {
    let tree
    let search
    const Harness = props => {
        search = useParentGoalSearch({ projectId: 'privat', userId: 'user', projectsMap, query: '', ...props })
        return null
    }
    const mount = async (props = {}) => {
        await act(async () => {
            tree = renderer.create(<Harness {...props} />)
        })
    }
    const requests = call => JSON.parse(global.fetch.mock.calls[call][1].body).searches

    beforeEach(() => {
        __resetTypesenseCredentialCacheForTests()
        global.fetch = jest.fn()
    })
    afterEach(() => {
        if (tree) act(() => tree.unmount())
        tree = null
        delete global.fetch
    })

    it('shows Privat immediately despite twenty newer goals elsewhere, and reaches later pages in both scopes', async () => {
        const privateGoals = Array.from({ length: 20 }, (_, i) => goal(`private-${i}`))
        const otherGoals = Array.from({ length: 20 }, (_, i) => goal(`other-${i}`, 'other'))
        global.fetch.mockResolvedValueOnce(response(page(privateGoals, 21), page(otherGoals, 21)))
        await mount()

        expect(search.hits).toHaveLength(40)
        expect(search.hits[0]).toMatchObject({ id: 'private-0', projectId: 'privat', isPublicFor: [0] })
        expect(search.hasMore).toBe(true)
        expect(requests(0)).toEqual([
            expect.objectContaining({
                q: '*',
                filter_by: 'projectId:=[`privat`] && isPublicFor:=[`0`,`user`]',
                page: 1,
                per_page: 20,
            }),
            expect.objectContaining({
                q: '*',
                filter_by: 'projectId:=[`other`] && isPublicFor:=[`0`,`user`]',
                page: 1,
                per_page: 20,
            }),
        ])

        global.fetch.mockResolvedValueOnce(
            response(page([goal('private-20')], 21), page([goal('other-20', 'other')], 21))
        )
        await act(async () => {
            await search.loadMore()
        })
        expect(requests(1).map(request => request.page)).toEqual([2, 2])
        expect(search.hits).toHaveLength(42)
        expect(search.hits[20].id).toBe('private-20')
        expect(search.hasMore).toBe(false)
        await act(async () => {
            await search.loadMore()
        })
        expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('preserves successful goals when another scope fails and retries only the failed page', async () => {
        global.fetch.mockResolvedValueOnce(response(page([goal('private')]), { error: 'Service unavailable' }))
        await mount()
        expect(search.hits.map(hit => hit.id)).toEqual(['private'])
        expect(search.error).toBe(true)

        global.fetch.mockResolvedValueOnce(response(page([goal('other', 'other')])))
        await act(async () => {
            await search.loadMore()
        })
        expect(requests(1)).toHaveLength(1)
        expect(requests(1)[0]).toMatchObject({
            page: 1,
            filter_by: 'projectId:=[`other`] && isPublicFor:=[`0`,`user`]',
        })
        expect(search.hits.map(hit => hit.id)).toEqual(['private', 'other'])
        expect(search.error).toBe(false)
        expect(search.hasMore).toBe(false)
    })

    it('retries a network failure and ignores duplicate load clicks while the request is pending', async () => {
        global.fetch.mockRejectedValueOnce(new Error('Network failure'))
        await mount()
        expect(search.error).toBe(true)
        expect(search.loading).toBe(false)
        const pending = deferred()
        global.fetch.mockReturnValueOnce(pending.promise)
        let retry
        await act(async () => {
            retry = search.loadMore()
            search.loadMore()
        })
        expect(global.fetch).toHaveBeenCalledTimes(2)
        await act(async () => {
            pending.resolve(response(page([goal('recovered')]), page([])))
            await retry
        })
        expect(search.hits.map(hit => hit.id)).toEqual(['recovered'])
        expect(search.error).toBe(false)
    })

    it('keeps the latest query results when an older query finishes last, even with the same hit count', async () => {
        const old = deferred()
        global.fetch.mockReturnValueOnce(old.promise)
        await mount({ query: 'old' })
        global.fetch.mockResolvedValueOnce(response(page([goal('new')]), page([])))
        await act(async () => {
            tree.update(<Harness query="new" />)
        })
        expect(search.hits.map(hit => hit.id)).toEqual(['new'])
        await act(async () => {
            old.resolve(response(page([goal('old')]), page([])))
        })
        expect(search.hits.map(hit => hit.id)).toEqual(['new'])
        expect(search.loading).toBe(false)
        expect(requests(1).map(request => request.q)).toEqual(['new', 'new'])
    })

    it('does not search without accessible projects and resets pagination when the project changes', async () => {
        await mount({ projectsMap: {} })
        expect(global.fetch).not.toHaveBeenCalled()
        expect(search.loading).toBe(false)
        global.fetch.mockResolvedValueOnce(response(page([goal('private')]), page([goal('other', 'other')])))
        await act(async () => {
            tree.update(<Harness />)
        })
        expect(search.hits[0].projectId).toBe('privat')
        global.fetch.mockResolvedValueOnce(response(page([goal('other', 'other')]), page([goal('private')])))
        await act(async () => {
            tree.update(<Harness projectId="other" />)
        })
        expect(search.hits[0].projectId).toBe('other')
        expect(requests(1)[0]).toMatchObject({
            page: 1,
            filter_by: 'projectId:=[`other`] && isPublicFor:=[`0`,`user`]',
        })
    })
})
