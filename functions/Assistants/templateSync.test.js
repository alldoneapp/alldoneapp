jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))
jest.mock(
    'firebase-admin/firestore',
    () => ({
        FieldValue: { delete: jest.fn(() => '__DELETE__') },
    }),
    { virtual: true }
)

const admin = require('firebase-admin')
const {
    syncDerivedAssistant,
    syncDerivedTask,
    backfillDerivedAssistant,
    backfillDerivedTask,
    runTemplateSyncBackfill,
    buildSyncActivityText,
} = require('./templateSync')

/**
 * Records every write so a test can assert on what the sync ANNOUNCED, not only on
 * what it wrote to the assistant doc. The silent-review bug (AT-2358) was invisible
 * in the assistant doc — it was correct there — and only observable as a missing
 * feed.
 */
function buildDb() {
    const feedWrites = []
    const batch = {
        set: jest.fn((ref, data) => feedWrites.push({ path: ref.path, data })),
        commit: jest.fn(async () => {}),
    }
    const db = {
        collection: jest.fn(() => ({ doc: jest.fn(() => ({ id: 'feed-1' })) })),
        doc: jest.fn(path => ({ path })),
        batch: jest.fn(() => batch),
    }
    admin.firestore.mockReturnValue(db)
    return { feedWrites }
}

function buildDerivedDoc(localAssistant) {
    const updates = []
    return {
        updates,
        doc: {
            ref: {
                path: 'assistants/project-1/items/assistant-1',
                update: jest.fn(async patch => updates.push(patch)),
            },
            data: () => localAssistant,
        },
    }
}

function buildDerivedTask(localTask = null) {
    const updates = []
    const createdTasks = []
    const localTaskDoc = {
        id: 'local-task-1',
        data: () => localTask,
        ref: {
            update: jest.fn(async patch => updates.push(patch)),
            delete: jest.fn(async () => {}),
        },
    }
    const batch = {
        set: jest.fn(),
        commit: jest.fn(async () => {}),
    }
    const db = {
        collection: jest.fn(path => {
            if (path === 'assistantTasks/project-1/assistant-1') {
                return {
                    get: jest.fn(async () => ({ docs: localTask ? [localTaskDoc] : [] })),
                    doc: jest.fn(() => ({ set: jest.fn(async task => createdTasks.push(task)) })),
                }
            }
            return { doc: jest.fn(() => ({ id: 'feed-1' })) }
        }),
        doc: jest.fn(path => ({ path })),
        batch: jest.fn(() => batch),
    }
    admin.firestore.mockReturnValue(db)

    return {
        updates,
        createdTasks,
        assistantDoc: {
            ref: { path: 'assistants/project-1/items/assistant-1' },
            data: () => ({ displayName: 'Anna Alldone', creatorId: 'creator-1' }),
        },
    }
}

const TEMPLATE_BASE = {
    uid: 'template-1',
    displayName: 'Anna Alldone',
    temperature: 0.7,
    lastEditionDate: 1000,
}

describe('template sync activity feed (AT-2358)', () => {
    beforeEach(() => jest.clearAllMocks())

    // One logical sync activity fans out to both the object's inner feed and the
    // project-wide feed store, so count the inner-feed write to mean "one event".
    const syncFeeds = feedWrites =>
        feedWrites.filter(
            write =>
                write.data &&
                write.data.type === 'FEED_ASSISTANT_TEMPLATE_SYNCED' &&
                write.path.startsWith('projectsInnerFeeds/')
        )

    const feedStoreWrites = feedWrites => feedWrites.filter(write => write.path && write.path.startsWith('feedsStore/'))

    it('announces a sync that applied nothing because every change conflicted', async () => {
        const { feedWrites } = buildDb()
        // Local instructions diverge from the snapshot, so the template's new
        // instructions cannot be applied -> conflict, empty patch.
        const { doc, updates } = buildDerivedDoc({
            ...TEMPLATE_BASE,
            instructions: 'locally edited instructions',
            templateSyncSnapshot: { displayName: 'Anna Alldone', temperature: 0.7, instructions: 'old template' },
            copiedFromTemplateAssistantId: 'template-1',
        })

        await syncDerivedAssistant(
            doc,
            { ...TEMPLATE_BASE, instructions: 'old template' },
            { ...TEMPLATE_BASE, instructions: 'new template instructions' }
        )

        expect(updates[0].templateSyncStatus).toBe('needs_review')
        expect(updates[0].templateSyncConflicts).toHaveLength(1)

        const feeds = syncFeeds(feedWrites)
        expect(feeds).toHaveLength(1)
        expect(feeds[0].data.entryText).toContain('1 template change waiting for review')
        expect(feedStoreWrites(feedWrites)).toHaveLength(1)
        // The old wording would have claimed a successful sync of nothing.
        expect(feeds[0].data.entryText).not.toContain('synced 0')
    })

    it('stays silent when a template edit changes nothing for the derived assistant', async () => {
        const { feedWrites } = buildDb()
        const snapshot = { displayName: 'Anna Alldone', temperature: 0.7 }
        const { doc } = buildDerivedDoc({
            ...TEMPLATE_BASE,
            templateSyncSnapshot: snapshot,
            copiedFromTemplateAssistantId: 'template-1',
        })

        // Only lastEditionDate moved, which is a local field and never part of
        // template state.
        await syncDerivedAssistant(doc, TEMPLATE_BASE, { ...TEMPLATE_BASE, lastEditionDate: 2000 })

        expect(syncFeeds(feedWrites)).toHaveLength(0)
    })

    it('still announces a clean sync that applied changes', async () => {
        const { feedWrites } = buildDb()
        const { doc, updates } = buildDerivedDoc({
            ...TEMPLATE_BASE,
            templateSyncSnapshot: { displayName: 'Anna Alldone', temperature: 0.7 },
            copiedFromTemplateAssistantId: 'template-1',
        })

        await syncDerivedAssistant(doc, TEMPLATE_BASE, { ...TEMPLATE_BASE, temperature: 0.2 })

        expect(updates[0].temperature).toBe(0.2)
        expect(updates[0].templateSyncStatus).toBe('synced')
        const feeds = syncFeeds(feedWrites)
        expect(feeds).toHaveLength(1)
        expect(feeds[0].data.entryText).toContain('automatically synced 1 assistant setting')
        expect(feeds[0].data.entryText).not.toContain('need review')
        // The project-wide feed store must receive it too, or the activity is only
        // visible from inside the assistant — the very thing AT-2358 is about.
        expect(feedStoreWrites(feedWrites)).toHaveLength(1)
    })

    it('does not delete a project-local workflow stored in an older snapshot', async () => {
        buildDb()
        const { doc, updates } = buildDerivedDoc({
            ...TEMPLATE_BASE,
            workflow: [{ id: 'local-step' }],
            templateSyncSnapshot: {
                displayName: 'Anna Alldone',
                temperature: 0.7,
                workflow: [{ id: 'local-step' }],
            },
            copiedFromTemplateAssistantId: 'template-1',
        })

        await syncDerivedAssistant(doc, TEMPLATE_BASE, { ...TEMPLATE_BASE, temperature: 0.2 })

        expect(updates[0]).not.toHaveProperty('workflow')
        expect(updates[0].templateSyncSnapshot).not.toHaveProperty('workflow')
    })
})

describe('buildSyncActivityText', () => {
    it('describes a review-only sync without claiming a successful sync', () => {
        // Rendered as "{assistant name} has 1 template change waiting for review …"
        expect(buildSyncActivityText(0, 1, 'assistant setting')).toBe(
            'has 1 template change waiting for review — open the assistant to choose which version to keep'
        )
    })

    it('pluralises reviews', () => {
        expect(buildSyncActivityText(0, 3, 'assistant setting')).toContain('3 template changes waiting for review')
        expect(buildSyncActivityText(3, 3, 'assistant setting')).toContain('3 template changes need review')
    })

    it('combines applied changes with pending reviews', () => {
        const text = buildSyncActivityText(2, 1, 'assistant setting')
        expect(text).toContain('automatically synced 2 assistant settings from the template')
        expect(text).toContain('1 template change needs review')
    })

    it('omits the review clause when nothing conflicts', () => {
        expect(buildSyncActivityText(1, 0, 'template task setting')).toBe(
            'automatically synced 1 template task setting from the template'
        )
    })
})

describe('template task recurrence sync', () => {
    beforeEach(() => jest.clearAllMocks())

    const previousTask = {
        id: 'template-task-1',
        assistantId: 'template-1',
        name: 'User Description Update',
        prompt: 'Update the user description',
        recurrence: 'weekly',
    }
    const currentTask = { ...previousTask, recurrence: 'daily' }

    it('updates inherited per-user cadences when the template cadence changes', async () => {
        const { assistantDoc, updates } = buildDerivedTask({
            ...previousTask,
            assistantId: 'assistant-1',
            copiedFromTemplateTaskId: previousTask.id,
            templateTaskSnapshot: previousTask,
            templateTaskSyncConflicts: [],
            recurrenceByUser: {
                'inherited-user': 'weekly',
                'custom-user': 'monthly',
            },
        })

        await syncDerivedTask(assistantDoc, previousTask, currentTask, 'update')

        expect(updates[0]).toMatchObject({
            recurrence: 'daily',
            'recurrenceByUser.inherited-user': 'daily',
            templateSyncStatus: 'synced',
        })
        expect(updates[0]['recurrenceByUser.custom-user']).toBeUndefined()
    })

    it('preserves every per-user cadence when the task-level cadence was customized locally', async () => {
        const { assistantDoc, updates } = buildDerivedTask({
            ...previousTask,
            assistantId: 'assistant-1',
            recurrence: 'monthly',
            copiedFromTemplateTaskId: previousTask.id,
            templateTaskSnapshot: previousTask,
            templateTaskSyncConflicts: [],
            recurrenceByUser: {
                'inherited-user': 'weekly',
                'custom-user': 'monthly',
            },
        })

        await syncDerivedTask(assistantDoc, previousTask, currentTask, 'update')

        expect(updates[0]).not.toHaveProperty('recurrence')
        expect(updates[0]).not.toHaveProperty('recurrenceByUser')
        expect(updates[0].templateSyncStatus).toBe('needs_review')
        expect(updates[0].templateTaskSyncConflicts).toEqual([
            expect.objectContaining({ field: 'recurrence', localValue: 'monthly', templateValue: 'daily' }),
        ])
    })

    it('propagates inherited schedule changes and reports customized times for review', async () => {
        const scheduledPreviousTask = {
            ...previousTask,
            startDate: '2026-08-28',
            startTime: 8,
            userTimezone: 'Europe/Berlin',
        }
        const scheduledCurrentTask = { ...scheduledPreviousTask, startTime: 9 }
        const inherited = buildDerivedTask({
            ...scheduledPreviousTask,
            assistantId: 'assistant-1',
            copiedFromTemplateTaskId: previousTask.id,
            templateTaskSnapshot: scheduledPreviousTask,
        })

        await syncDerivedTask(inherited.assistantDoc, scheduledPreviousTask, scheduledCurrentTask, 'update')

        expect(inherited.updates[0]).toMatchObject({ startTime: 9, templateSyncStatus: 'synced' })

        const customized = buildDerivedTask({
            ...scheduledPreviousTask,
            startTime: 12,
            assistantId: 'assistant-1',
            copiedFromTemplateTaskId: previousTask.id,
            templateTaskSnapshot: scheduledPreviousTask,
        })

        await syncDerivedTask(customized.assistantDoc, scheduledPreviousTask, scheduledCurrentTask, 'update')

        expect(customized.updates[0]).not.toHaveProperty('startTime')
        expect(customized.updates[0].templateSyncStatus).toBe('needs_review')
        expect(customized.updates[0].templateTaskSyncConflicts).toEqual([
            expect.objectContaining({ field: 'startTime', localValue: 12, templateValue: 9 }),
        ])
    })

    it('copies a newly added recurring template task with its complete schedule', async () => {
        const { assistantDoc, createdTasks } = buildDerivedTask()
        const scheduledTask = {
            ...currentTask,
            startDate: '2026-08-28',
            startTime: 9,
            userTimezone: 'Europe/Berlin',
            executionStatus: 'succeeded',
            lastGeneratedTaskId: 'template-runtime-task',
        }

        await syncDerivedTask(assistantDoc, null, scheduledTask, 'create')

        expect(createdTasks).toHaveLength(1)
        expect(createdTasks[0]).toMatchObject({
            recurrence: 'daily',
            startDate: '2026-08-28',
            startTime: 9,
            userTimezone: 'Europe/Berlin',
            templateTaskSnapshot: expect.objectContaining({
                startDate: '2026-08-28',
                startTime: 9,
                userTimezone: 'Europe/Berlin',
            }),
        })
        expect(createdTasks[0]).not.toHaveProperty('executionStatus')
        expect(createdTasks[0]).not.toHaveProperty('lastGeneratedTaskId')
        expect(createdTasks[0].templateTaskSnapshot).not.toHaveProperty('executionStatus')
    })

    it('never deletes local runtime state found in an older task snapshot', async () => {
        const runtimePreviousTask = {
            ...previousTask,
            executionStatus: 'in_progress',
            lastGeneratedTaskId: 'generated-task-1',
        }
        const { assistantDoc, updates } = buildDerivedTask({
            ...runtimePreviousTask,
            assistantId: 'assistant-1',
            copiedFromTemplateTaskId: previousTask.id,
            templateTaskSnapshot: runtimePreviousTask,
        })

        await syncDerivedTask(
            assistantDoc,
            runtimePreviousTask,
            { ...runtimePreviousTask, prompt: 'Updated prompt' },
            'update'
        )

        expect(updates[0].prompt).toBe('Updated prompt')
        expect(updates[0]).not.toHaveProperty('executionStatus')
        expect(updates[0]).not.toHaveProperty('lastGeneratedTaskId')
        expect(updates[0].templateTaskSnapshot).not.toHaveProperty('executionStatus')
    })
})

describe('template task backfill', () => {
    beforeEach(() => jest.clearAllMocks())

    it('repairs schedule fields omitted by version-one snapshots', async () => {
        const updates = []
        const taskDoc = {
            id: 'local-task-1',
            data: () => ({
                name: 'Daily focus',
                recurrence: 'daily',
                copiedFromTemplateTaskId: 'template-task-1',
                templateTaskSnapshot: { name: 'Daily focus', recurrence: 'daily' },
            }),
            ref: { update: jest.fn(async patch => updates.push(patch)), delete: jest.fn() },
        }

        await backfillDerivedTask(
            taskDoc,
            {
                id: 'template-task-1',
                name: 'Daily focus',
                recurrence: 'daily',
                startDate: '2026-08-28',
                startTime: 8,
                userTimezone: 'Europe/Berlin',
            },
            2000
        )

        expect(updates[0]).toMatchObject({
            startDate: '2026-08-28',
            startTime: 8,
            userTimezone: 'Europe/Berlin',
            templateSyncStatus: 'synced',
        })
    })

    it('repairs the missed Anna weekly-to-daily per-user transition only for inherited values', async () => {
        const updates = []
        const taskDoc = {
            id: 'local-task-1',
            data: () => ({
                name: 'User Description Update',
                recurrence: 'daily',
                recurrenceByUser: {
                    'inherited-user': 'weekly',
                    'custom-user': 'monthly',
                },
                copiedFromTemplateTaskId: '-OrS7UiOYnkrIf_PksMz',
                templateTaskSnapshot: { name: 'User Description Update', recurrence: 'daily' },
            }),
            ref: { update: jest.fn(async patch => updates.push(patch)), delete: jest.fn() },
        }

        await backfillDerivedTask(
            taskDoc,
            {
                id: '-OrS7UiOYnkrIf_PksMz',
                assistantId: '-Ns4cpvpLDeygvV2cjcJ',
                name: 'User Description Update',
                recurrence: 'daily',
            },
            2000
        )

        expect(updates[0]['recurrenceByUser.inherited-user']).toBe('daily')
        expect(updates[0]['recurrenceByUser.custom-user']).toBeUndefined()
    })

    it('surfaces a legacy copied task whose source no longer exists', async () => {
        const update = jest.fn(async () => {})
        const taskDoc = {
            id: 'orphan-task',
            data: () => ({
                name: 'Legacy task',
                copiedFromTemplateTaskId: 'deleted-template-task',
            }),
            ref: { update, delete: jest.fn() },
        }

        await backfillDerivedTask(taskDoc, undefined, 2000)

        expect(update).toHaveBeenCalledWith({
            templateSyncStatus: 'template_missing_local_preserved',
            templateTaskDeletedAt: 2000,
            copiedFromTemplateTaskDate: 2000,
        })
    })

    it('still checks tasks when the assistant already has a sync snapshot', async () => {
        const assistantUpdate = jest.fn(async () => {})
        const taskUpdate = jest.fn(async () => {})
        const taskDoc = {
            id: 'orphan-task',
            data: () => ({ name: 'Legacy task', copiedFromTemplateTaskId: 'deleted-template-task' }),
            ref: { update: taskUpdate, delete: jest.fn() },
        }
        const db = {
            collection: jest.fn(path => {
                if (path === 'assistantTasks/globalProject/preConfigTasks') {
                    return { where: jest.fn(() => ({ get: jest.fn(async () => ({ docs: [] })) })) }
                }
                if (path === 'assistantTasks/project-1/assistant-1') {
                    return { get: jest.fn(async () => ({ docs: [taskDoc] })) }
                }
                throw new Error(`Unexpected collection: ${path}`)
            }),
        }
        admin.firestore.mockReturnValue(db)
        const assistantDoc = {
            ref: {
                path: 'assistants/project-1/items/assistant-1',
                update: assistantUpdate,
            },
            data: () => ({
                displayName: 'Anna Alldone',
                copiedFromTemplateAssistantId: 'template-1',
                templateSyncSnapshot: { displayName: 'Anna Alldone' },
            }),
        }

        await backfillDerivedAssistant(assistantDoc, {
            uid: 'template-1',
            displayName: 'Anna Alldone',
        })

        expect(assistantUpdate).toHaveBeenCalled()
        expect(taskUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ templateSyncStatus: 'template_missing_local_preserved' })
        )
    })
})

describe('template sync backfill versioning', () => {
    beforeEach(() => jest.clearAllMocks())

    it('reruns a completed version-one marker and records version two', async () => {
        const markerSet = jest.fn(async () => {})
        const db = {
            doc: jest.fn(() => ({
                get: jest.fn(async () => ({ exists: true, data: () => ({ completed: true }) })),
                set: markerSet,
            })),
            collection: jest.fn(() => ({ get: jest.fn(async () => ({ docs: [] })) })),
        }
        admin.firestore.mockReturnValue(db)

        await expect(runTemplateSyncBackfill()).resolves.toEqual({
            alreadyCompleted: false,
            assistants: 0,
            tasks: 0,
            version: 2,
        })
        expect(markerSet).toHaveBeenCalledWith(expect.objectContaining({ completed: true, version: 2 }))
    })

    it('does not repeat a completed version-two backfill', async () => {
        const markerSet = jest.fn(async () => {})
        const db = {
            doc: jest.fn(() => ({
                get: jest.fn(async () => ({ exists: true, data: () => ({ completed: true, version: 2 }) })),
                set: markerSet,
            })),
        }
        admin.firestore.mockReturnValue(db)

        await expect(runTemplateSyncBackfill()).resolves.toEqual({
            alreadyCompleted: true,
            assistants: 0,
            tasks: 0,
            version: 2,
        })
        expect(markerSet).not.toHaveBeenCalled()
    })
})
