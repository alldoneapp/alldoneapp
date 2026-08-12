/**
 * Phase-1 dual-write contract (TYPESENSE_MIGRATION.md): the Typesense layer must be a
 * guaranteed no-op with no env configured, must never throw into its callers (a Typesense
 * outage cannot be allowed to fail an Algolia write or the Firestore trigger hosting it),
 * and must normalize Algolia-shaped records (objectID, mixed-type isPublicFor) into valid
 * Typesense documents.
 */
jest.mock('typesense', () => ({ Client: jest.fn() }))
jest.mock('./envFunctionsHelper', () => ({ getEnvFunctions: jest.fn() }))

const Typesense = require('typesense')
const { getEnvFunctions } = require('./envFunctionsHelper')

const {
    ALL_COLLECTIONS,
    COLLECTION_SCHEMAS,
    TASKS_COLLECTION,
    isTypesenseConfigured,
    normalizeDocumentForTypesense,
    upsertTypesenseDocument,
    deleteTypesenseDocument,
    importTypesenseDocuments,
    deleteTypesenseProjectRecords,
    __resetTypesenseCachesForTests,
} = require('./typesenseHelper')

const CONFIGURED_ENV = { TYPESENSE_HOST: 'abc.a1.typesense.net', TYPESENSE_ADMIN_API_KEY: 'admin-key' }

// Fake typesense client: collections() -> {create}, collections(name) -> {retrieve, documents}
const makeFakeClient = ({ collectionExists = true } = {}) => {
    const upsert = jest.fn().mockResolvedValue({})
    const importFn = jest.fn().mockImplementation(docs => Promise.resolve(docs.map(() => ({ success: true }))))
    const deleteByFilter = jest.fn().mockResolvedValue({})
    const deleteDoc = jest.fn().mockResolvedValue({})
    const create = jest.fn().mockResolvedValue({})
    const retrieve = collectionExists
        ? jest.fn().mockResolvedValue({})
        : jest.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { httpStatus: 404 }))

    const client = {
        collections: name => {
            if (name === undefined) return { create }
            return {
                retrieve,
                documents: id => {
                    if (id === undefined) return { upsert, import: importFn, delete: deleteByFilter }
                    return { delete: deleteDoc }
                },
            }
        },
    }
    return { client, upsert, importFn, deleteByFilter, deleteDoc, create, retrieve }
}

beforeEach(() => {
    jest.clearAllMocks()
    __resetTypesenseCachesForTests()
})

describe('unconfigured environment', () => {
    beforeEach(() => {
        getEnvFunctions.mockReturnValue({ TYPESENSE_HOST: '', TYPESENSE_ADMIN_API_KEY: '' })
    })

    it('reports unconfigured and never constructs a client', async () => {
        expect(isTypesenseConfigured()).toBe(false)
        await upsertTypesenseDocument(TASKS_COLLECTION, { objectID: 'a1' })
        await deleteTypesenseDocument(TASKS_COLLECTION, 'a1')
        await importTypesenseDocuments(TASKS_COLLECTION, [{ objectID: 'a1' }])
        await deleteTypesenseProjectRecords('project-1')
        expect(Typesense.Client).not.toHaveBeenCalled()
    })
})

describe('document normalization', () => {
    it('maps objectID to a string id, stringifies isPublicFor, and drops undefined values', () => {
        const doc = normalizeDocumentForTypesense({
            objectID: 'task1project1',
            name: 'Do the thing',
            isPublicFor: [0, 'user-1', 'ws@default'],
            ghost: undefined,
        })
        expect(doc.id).toBe('task1project1')
        expect(doc.objectID).toBeUndefined()
        expect(doc.isPublicFor).toEqual(['0', 'user-1', 'ws@default'])
        expect('ghost' in doc).toBe(false)
        expect(doc.name).toBe('Do the thing')
    })
})

describe('configured environment', () => {
    it('parses a full-origin TYPESENSE_HOST and a bare host', async () => {
        getEnvFunctions.mockReturnValue({ ...CONFIGURED_ENV, TYPESENSE_HOST: 'https://abc.a1.typesense.net:8443' })
        const { client } = makeFakeClient()
        Typesense.Client.mockImplementation(() => client)
        await upsertTypesenseDocument(TASKS_COLLECTION, { objectID: 'a1' })
        expect(Typesense.Client).toHaveBeenCalledWith(
            expect.objectContaining({
                nodes: [{ host: 'abc.a1.typesense.net', port: 8443, protocol: 'https' }],
            })
        )
    })

    it('upserts the normalized document into the named collection', async () => {
        getEnvFunctions.mockReturnValue(CONFIGURED_ENV)
        const { client, upsert } = makeFakeClient()
        Typesense.Client.mockImplementation(() => client)

        await upsertTypesenseDocument(TASKS_COLLECTION, { objectID: 'a1', isPublicFor: [0] })
        expect(upsert).toHaveBeenCalledWith({ id: 'a1', isPublicFor: ['0'] })
    })

    it('creates a missing collection from its schema before the first write', async () => {
        getEnvFunctions.mockReturnValue(CONFIGURED_ENV)
        const { client, create, upsert } = makeFakeClient({ collectionExists: false })
        Typesense.Client.mockImplementation(() => client)

        await upsertTypesenseDocument(TASKS_COLLECTION, { objectID: 'a1' })
        expect(create).toHaveBeenCalledWith(COLLECTION_SCHEMAS[TASKS_COLLECTION])
        expect(upsert).toHaveBeenCalled()
    })

    it('never throws into the caller when the write fails', async () => {
        getEnvFunctions.mockReturnValue(CONFIGURED_ENV)
        const { client, upsert } = makeFakeClient()
        upsert.mockRejectedValue(new Error('cluster down'))
        Typesense.Client.mockImplementation(() => client)

        await expect(upsertTypesenseDocument(TASKS_COLLECTION, { objectID: 'a1' })).resolves.toBeUndefined()
    })

    it('swallows 404 on delete (document never indexed)', async () => {
        getEnvFunctions.mockReturnValue(CONFIGURED_ENV)
        const { client, deleteDoc } = makeFakeClient()
        deleteDoc.mockRejectedValue(Object.assign(new Error('Not Found'), { httpStatus: 404 }))
        Typesense.Client.mockImplementation(() => client)

        await expect(deleteTypesenseDocument(TASKS_COLLECTION, 'gone')).resolves.toBeUndefined()
    })

    it('imports in upsert mode and reports per-document failures without throwing', async () => {
        getEnvFunctions.mockReturnValue(CONFIGURED_ENV)
        const { client, importFn } = makeFakeClient()
        importFn.mockResolvedValue([{ success: true }, { success: false, error: 'bad type' }])
        Typesense.Client.mockImplementation(() => client)
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

        await importTypesenseDocuments(TASKS_COLLECTION, [{ objectID: 'a1' }, { objectID: 'a2' }])
        expect(importFn).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 'a1' }), expect.objectContaining({ id: 'a2' })],
            { action: 'upsert' }
        )
        expect(errorSpy).toHaveBeenCalled()
        errorSpy.mockRestore()
    })

    it('removes a deleted project from every collection with an exact projectId filter', async () => {
        getEnvFunctions.mockReturnValue(CONFIGURED_ENV)
        const { client, deleteByFilter } = makeFakeClient()
        Typesense.Client.mockImplementation(() => client)

        await deleteTypesenseProjectRecords('project-1')
        expect(deleteByFilter).toHaveBeenCalledTimes(ALL_COLLECTIONS.length)
        expect(deleteByFilter).toHaveBeenCalledWith({ filter_by: 'projectId:="project-1"' })
    })
})
