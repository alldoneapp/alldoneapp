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
    firestore: jest.fn(() => ({ doc: mockDoc })),
}))

const {
    MERGE_STATUS,
    extractMergeRequestReference,
    normalizeGitlabMergeStatus,
    normalizeGithubMergeStatus,
    refreshTaskMergeStatus,
    associateVmMergeRequestWithTask,
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

    test('returns null when the VM did not create an MR/PR', () => {
        expect(
            extractMergeRequestReference('No repository files changed, so no MR was opened.', {
                enabled: true,
                provider: 'gitlab',
                repoUrl: 'https://gitlab.com/alldone/app',
            })
        ).toBeNull()
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

        expect(result).toEqual(expect.objectContaining({ status: MERGE_STATUS.READY_TO_MERGE, number: 9 }))
        expect(mockDocuments['items/project-1/tasks/task-1'].vmMergeRequest).toEqual(result)
        expect(mockDocuments['vmJobs/job-1'].mergeRequest).toEqual(result)
        expect(global.fetch).toHaveBeenCalledWith(
            'https://gitlab.example.com/api/v4/projects/group%2Frepo/merge_requests/9?with_merge_status_recheck=true',
            expect.objectContaining({ headers: { 'PRIVATE-TOKEN': 'secret' } })
        )
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
