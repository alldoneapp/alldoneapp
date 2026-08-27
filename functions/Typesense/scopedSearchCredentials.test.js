jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: jest.fn() }))
jest.mock('../typesenseHelper', () => ({
    formatTypesenseFilterValue: value => '`' + String(value).replace(/`/g, '') + '`',
    generateTypesenseScopedSearchKey: jest.fn(),
}))

const { getEnvFunctions } = require('../envFunctionsHelper')
const { generateTypesenseScopedSearchKey } = require('../typesenseHelper')
const {
    SCOPED_KEY_TTL_SECONDS,
    TypesenseSearchCredentialsError,
    buildEmbeddedAccessFilter,
    createTypesenseScopedSearchCredentials,
    normalizeTypesenseOrigin,
} = require('./scopedSearchCredentials')

const makeSnapshot = ids => ({ docs: ids.map(id => ({ id })) })

const makeDb = ({ projectIds = [], workstreamsByProject = {} } = {}) => {
    const get = jest.fn(path => {
        if (path === 'projects') return Promise.resolve(makeSnapshot(projectIds))
        const projectId = path.split('/')[1]
        return Promise.resolve(makeSnapshot(workstreamsByProject[projectId] || []))
    })

    return {
        get,
        collection: path => ({
            where: (field, operator, value) => {
                expect(field).toBe('userIds')
                expect(operator).toBe('array-contains')
                expect(value).toBe('user-1')
                return {
                    select: () => ({ get: () => get(path) }),
                }
            },
        }),
    }
}

beforeEach(() => {
    jest.clearAllMocks()
    getEnvFunctions.mockReturnValue({
        TYPESENSE_HOST: 'search.example.com',
        TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY: 'parent-search-key',
    })
    generateTypesenseScopedSearchKey.mockReturnValue('scoped-key')
})

describe('buildEmbeddedAccessFilter', () => {
    test('pins normal users to authoritative projects and audience ids', () => {
        expect(
            buildEmbeddedAccessFilter({
                projectIds: ['project-1', 'project-2'],
                userId: 'user-1',
                isAnonymous: false,
                workstreamIds: ['ws@custom', 'ws@custom'],
            })
        ).toBe(
            'projectId:=[`project-1`,`project-2`,`globalProject`] && ' +
                'isPublicFor:=[`0`,`user-1`,`ws@default`,`ws@custom`]'
        )
    })

    test('anonymous users get public records only', () => {
        expect(
            buildEmbeddedAccessFilter({
                projectIds: ['project-1'],
                userId: 'user-1',
                isAnonymous: true,
                workstreamIds: ['must-not-leak'],
            })
        ).toBe('projectId:=[`project-1`,`globalProject`] && isPublicFor:=[`0`]')
    })

    test('strips filter syntax delimiters from ids', () => {
        expect(
            buildEmbeddedAccessFilter({
                projectIds: ['project`-1'],
                userId: 'user`-1',
                isAnonymous: false,
            })
        ).toBe('projectId:=[`project-1`,`globalProject`] && isPublicFor:=[`0`,`user-1`,`ws@default`]')
    })
})

describe('createTypesenseScopedSearchCredentials', () => {
    test('derives the scope from project and workstream membership stored by the server', async () => {
        const db = makeDb({
            projectIds: ['project-1', 'project-2'],
            workstreamsByProject: { 'project-1': ['ws@one'], 'project-2': ['ws@two'] },
        })

        await expect(createTypesenseScopedSearchCredentials({ db, userId: 'user-1', now: 1_000_000 })).resolves.toEqual(
            {
                userId: 'user-1',
                origin: 'https://search.example.com',
                apiKey: 'scoped-key',
                expiresAt: 1000 + SCOPED_KEY_TTL_SECONDS,
            }
        )

        expect(db.get).toHaveBeenCalledTimes(3)
        expect(generateTypesenseScopedSearchKey).toHaveBeenCalledWith('parent-search-key', {
            filter_by:
                'projectId:=[`project-1`,`project-2`,`globalProject`] && ' +
                'isPublicFor:=[`0`,`user-1`,`ws@default`,`ws@one`,`ws@two`]',
            exclude_fields: 'content,cleanComments',
            limit_multi_searches: 5,
            per_page: 20,
            expires_at: 1000 + SCOPED_KEY_TTL_SECONDS,
        })
    })

    test('does not query workstreams for anonymous users', async () => {
        const db = makeDb({ projectIds: ['project-1'], workstreamsByProject: { 'project-1': ['ws@one'] } })

        await createTypesenseScopedSearchCredentials({
            db,
            userId: 'user-1',
            isAnonymous: true,
            now: 1_000_000,
        })

        expect(db.get).toHaveBeenCalledTimes(1)
        expect(generateTypesenseScopedSearchKey).toHaveBeenCalledWith(
            'parent-search-key',
            expect.objectContaining({
                filter_by: 'projectId:=[`project-1`,`globalProject`] && isPublicFor:=[`0`]',
            })
        )
    })

    test('fails closed when the parent search key is missing', async () => {
        getEnvFunctions.mockReturnValue({ TYPESENSE_HOST: 'search.example.com' })

        await expect(createTypesenseScopedSearchCredentials({ db: makeDb(), userId: 'user-1' })).rejects.toEqual(
            expect.objectContaining({
                name: 'TypesenseSearchCredentialsError',
                code: 'failed-precondition',
            })
        )
        expect(generateTypesenseScopedSearchKey).not.toHaveBeenCalled()
    })

    test('requires authentication', async () => {
        await expect(createTypesenseScopedSearchCredentials({ db: makeDb() })).rejects.toBeInstanceOf(
            TypesenseSearchCredentialsError
        )
    })
})

describe('normalizeTypesenseOrigin', () => {
    test.each([
        ['search.example.com', 'https://search.example.com'],
        ['https://search.example.com:8443/path', 'https://search.example.com:8443'],
    ])('normalizes %s', (host, expected) => {
        expect(normalizeTypesenseOrigin(host)).toBe(expected)
    })

    test('rejects invalid hosts', () => {
        expect(() => normalizeTypesenseOrigin('not a valid host')).toThrow(TypesenseSearchCredentialsError)
    })
})
