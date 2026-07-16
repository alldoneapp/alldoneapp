jest.mock(
    'firebase-functions/v2/https',
    () => ({
        HttpsError: class HttpsError extends Error {
            constructor(code, message) {
                super(message)
                this.code = code
            }
        },
    }),
    { virtual: true }
)

const mockDocuments = {}
const mockRefs = new Map()
const mockDoc = jest.fn(path => {
    if (!mockRefs.has(path)) {
        mockRefs.set(path, {
            path,
            get: jest.fn(async () => ({
                exists: Object.prototype.hasOwnProperty.call(mockDocuments, path),
                data: () => mockDocuments[path],
            })),
            set: jest.fn(async (data, options) => {
                mockDocuments[path] = options?.merge ? { ...(mockDocuments[path] || {}), ...data } : data
            }),
        })
    }
    return mockRefs.get(path)
})
jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        doc: mockDoc,
        runTransaction: async callback =>
            callback({
                get: ref => ref.get(),
                set: (ref, data, options) => ref.set(data, options),
            }),
    })),
}))

const {
    MERGE_STATUS,
    extractMergeRequestReference,
    normalizeGitlabMergeStatus,
    normalizeGithubMergeStatus,
    refreshTaskMergeStatus,
    associateVmMergeRequestWithTask,
    __private__: { shouldReplaceTaskReference },
} = require('./mergeStatus')

beforeEach(() => {
    Object.keys(mockDocuments).forEach(key => delete mockDocuments[key])
    mockRefs.clear()
    mockDoc.mockClear()
    global.fetch = jest.fn()
})

describe('VM merge request association', () => {
    test('extracts a GitLab MR only for the connected repository', () => {
        const context = {
            enabled: true,
            provider: 'gitlab',
            repoUrl: 'https://gitlab.example.com/group/sub/repo.git',
        }

        expect(
            extractMergeRequestReference(
                'Docs: https://gitlab.example.com/other/repo/-/merge_requests/1\nMR: [!42](https://gitlab.example.com/group/sub/repo/-/merge_requests/42).',
                context
            )
        ).toEqual({
            provider: 'gitlab',
            url: 'https://gitlab.example.com/group/sub/repo/-/merge_requests/42',
            number: 42,
            repo: 'group/sub/repo',
        })
    })

    test('extracts a GitHub PR and ignores issue or foreign-repo links', () => {
        const context = {
            enabled: true,
            provider: 'github',
            repoUrl: 'https://github.com/alldone/app',
        }

        expect(
            extractMergeRequestReference(
                'Issue https://github.com/alldone/app/issues/8; foreign https://github.com/other/app/pull/3; PR https://github.com/alldone/app/pull/17',
                context
            )
        ).toEqual({
            provider: 'github',
            url: 'https://github.com/alldone/app/pull/17',
            number: 17,
            repo: 'alldone/app',
        })
    })

    test('selects the newest matching MR when the VM result mentions multiple MRs', () => {
        const context = {
            enabled: true,
            provider: 'gitlab',
            repoUrl: 'https://gitlab.example.com/group/repo',
        }

        expect(
            extractMergeRequestReference(
                'Previous MR: https://gitlab.example.com/group/repo/-/merge_requests/9\nNew MR: https://gitlab.example.com/group/repo/-/merge_requests/12\nRepeated old MR: https://gitlab.example.com/group/repo/-/merge_requests/9',
                context
            )
        ).toEqual({
            provider: 'gitlab',
            url: 'https://gitlab.example.com/group/repo/-/merge_requests/12',
            number: 12,
            repo: 'group/repo',
        })
    })

    test('returns null when the VM did not create an MR/PR', () => {
        expect(
            extractMergeRequestReference('No repository files changed, so no MR was opened.', {
                enabled: true,
                provider: 'gitlab',
                repoUrl: 'https://gitlab.com/alldone/app',
            })
        ).toBeNull()
    })

    test('uses job creation time across a recreated thread sequence counter', () => {
        expect(
            shouldReplaceTaskReference(
                { sourceVmJobId: 'old', sourceVmJobOrder: 8, sourceVmJobCreatedAt: 1000, url: 'old' },
                { sourceVmJobId: 'new', sourceVmJobOrder: 1, sourceVmJobCreatedAt: 2000, url: 'new' }
            )
        ).toBe(true)
        expect(
            shouldReplaceTaskReference(
                { sourceVmJobId: 'new', sourceVmJobOrder: 1, sourceVmJobCreatedAt: 2000, url: 'new' },
                { sourceVmJobId: 'old', sourceVmJobOrder: 8, sourceVmJobCreatedAt: 1000, url: 'old' }
            )
        ).toBe(false)
        expect(
            shouldReplaceTaskReference(
                { sourceVmJobId: 'old', sourceVmJobOrder: 1, sourceVmJobCreatedAt: 3000, url: 'old' },
                { sourceVmJobId: 'new', sourceVmJobOrder: 2, sourceVmJobCreatedAt: 3000, url: 'new' }
            )
        ).toBe(true)
    })

    test('persists the extracted URL and initial provider status on the task and VM job', async () => {
        mockDocuments['users/user-1/private/gitlabAuth_project-1'] = {
            token: 'secret',
            host: 'https://gitlab.example.com',
        }
        global.fetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    state: 'opened',
                    detailed_merge_status: 'can_be_merged',
                    head_pipeline: { status: 'success' },
                }),
            })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ approvals_left: 0 }) })

        const result = await associateVmMergeRequestWithTask({
            vmJob: {
                correlationId: 'job-1',
                threadRunOrder: 3,
                createdAt: 1000,
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                requestUserId: 'user-1',
            },
            gitContext: {
                enabled: true,
                provider: 'gitlab',
                repoUrl: 'https://gitlab.example.com/group/repo',
            },
            output: 'Merge Request: https://gitlab.example.com/group/repo/-/merge_requests/9',
        })

        expect(result).toEqual(
            expect.objectContaining({
                status: MERGE_STATUS.READY_TO_MERGE,
                number: 9,
                sourceVmJobOrder: 3,
                sourceVmJobCreatedAt: 1000,
            })
        )
        expect(mockDocuments['items/project-1/tasks/task-1'].vmMergeRequest).toEqual(result)
        expect(mockDocuments['vmJobs/job-1'].mergeRequest).toEqual(result)
        expect(global.fetch).toHaveBeenCalledWith(
            'https://gitlab.example.com/api/v4/projects/group%2Frepo/merge_requests/9?with_merge_status_recheck=true',
            expect.objectContaining({ headers: { 'PRIVATE-TOKEN': 'secret' } })
        )
    })

    test('keeps the newest VM result canonical when an older provider lookup finishes later', async () => {
        mockDocuments['users/user-1/private/gitlabAuth_project-1'] = {
            token: 'secret',
            host: 'https://gitlab.example.com',
        }
        const delayedResponses = []
        global.fetch.mockImplementation(url => {
            if (url.includes('/merge_requests/9')) {
                return new Promise(resolve =>
                    delayedResponses.push(() => resolve({ ok: true, json: async () => ({}) }))
                )
            }
            return Promise.resolve({
                ok: true,
                json: async () =>
                    url.endsWith('/approvals')
                        ? { approvals_left: 0 }
                        : { state: 'opened', detailed_merge_status: 'can_be_merged' },
            })
        })

        const gitContext = {
            enabled: true,
            provider: 'gitlab',
            repoUrl: 'https://gitlab.example.com/group/repo',
        }
        const older = associateVmMergeRequestWithTask({
            vmJob: {
                correlationId: 'job-old',
                threadRunOrder: 1,
                createdAt: 1000,
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                requestUserId: 'user-1',
            },
            gitContext,
            output: 'MR: https://gitlab.example.com/group/repo/-/merge_requests/9',
        })
        await Promise.resolve()
        await associateVmMergeRequestWithTask({
            vmJob: {
                correlationId: 'job-new',
                threadRunOrder: 2,
                createdAt: 2000,
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                requestUserId: 'user-1',
            },
            gitContext,
            output: 'MR: https://gitlab.example.com/group/repo/-/merge_requests/10',
        })
        delayedResponses.forEach(resolve => resolve())
        await older

        expect(mockDocuments['items/project-1/tasks/task-1'].vmMergeRequest).toMatchObject({
            number: 10,
            sourceVmJobId: 'job-new',
            sourceVmJobOrder: 2,
        })
        expect(mockDocuments['vmJobs/job-old'].mergeRequest.number).toBe(9)
        expect(mockDocuments['vmJobs/job-new'].mergeRequest.number).toBe(10)
    })

    test('allows an ordered VM result to replace legacy task metadata without ordering fields', async () => {
        mockDocuments['items/project-1/tasks/task-1'] = {
            vmMergeRequest: {
                provider: 'gitlab',
                url: 'https://gitlab.example.com/group/repo/-/merge_requests/4',
                repo: 'group/repo',
                number: 4,
                status: MERGE_STATUS.MERGED,
            },
        }
        mockDocuments['users/user-1/private/gitlabAuth_project-1'] = { token: 'secret' }
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ state: 'opened' }) })

        await associateVmMergeRequestWithTask({
            vmJob: {
                correlationId: 'job-new',
                threadRunOrder: 7,
                createdAt: 7000,
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                requestUserId: 'user-1',
            },
            gitContext: {
                enabled: true,
                provider: 'gitlab',
                repoUrl: 'https://gitlab.example.com/group/repo',
            },
            output: 'MR: https://gitlab.example.com/group/repo/-/merge_requests/11',
        })

        expect(mockDocuments['items/project-1/tasks/task-1'].vmMergeRequest).toMatchObject({
            number: 11,
            sourceVmJobOrder: 7,
        })
    })

    test('returns a fresh cached task status without calling the provider', async () => {
        const mergeRequest = {
            provider: 'github',
            url: 'https://github.com/alldone/app/pull/4',
            repo: 'alldone/app',
            number: 4,
            status: MERGE_STATUS.CHECKS_RUNNING,
            statusUpdatedAt: Date.now(),
        }
        mockDocuments['items/project-1/tasks/task-1'] = { vmMergeRequest: mergeRequest }

        await expect(
            refreshTaskMergeStatus({ userId: 'user-1', projectId: 'project-1', taskId: 'task-1' })
        ).resolves.toEqual({ mergeRequest, cached: true })
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('refuses to refresh a task URL outside the connected project repository', async () => {
        mockDocuments['items/project-1/tasks/task-1'] = {
            vmMergeRequest: {
                provider: 'github',
                url: 'https://github.com/other/private-repo/pull/4',
                repo: 'other/private-repo',
                number: 4,
                status: MERGE_STATUS.CHECKS_RUNNING,
                statusUpdatedAt: 1,
            },
        }
        mockDocuments['projects/project-1'] = { githubRepoUrl: 'https://github.com/alldone/app' }

        await expect(
            refreshTaskMergeStatus({ userId: 'user-1', projectId: 'project-1', taskId: 'task-1' })
        ).rejects.toMatchObject({ code: 'failed-precondition' })
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('does not let a delayed status refresh restore a superseded MR', async () => {
        const oldReference = {
            provider: 'github',
            url: 'https://github.com/alldone/app/pull/4',
            repo: 'alldone/app',
            number: 4,
            sourceVmJobId: 'job-old',
            sourceVmJobOrder: 1,
            status: MERGE_STATUS.CHECKS_RUNNING,
            statusUpdatedAt: 1,
        }
        const newReference = {
            ...oldReference,
            url: 'https://github.com/alldone/app/pull/5',
            number: 5,
            sourceVmJobId: 'job-new',
            sourceVmJobOrder: 2,
        }
        mockDocuments['items/project-1/tasks/task-1'] = { vmMergeRequest: oldReference }
        mockDocuments['projects/project-1'] = { githubRepoUrl: 'https://github.com/alldone/app' }
        mockDocuments['users/user-1/private/githubAuth_project-1'] = { token: 'secret' }

        let releaseProvider
        let signalProviderRequested
        const providerRequested = new Promise(resolve => {
            signalProviderRequested = resolve
        })
        const providerResponse = new Promise(resolve => {
            releaseProvider = () =>
                resolve({
                    ok: true,
                    json: async () => ({ state: 'open', mergeable: true, mergeable_state: 'clean' }),
                })
        })
        global.fetch.mockImplementation(() => {
            signalProviderRequested()
            return providerResponse
        })
        const refresh = refreshTaskMergeStatus({
            userId: 'user-1',
            projectId: 'project-1',
            taskId: 'task-1',
            force: true,
        })
        await providerRequested
        mockDocuments['items/project-1/tasks/task-1'].vmMergeRequest = newReference
        releaseProvider()

        await expect(refresh).resolves.toEqual({ mergeRequest: newReference, cached: false, superseded: true })
        expect(mockDocuments['items/project-1/tasks/task-1'].vmMergeRequest).toBe(newReference)
    })
})

describe('GitLab merge status normalization', () => {
    test.each([
        [{ state: 'merged', draft: true, has_conflicts: true }, null, MERGE_STATUS.MERGED],
        [{ state: 'closed', draft: true }, null, MERGE_STATUS.CLOSED],
        [{ state: 'opened', draft: true }, null, MERGE_STATUS.DRAFT],
        [{ state: 'opened', has_conflicts: true, head_pipeline: { status: 'running' } }, null, MERGE_STATUS.BLOCKED],
        [{ state: 'opened', head_pipeline: { status: 'failed' } }, null, MERGE_STATUS.BLOCKED],
        [{ state: 'opened', head_pipeline: { status: 'running' } }, { approvals_left: 1 }, MERGE_STATUS.CHECKS_RUNNING],
        [
            { state: 'opened', detailed_merge_status: 'not_approved' },
            { approvals_left: 1 },
            MERGE_STATUS.NEEDS_APPROVAL,
        ],
        [
            { state: 'opened', detailed_merge_status: 'can_be_merged' },
            { approvals_left: 0 },
            MERGE_STATUS.READY_TO_MERGE,
        ],
    ])('normalizes %j with the shared precedence', (mergeRequest, approvals, expected) => {
        expect(normalizeGitlabMergeStatus(mergeRequest, approvals).status).toBe(expected)
    })
})

describe('GitHub merge status normalization', () => {
    const completedCheck = conclusion => ({ status: 'completed', conclusion })

    test.each([
        [{ state: 'closed', merged: true, draft: true }, {}, {}, [], MERGE_STATUS.MERGED],
        [{ state: 'closed', draft: true }, {}, {}, [], MERGE_STATUS.CLOSED],
        [{ state: 'open', draft: true }, {}, {}, [], MERGE_STATUS.DRAFT],
        [
            { state: 'open', mergeable: false, mergeable_state: 'dirty' },
            { check_runs: [{ status: 'in_progress' }] },
            {},
            [],
            MERGE_STATUS.BLOCKED,
        ],
        [
            { state: 'open', mergeable: true, mergeable_state: 'blocked' },
            { check_runs: [completedCheck('failure')] },
            {},
            [],
            MERGE_STATUS.BLOCKED,
        ],
        [
            { state: 'open', mergeable: true, mergeable_state: 'blocked', requested_reviewers: [{}] },
            { check_runs: [{ status: 'in_progress' }] },
            {},
            [],
            MERGE_STATUS.CHECKS_RUNNING,
        ],
        [
            { state: 'open', mergeable: true, mergeable_state: 'blocked', requested_reviewers: [{}] },
            { check_runs: [completedCheck('success')] },
            { state: 'success' },
            [],
            MERGE_STATUS.NEEDS_APPROVAL,
        ],
        [
            { state: 'open', mergeable: true, mergeable_state: 'clean' },
            { check_runs: [completedCheck('success')] },
            { state: 'success' },
            [{ user: { login: 'reviewer' }, state: 'APPROVED' }],
            MERGE_STATUS.READY_TO_MERGE,
        ],
    ])('normalizes provider details with the shared precedence', (pr, checks, status, reviews, expected) => {
        expect(normalizeGithubMergeStatus(pr, checks, status, reviews).status).toBe(expected)
    })

    test('treats a latest changes-requested review as blocked', () => {
        const result = normalizeGithubMergeStatus(
            { state: 'open', mergeable: true, mergeable_state: 'blocked' },
            { check_runs: [completedCheck('success')] },
            { state: 'success' },
            [
                { user: { login: 'reviewer' }, state: 'APPROVED' },
                { user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED' },
            ]
        )
        expect(result.status).toBe(MERGE_STATUS.BLOCKED)
    })
})
