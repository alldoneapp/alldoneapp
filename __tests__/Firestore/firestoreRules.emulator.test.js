/**
 * @jest-environment node
 */

const fs = require('fs')
const path = require('path')
const { assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing')
const {
    FieldPath,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    setDoc,
    updateDoc,
    writeBatch,
    where,
} = require('firebase/firestore')

const PROJECT_ID = 'project-a'
const OTHER_PROJECT_ID = 'project-b'
const MOVE_TARGET_PROJECT_ID = 'project-c'
const SHARED_PROJECT_ID = 'shared-project'
const MEMBER_ID = 'member'
const OUTSIDER_ID = 'outsider'
const TEAMMATE_ID = 'teammate'
const BACKLINK_FIELD = 'linkedParentTasksIds'
const BACKLINK_OBJECT_ID = 'source-task'
const BACKLINK_TOKEN = JSON.stringify([BACKLINK_FIELD, BACKLINK_OBJECT_ID])
const INNER_TASK_NOTE_ID = 'note-with-inner-task'
const INNER_TASK_NOTE_TOKEN = JSON.stringify(['containerNotesIds', INNER_TASK_NOTE_ID])

// The first rules-unit-testing handshake can exceed Jest's 5 s default while a cold CI runner
// downloads and boots the Firestore emulator. Local runs are warm enough not to expose it.
jest.setTimeout(30000)

let testEnv

const seed = async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
        const db = context.firestore()

        await setDoc(doc(db, `users/${MEMBER_ID}`), {
            projectIds: [PROJECT_ID],
            guideProjectIds: [],
            templateProjectIds: [],
            archivedProjectIds: [],
            // This is the actual new-user shape. Membership rules must not call map.diff() on
            // this unchanged nullable field while atomically adding another project.
            apisConnected: null,
        })
        await setDoc(doc(db, `users/${OUTSIDER_ID}`), {
            projectIds: [],
            guideProjectIds: [],
            templateProjectIds: [],
            archivedProjectIds: [],
        })
        await setDoc(doc(db, `users/${TEAMMATE_ID}`), {
            projectIds: [PROJECT_ID],
            guideProjectIds: [],
            templateProjectIds: [],
            archivedProjectIds: [],
            workflow: {},
        })
        await setDoc(doc(db, `projects/${PROJECT_ID}`), {
            creatorId: MEMBER_ID,
            isShared: 2,
            userIds: [MEMBER_ID, TEAMMATE_ID],
        })
        await setDoc(doc(db, `projects/${OTHER_PROJECT_ID}`), {
            creatorId: 'other-owner',
            isShared: 2,
            userIds: ['other-owner'],
        })
        await setDoc(doc(db, `projects/${MOVE_TARGET_PROJECT_ID}`), {
            creatorId: MEMBER_ID,
            isShared: 2,
            userIds: [MEMBER_ID, TEAMMATE_ID],
        })
        await setDoc(doc(db, `projects/${SHARED_PROJECT_ID}`), {
            creatorId: MEMBER_ID,
            isShared: 1,
            userIds: [MEMBER_ID],
        })
        await setDoc(doc(db, 'roles/administrator'), { userId: 'admin' })
        await setDoc(doc(db, `items/${PROJECT_ID}/tasks/public-task`), {
            projectId: PROJECT_ID,
            isPublicFor: [0],
            observersIds: [MEMBER_ID],
            parentId: null,
            linkedParentTasksIds: [BACKLINK_OBJECT_ID],
            containerNotesIds: [INNER_TASK_NOTE_ID],
            readerIds: [MEMBER_ID],
            roleIdsVisibleTo: { [MEMBER_ID]: [MEMBER_ID] },
            backlinkIdsVisibleTo: { [MEMBER_ID]: [BACKLINK_TOKEN, INNER_TASK_NOTE_TOKEN] },
        })
        await setDoc(doc(db, `items/${PROJECT_ID}/tasks/private-task`), {
            projectId: PROJECT_ID,
            isPublicFor: [MEMBER_ID],
            observersIds: [MEMBER_ID],
            parentId: null,
            dueDate: 253402214400000,
            done: false,
            inDone: false,
            currentReviewerId: MEMBER_ID,
            linkedParentTasksIds: [BACKLINK_OBJECT_ID],
            readerIds: [MEMBER_ID],
            roleIdsVisibleTo: { [MEMBER_ID]: [MEMBER_ID] },
            backlinkIdsVisibleTo: { [MEMBER_ID]: [BACKLINK_TOKEN] },
        })
        await setDoc(doc(db, `items/${PROJECT_ID}/tasks/focus-task`), {
            projectId: PROJECT_ID,
            userId: TEAMMATE_ID,
            userIds: [TEAMMATE_ID],
            done: true,
            inDone: true,
            completed: 1788134400000,
            isPublicFor: [0],
            readerIds: [MEMBER_ID, TEAMMATE_ID],
            roleIdsVisibleTo: { [MEMBER_ID]: [], [TEAMMATE_ID]: [] },
        })
        await setDoc(doc(db, `items/${OTHER_PROJECT_ID}/tasks/other-task`), {
            projectId: OTHER_PROJECT_ID,
            isPublicFor: [0],
            readerIds: ['other-owner'],
            roleIdsVisibleTo: { 'other-owner': [] },
        })
        await setDoc(doc(db, `items/${PROJECT_ID}/tasks/hidden-inner-task`), {
            projectId: PROJECT_ID,
            isPublicFor: [OUTSIDER_ID],
            containerNotesIds: [INNER_TASK_NOTE_ID],
            readerIds: [OUTSIDER_ID],
            roleIdsVisibleTo: { [OUTSIDER_ID]: [] },
            backlinkIdsVisibleTo: { [OUTSIDER_ID]: [INNER_TASK_NOTE_TOKEN] },
        })
        await setDoc(doc(db, `items/${PROJECT_ID}/tasks/readable-embedded-subtask`), {
            projectId: PROJECT_ID,
            parentId: 'public-task',
            isSubtask: true,
            isPublicFor: [MEMBER_ID],
            readerIds: [MEMBER_ID],
            roleIdsVisibleTo: { [MEMBER_ID]: [] },
        })
        await setDoc(doc(db, `items/${PROJECT_ID}/tasks/hidden-embedded-subtask`), {
            projectId: PROJECT_ID,
            parentId: 'public-task',
            isSubtask: true,
            isPublicFor: [OUTSIDER_ID],
            readerIds: [OUTSIDER_ID],
            roleIdsVisibleTo: { [OUTSIDER_ID]: [] },
        })
        await setDoc(doc(db, `items/${SHARED_PROJECT_ID}/tasks/shared-task`), {
            projectId: SHARED_PROJECT_ID,
            isPublicFor: [0],
            observersIds: [MEMBER_ID],
            readerIds: [0, MEMBER_ID],
            roleIdsVisibleTo: { 0: [MEMBER_ID], [MEMBER_ID]: [MEMBER_ID] },
            backlinkIdsVisibleTo: { 0: [], [MEMBER_ID]: [] },
        })
        await setDoc(doc(db, `chatObjects/${PROJECT_ID}/chats/followed-chat`), {
            isPublicFor: [0],
            quickDateId: '20260830',
            usersFollowing: [MEMBER_ID],
            readerIds: [0, MEMBER_ID, TEAMMATE_ID],
            roleIdsVisibleTo: { 0: [], [MEMBER_ID]: [], [TEAMMATE_ID]: [] },
            followedByVisibleTo: { [MEMBER_ID]: true },
            followedReaderIds: [MEMBER_ID],
            backlinkIdsVisibleTo: { [MEMBER_ID]: [] },
        })
        await setDoc(doc(db, `chatObjects/${PROJECT_ID}/chats/private-chat`), {
            isPublicFor: [MEMBER_ID],
            readerIds: [MEMBER_ID],
            roleIdsVisibleTo: { [MEMBER_ID]: [] },
        })
        await setDoc(doc(db, `noteItems/${PROJECT_ID}/notes/followed-note`), {
            isPublicFor: [MEMBER_ID],
            isVisibleInFollowedFor: [MEMBER_ID],
            readerIds: [MEMBER_ID],
            roleIdsVisibleTo: { [MEMBER_ID]: [] },
            followedByVisibleTo: { [MEMBER_ID]: true },
            followedReaderIds: [MEMBER_ID],
        })
        await setDoc(doc(db, `goals/${PROJECT_ID}/items/public-goal`), {
            isPublicFor: [0],
            readerIds: [0, MEMBER_ID, TEAMMATE_ID],
            roleIdsVisibleTo: { 0: [], [MEMBER_ID]: [], [TEAMMATE_ID]: [] },
        })
        await setDoc(doc(db, `projectsContacts/${PROJECT_ID}/contacts/public-contact`), {
            isPublicFor: [0],
            readerIds: [0, MEMBER_ID, TEAMMATE_ID],
            roleIdsVisibleTo: { 0: [], [MEMBER_ID]: [], [TEAMMATE_ID]: [] },
        })
        await setDoc(doc(db, `skills/${PROJECT_ID}/items/public-skill`), {
            isPublicFor: [0],
            readerIds: [0, MEMBER_ID, TEAMMATE_ID],
            roleIdsVisibleTo: { 0: [], [MEMBER_ID]: [], [TEAMMATE_ID]: [] },
        })
        await setDoc(doc(db, `assistants/${PROJECT_ID}/items/project-assistant`), {
            creatorId: MEMBER_ID,
            displayName: 'Project Assistant',
        })
        await setDoc(doc(db, 'assistants/globalProject/items/global-assistant'), {
            creatorId: MEMBER_ID,
            displayName: 'Global Assistant',
        })
        await setDoc(doc(db, `feedsStore/${PROJECT_ID}/all/public-feed`), {
            isPublicFor: [0],
            lastChangeDate: 3,
            readerIds: [0, MEMBER_ID, TEAMMATE_ID],
        })
        await setDoc(doc(db, `feedsStore/${PROJECT_ID}/all/private-feed`), {
            isPublicFor: [MEMBER_ID],
            lastChangeDate: 2,
            readerIds: [MEMBER_ID],
        })
        await setDoc(doc(db, `feedsStore/${PROJECT_ID}/all/hidden-feed`), {
            isPublicFor: [TEAMMATE_ID],
            lastChangeDate: 1,
            readerIds: [TEAMMATE_ID],
        })
        await setDoc(doc(db, `feedsStore/${PROJECT_ID}/${MEMBER_ID}/feeds/followed/followed-feed`), {
            isPublicFor: [0],
            lastChangeDate: 3,
            readerIds: [0, MEMBER_ID, TEAMMATE_ID],
        })
        await setDoc(doc(db, `projectsInnerFeeds/${PROJECT_ID}/tasks/public-task/feeds/member-visible`), {
            isPublicFor: [MEMBER_ID],
            lastChangeDate: 2,
            readerIds: [MEMBER_ID],
        })
        await setDoc(doc(db, `projectsInnerFeeds/${PROJECT_ID}/tasks/public-task/feeds/hidden-feed`), {
            isPublicFor: [TEAMMATE_ID],
            lastChangeDate: 1,
            readerIds: [TEAMMATE_ID],
        })
    })
}

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: 'demo-alldone-rules',
        firestore: {
            host: '127.0.0.1',
            port: 8080,
            rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
        },
    })
})

beforeEach(async () => {
    await testEnv.clearFirestore()
    await seed()
})

afterAll(async () => {
    await testEnv.cleanup()
})

describe('project membership authority', () => {
    it('lets a real project member use project data and denies an outsider', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()

        await assertSucceeds(getDoc(doc(memberDb, `items/${PROJECT_ID}/tasks/public-task`)))
        await assertSucceeds(
            setDoc(doc(memberDb, `items/${PROJECT_ID}/tasks/member-created`), {
                projectId: PROJECT_ID,
                isPublicFor: [0],
                observersIds: [MEMBER_ID],
            })
        )
        await assertFails(getDoc(doc(outsiderDb, `items/${PROJECT_ID}/tasks/public-task`)))
    })

    it('does not let an outsider self-enrol by editing their own denormalized projectIds', async () => {
        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()

        await assertFails(updateDoc(doc(outsiderDb, `users/${OUTSIDER_ID}`), { projectIds: [OTHER_PROJECT_ID] }))
        await assertFails(getDoc(doc(outsiderDb, `items/${OTHER_PROJECT_ID}/tasks/other-task`)))
        await assertFails(getDoc(doc(outsiderDb, `users/${TEAMMATE_ID}`)))
    })

    it('allows ordinary owner edits while requiring proof for project navigation state', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        await assertSucceeds(updateDoc(doc(memberDb, `users/${MEMBER_ID}`), { themeName: 'DARK' }))
        await assertSucceeds(
            updateDoc(doc(memberDb, `users/${MEMBER_ID}`), {
                archivedProjectIds: [PROJECT_ID],
                projectMembershipMutation: {
                    projectId: PROJECT_ID,
                    action: 'self-sync',
                    actorId: MEMBER_ID,
                    updatedAt: 1,
                },
            })
        )
    })

    it('allows the complete new-account bootstrap only as one authoritative membership batch', async () => {
        const creatorId = 'new-user'
        const projectId = 'new-project'
        const creatorDb = testEnv.authenticatedContext(creatorId).firestore()
        const missingUser = await assertSucceeds(getDoc(doc(creatorDb, `users/${creatorId}`)))
        expect(missingUser.exists()).toBe(false)

        const batch = writeBatch(creatorDb)
        batch.set(doc(creatorDb, `projects/${projectId}`), {
            creatorId,
            isShared: 2,
            userIds: [creatorId],
        })
        batch.set(doc(creatorDb, `users/${creatorId}`), {
            defaultProjectId: projectId,
            projectIds: [projectId],
            guideProjectIds: [],
            templateProjectIds: [],
            archivedProjectIds: [],
            copyProjectIds: [],
            invitedProjectIds: [],
        })
        batch.set(doc(creatorDb, `items/${projectId}/tasks/welcome-task`), {
            projectId,
            creatorId,
            userId: creatorId,
            userIds: [creatorId],
            isPublicFor: [0],
        })
        batch.set(doc(creatorDb, `assistants/${projectId}/items/default-assistant`), {
            creatorId,
            isDefault: true,
        })
        batch.set(doc(creatorDb, `projectsWorkstreams/${projectId}/workstreams/default`), {
            creatorId,
            userIds: [creatorId],
        })

        await assertSucceeds(batch.commit())
    })

    it('allows a signed-in user to create a second project and join it atomically', async () => {
        const projectId = 'member-second-project'
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const batch = writeBatch(memberDb)

        batch.set(doc(memberDb, `projects/${projectId}`), {
            id: 'client-placeholder-id',
            creatorId: MEMBER_ID,
            name: 'Work',
            isShared: 0,
            userIds: [MEMBER_ID],
            workstreamIds: ['ws@default'],
        })
        batch.update(doc(memberDb, `users/${MEMBER_ID}`), {
            projectIds: arrayUnion(projectId),
            lastEditionDate: 2,
            lastEditorId: MEMBER_ID,
            projectMembershipMutation: {
                projectId,
                action: 'self-sync',
                actorId: MEMBER_ID,
                updatedAt: 2,
            },
        })
        batch.set(doc(memberDb, `projectsWorkstreams/${projectId}/workstreams/ws@default`), {
            projectId,
            creatorId: MEMBER_ID,
            userIds: [MEMBER_ID],
        })

        await assertSucceeds(batch.commit())
    })

    it('allows an existing member to add a user in one verified atomic membership change', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const batch = writeBatch(memberDb)
        batch.update(doc(memberDb, `projects/${PROJECT_ID}`), { userIds: [MEMBER_ID, TEAMMATE_ID, OUTSIDER_ID] })
        batch.update(doc(memberDb, `users/${OUTSIDER_ID}`), {
            projectIds: [PROJECT_ID],
            projectMembershipMutation: {
                projectId: PROJECT_ID,
                action: 'add',
                actorId: MEMBER_ID,
                updatedAt: 1,
            },
        })

        await assertSucceeds(batch.commit())
        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()
        await assertSucceeds(getDoc(doc(outsiderDb, `projects/${PROJECT_ID}`)))
    })

    it('does not let a member smuggle a personal-field edit into a membership batch', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const batch = writeBatch(memberDb)
        batch.update(doc(memberDb, `projects/${PROJECT_ID}`), { userIds: [MEMBER_ID, TEAMMATE_ID, OUTSIDER_ID] })
        batch.update(doc(memberDb, `users/${OUTSIDER_ID}`), {
            projectIds: [PROJECT_ID],
            notificationEmail: 'attacker@example.com',
            projectMembershipMutation: {
                projectId: PROJECT_ID,
                action: 'add',
                actorId: MEMBER_ID,
                updatedAt: 1,
            },
        })

        await assertFails(batch.commit())
    })

    it('allows a project-scoped teammate workflow update without opening personal fields', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const proof = {
            projectId: PROJECT_ID,
            action: 'project-update',
            actorId: MEMBER_ID,
            updatedAt: 1,
        }

        await assertSucceeds(
            updateDoc(doc(memberDb, `users/${TEAMMATE_ID}`), {
                [`workflow.${PROJECT_ID}`]: { step: { reviewerUid: MEMBER_ID } },
                projectMembershipMutation: proof,
            })
        )
        await assertFails(
            updateDoc(doc(memberDb, `users/${TEAMMATE_ID}`), {
                notificationEmail: 'attacker@example.com',
                projectMembershipMutation: proof,
            })
        )
    })

    it('allows only a real target task in a project-scoped teammate focus update', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const proof = {
            projectId: PROJECT_ID,
            action: 'project-update',
            actorId: MEMBER_ID,
            updatedAt: 1,
        }

        await assertSucceeds(
            updateDoc(doc(memberDb, `users/${TEAMMATE_ID}`), {
                inFocusTaskId: 'focus-task',
                inFocusTaskProjectId: PROJECT_ID,
                projectMembershipMutation: proof,
            })
        )
        await assertFails(
            updateDoc(doc(memberDb, `users/${TEAMMATE_ID}`), {
                inFocusTaskId: 'missing-task',
                inFocusTaskProjectId: PROJECT_ID,
                projectMembershipMutation: proof,
            })
        )
    })

    it('allows a member to invite a user and lets the invitee remove the invitation', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        await assertSucceeds(
            updateDoc(doc(memberDb, `users/${OUTSIDER_ID}`), {
                invitedProjectIds: [PROJECT_ID],
                projectMembershipMutation: {
                    projectId: PROJECT_ID,
                    action: 'invitation-add',
                    actorId: MEMBER_ID,
                    updatedAt: 1,
                },
            })
        )

        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()
        await assertSucceeds(
            updateDoc(doc(outsiderDb, `users/${OUTSIDER_ID}`), {
                invitedProjectIds: [],
                projectMembershipMutation: {
                    projectId: PROJECT_ID,
                    action: 'invitation-remove',
                    actorId: OUTSIDER_ID,
                    updatedAt: 2,
                },
            })
        )
    })

    it('allows atomic project deletion cleanup and scoped reload notification', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const batch = writeBatch(memberDb)
        batch.delete(doc(memberDb, `projects/${PROJECT_ID}`))
        ;[MEMBER_ID, TEAMMATE_ID].forEach(userId => {
            batch.update(doc(memberDb, `users/${userId}`), {
                projectIds: [],
                projectMembershipMutation: {
                    projectId: PROJECT_ID,
                    action: 'delete-project',
                    actorId: MEMBER_ID,
                    updatedAt: 1,
                },
            })
        })
        batch.set(doc(memberDb, `userForceReloads/${TEAMMATE_ID}`), {
            reload: true,
            projectId: PROJECT_ID,
        })

        await assertSucceeds(batch.commit())
    })
})

describe('assistant task search authorization', () => {
    beforeEach(async () => {
        await testEnv.withSecurityRulesDisabled(async context => {
            const db = context.firestore()
            await setDoc(doc(db, `assistantTasks/${PROJECT_ID}/assistant-1/local-task`), {
                name: 'Local task',
            })
            await setDoc(doc(db, 'assistantTasks/globalProject/preConfigTasks/global-task'), {
                name: 'Global task',
                assistantId: 'global-assistant',
            })
        })
    })

    it('lets a project member query local and global pre-configured tasks', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        await assertSucceeds(getDocs(collection(memberDb, `assistantTasks/${PROJECT_ID}/assistant-1`)))
        await assertSucceeds(
            getDocs(
                query(
                    collection(memberDb, 'assistantTasks/globalProject/preConfigTasks'),
                    where('assistantId', '==', 'global-assistant')
                )
            )
        )
    })

    it('denies a non-member local assistant tasks while keeping global tasks readable', async () => {
        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()

        await assertFails(getDocs(collection(outsiderDb, `assistantTasks/${PROJECT_ID}/assistant-1`)))
        await assertSucceeds(
            getDocs(
                query(
                    collection(outsiderDb, 'assistantTasks/globalProject/preConfigTasks'),
                    where('assistantId', '==', 'global-assistant')
                )
            )
        )
    })
})

describe('global assistant catalog writes', () => {
    const ADMIN_ID = 'admin'

    beforeEach(async () => {
        await testEnv.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), 'assistantTasks/globalProject/preConfigTasks/global-task'), {
                name: 'Global task',
                assistantId: 'global-assistant',
            })
        })
    })

    it('lets the administrator update a global assistant', async () => {
        const adminDb = testEnv.authenticatedContext(ADMIN_ID).firestore()

        await assertSucceeds(
            updateDoc(doc(adminDb, 'assistants/globalProject/items/global-assistant'), { lastEditionDate: 42 })
        )
    })

    it('lets the administrator save a global pre-configured task together with its assistant bump', async () => {
        // updatePreConfigTask / uploadNewPreConfigTask write the task and bump the assistant
        // document in ONE batch, so the batch is only as permitted as its most restricted write.
        const adminDb = testEnv.authenticatedContext(ADMIN_ID).firestore()
        const batch = writeBatch(adminDb)
        batch.update(doc(adminDb, 'assistants/globalProject/items/global-assistant'), { lastEditionDate: 43 })
        batch.update(doc(adminDb, 'assistantTasks/globalProject/preConfigTasks/global-task'), { name: 'Renamed' })

        await assertSucceeds(batch.commit())
    })

    it('lets the administrator create and delete a global assistant', async () => {
        const adminDb = testEnv.authenticatedContext(ADMIN_ID).firestore()
        const ref = doc(adminDb, 'assistants/globalProject/items/new-global-assistant')

        await assertSucceeds(setDoc(ref, { creatorId: ADMIN_ID, displayName: 'New' }))
        await assertSucceeds(deleteDoc(ref))
    })

    it('denies a project member writing the global assistant catalog', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        await assertFails(
            updateDoc(doc(memberDb, 'assistants/globalProject/items/global-assistant'), { lastEditionDate: 44 })
        )
        await assertFails(setDoc(doc(memberDb, 'assistants/globalProject/items/member-made'), { creatorId: MEMBER_ID }))
        await assertFails(deleteDoc(doc(memberDb, 'assistants/globalProject/items/global-assistant')))
    })

    it('keeps project assistants member-writable and the global catalog readable', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()

        await assertSucceeds(
            updateDoc(doc(memberDb, `assistants/${PROJECT_ID}/items/project-assistant`), { lastEditionDate: 45 })
        )
        await assertSucceeds(getDoc(doc(outsiderDb, 'assistants/globalProject/items/global-assistant')))
        await assertFails(
            updateDoc(doc(outsiderDb, `assistants/${PROJECT_ID}/items/project-assistant`), { lastEditionDate: 46 })
        )
    })
})

describe('queries used by the web client', () => {
    it('allows the signed-in user project query through its authoritative userIds filter', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()
        const memberProjects = query(collection(memberDb, 'projects'), where('userIds', 'array-contains', MEMBER_ID))

        const snapshot = await assertSucceeds(getDocs(memberProjects))
        expect(snapshot.docs.map(item => item.id).sort()).toEqual(
            [PROJECT_ID, MOVE_TARGET_PROJECT_ID, SHARED_PROJECT_ID].sort()
        )
        await assertFails(
            getDocs(query(collection(outsiderDb, 'projects'), where('userIds', 'array-contains', MEMBER_ID)))
        )
        await assertFails(getDocs(collection(memberDb, 'projects')))
    })

    it('allows anonymous public-sentinel queries in a shared project', async () => {
        const publicDb = testEnv.unauthenticatedContext().firestore()
        const tasks = query(
            collection(publicDb, `items/${SHARED_PROJECT_ID}/tasks`),
            where('readerIds', 'array-contains', 0)
        )

        const snapshot = await assertSucceeds(getDocs(tasks))
        expect(snapshot.docs.map(item => item.id)).toEqual(['shared-task'])

        const observedTasks = query(
            collection(publicDb, `items/${SHARED_PROJECT_ID}/tasks`),
            where(new FieldPath('roleIdsVisibleTo', '0'), 'array-contains', MEMBER_ID)
        )
        await assertSucceeds(getDocs(observedTasks))
    })

    it('allows a followed-chat query only through the fixed server projection', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const teammateDb = testEnv.authenticatedContext(TEAMMATE_ID).firestore()
        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()
        const allChats = query(
            collection(memberDb, `chatObjects/${PROJECT_ID}/chats`),
            where('readerIds', 'array-contains', MEMBER_ID)
        )
        const chats = query(
            collection(memberDb, `chatObjects/${PROJECT_ID}/chats`),
            where('followedReaderIds', 'array-contains', MEMBER_ID)
        )

        const allSnapshot = await assertSucceeds(getDocs(allChats))
        expect(allSnapshot.docs.map(item => item.id).sort()).toEqual(['followed-chat', 'private-chat'])
        const snapshot = await assertSucceeds(getDocs(chats))
        expect(snapshot.docs.map(item => item.id)).toEqual(['followed-chat'])
        const missingChat = await assertSucceeds(getDoc(doc(memberDb, `chatObjects/${PROJECT_ID}/chats/not-created`)))
        expect(missingChat.exists()).toBe(false)
        await assertFails(getDoc(doc(teammateDb, `chatObjects/${PROJECT_ID}/chats/private-chat`)))
        await assertFails(getDoc(doc(outsiderDb, `chatObjects/${PROJECT_ID}/chats/not-created`)))
        await assertSucceeds(
            updateDoc(doc(memberDb, `chatObjects/${PROJECT_ID}/chats/followed-chat`), {
                isAssistantEnabled: true,
            })
        )
        await assertFails(
            getDocs(
                query(collection(memberDb, `chatObjects/${PROJECT_ID}/chats`), where('quickDateId', '==', '20260830'))
            )
        )

        const newChatRef = doc(memberDb, `chatObjects/${PROJECT_ID}/chats/new-client-chat`)
        await assertSucceeds(
            setDoc(newChatRef, {
                creatorId: MEMBER_ID,
                type: 'topics',
                isPublicFor: [0],
                quickDateId: '20260830',
            })
        )
        // Client creates and its first follower/title update can reach the
        // server before the Admin SDK projection trigger. The source
        // isPublicFor field authorizes that short projection-pending window.
        await assertSucceeds(updateDoc(newChatRef, { isAssistantEnabled: true }))
        await assertFails(
            updateDoc(newChatRef, {
                readerIds: [MEMBER_ID, OUTSIDER_ID],
            })
        )
        await assertFails(
            updateDoc(doc(memberDb, `chatObjects/${PROJECT_ID}/chats/followed-chat`), {
                followedByVisibleTo: { [OUTSIDER_ID]: true },
            })
        )
        await assertFails(
            updateDoc(doc(memberDb, `chatObjects/${PROJECT_ID}/chats/followed-chat`), {
                followedReaderIds: [OUTSIDER_ID],
            })
        )
    })

    it('allows followed-note queries through the same fixed projection', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const notes = query(
            collection(memberDb, `noteItems/${PROJECT_ID}/notes`),
            where('followedReaderIds', 'array-contains', MEMBER_ID)
        )

        const snapshot = await assertSucceeds(getDocs(notes))
        expect(snapshot.docs.map(item => item.id)).toEqual(['followed-note'])
    })

    it('allows an authorized note lifecycle while its server projection is pending', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const teammateDb = testEnv.authenticatedContext(TEAMMATE_ID).firestore()
        const noteRef = doc(memberDb, `noteItems/${PROJECT_ID}/notes/new-client-note`)

        await assertSucceeds(
            setDoc(noteRef, {
                creatorId: MEMBER_ID,
                userId: MEMBER_ID,
                isPublicFor: [MEMBER_ID],
                title: 'first title',
            })
        )
        await assertSucceeds(updateDoc(noteRef, { title: 'edited title' }))
        await assertSucceeds(setDoc(doc(memberDb, `notesCollab/${PROJECT_ID}/notes/new-client-note`), { updatedAt: 1 }))
        await assertSucceeds(
            setDoc(doc(memberDb, `noteItemsVersions/${PROJECT_ID}/new-client-note/version-1`), { created: 1 })
        )
        await assertFails(updateDoc(doc(teammateDb, noteRef.path), { title: 'not allowed' }))
        await assertFails(
            updateDoc(noteRef, {
                readerIds: [MEMBER_ID, OUTSIDER_ID],
            })
        )
    })

    it('accepts the collaborative feed fan-out that accompanies a new note', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const batch = writeBatch(memberDb)
        const noteId = 'note-with-feed-fanout'
        const feedId = 'feed-1'
        const feed = {
            creatorId: MEMBER_ID,
            objectId: noteId,
            isPublicFor: [0],
            lastChangeDate: 1,
        }

        batch.set(doc(memberDb, `noteItems/${PROJECT_ID}/notes/${noteId}`), {
            creatorId: MEMBER_ID,
            userId: MEMBER_ID,
            isPublicFor: [0],
            title: 'new note',
        })
        batch.set(doc(memberDb, `projectsInnerFeeds/${PROJECT_ID}/notes/${noteId}/feeds/${feedId}`), feed)
        batch.set(doc(memberDb, `feedsStore/${PROJECT_ID}/all/${feedId}`), feed)
        batch.set(doc(memberDb, `feedsStore/${PROJECT_ID}/${TEAMMATE_ID}/feeds/followed/${feedId}`), feed)
        batch.set(
            doc(memberDb, `feedsCount/${PROJECT_ID}/${TEAMMATE_ID}/followed`),
            { notes: { [noteId]: { [feedId]: { dateFormated: '30082026', feed } } } },
            { merge: true }
        )
        batch.set(
            doc(memberDb, `followers/${PROJECT_ID}/notes/${noteId}`),
            { usersFollowing: [MEMBER_ID] },
            { merge: true }
        )
        batch.set(
            doc(memberDb, `usersFollowing/${PROJECT_ID}/entries/${MEMBER_ID}`),
            { notes: { [noteId]: true } },
            { merge: true }
        )

        await assertSucceeds(batch.commit())
    })

    it('allows the query-shaped readerIds task query', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const tasks = query(
            collection(memberDb, `items/${PROJECT_ID}/tasks`),
            where('readerIds', 'array-contains', MEMBER_ID)
        )

        const snapshot = await assertSucceeds(getDocs(tasks))
        expect(snapshot.docs.map(item => item.id).sort()).toEqual([
            'focus-task',
            'private-task',
            'public-task',
            'readable-embedded-subtask',
        ])
    })

    it('loads embedded-task subtasks only through the reader projection', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const projectedSubtasks = query(
            collection(memberDb, `items/${PROJECT_ID}/tasks`),
            where('readerIds', 'array-contains', MEMBER_ID),
            where('parentId', '==', 'public-task')
        )
        const unscopedSubtasks = query(
            collection(memberDb, `items/${PROJECT_ID}/tasks`),
            where('parentId', '==', 'public-task')
        )

        const snapshot = await assertSucceeds(getDocs(projectedSubtasks))
        expect(snapshot.docs.map(item => item.id)).toEqual(['readable-embedded-subtask'])
        await assertFails(getDocs(unscopedSubtasks))
    })

    it('allows the focus-handoff task queries only through the reader projection', async () => {
        // findAndSetNewFocusedTask (tasksFirestore.js) hunts for the user's next focus task with
        // these exact shapes. Without the readerIds proof the rules engine cannot show every
        // returned document is readable and denies the LIST outright, which is what reached the
        // checkbox as "workflow focus handoff: Missing or insufficient permissions".
        await testEnv.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), `items/${PROJECT_ID}/tasks/member-open-task`), {
                projectId: PROJECT_ID,
                userId: MEMBER_ID,
                userIds: [MEMBER_ID],
                done: false,
                inDone: false,
                isSubtask: false,
                sortIndex: 1788134400000,
                isPublicFor: [0],
                readerIds: [MEMBER_ID],
                roleIdsVisibleTo: { [MEMBER_ID]: [MEMBER_ID] },
            })
        })
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const tasks = collection(memberDb, `items/${PROJECT_ID}/tasks`)
        const ownOpenTopLevel = [
            where('readerIds', 'array-contains', MEMBER_ID),
            where('userId', '==', MEMBER_ID),
            where('done', '==', false),
            where('inDone', '==', false),
            where('isSubtask', '==', false),
        ]

        const displayOrder = await assertSucceeds(
            getDocs(query(tasks, ...ownOpenTopLevel, orderBy('sortIndex', 'desc'), limit(200)))
        )
        expect(displayOrder.docs.map(item => item.id)).toEqual(['member-open-task'])

        const calendarWindow = await assertSucceeds(
            getDocs(
                query(
                    tasks,
                    ...ownOpenTopLevel,
                    where('sortIndex', '>=', 1788134000000),
                    where('sortIndex', '<', 1788135000000),
                    orderBy('sortIndex', 'asc')
                )
            )
        )
        expect(calendarWindow.docs.map(item => item.id)).toEqual(['member-open-task'])

        // The pre-fix shape: identical, minus the proof.
        await assertFails(getDocs(query(tasks, ...ownOpenTopLevel.slice(1), orderBy('sortIndex', 'desc'))))
    })

    it('allows the projected day-rate reconciliation query', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const tasks = query(
            collection(memberDb, `items/${PROJECT_ID}/tasks`),
            where('readerIds', 'array-contains', MEMBER_ID),
            where('userId', '==', TEAMMATE_ID),
            where('inDone', '==', true),
            where('completed', '>=', 1788134400000),
            where('completed', '<=', 1788220799999),
            orderBy('completed', 'desc')
        )

        const snapshot = await assertSucceeds(getDocs(tasks))
        expect(snapshot.docs.map(item => item.id)).toEqual(['focus-task'])
    })

    it('requires a task projectId that matches its authoritative path', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        await assertFails(
            setDoc(doc(memberDb, `items/${PROJECT_ID}/tasks/wrong-project-id`), {
                projectId: OTHER_PROJECT_ID,
                isPublicFor: [0],
            })
        )
        await assertFails(
            updateDoc(doc(memberDb, `items/${PROJECT_ID}/tasks/public-task`), {
                projectId: OTHER_PROJECT_ID,
            })
        )
        await assertSucceeds(
            updateDoc(doc(memberDb, `items/${PROJECT_ID}/tasks/public-task`), {
                projectId: PROJECT_ID,
                name: 'Ordinary edit',
            })
        )
    })

    it('allows a cross-project task copy only after server access projections are removed', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const sourceSnapshot = await getDoc(doc(memberDb, `items/${PROJECT_ID}/tasks/public-task`))
        const copiedTask = {
            ...sourceSnapshot.data(),
            projectId: MOVE_TARGET_PROJECT_ID,
        }

        await assertFails(setDoc(doc(memberDb, `items/${MOVE_TARGET_PROJECT_ID}/tasks/forged-move`), copiedTask))

        ;['readerIds', 'roleIdsVisibleTo', 'followedByVisibleTo', 'followedReaderIds', 'backlinkIdsVisibleTo'].forEach(
            field => delete copiedTask[field]
        )
        await assertSucceeds(setDoc(doc(memberDb, `items/${MOVE_TARGET_PROJECT_ID}/tasks/sanitized-move`), copiedTask))
    })

    it('requires a merge when the destination id is already taken', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const sourceSnapshot = await getDoc(doc(memberDb, `items/${PROJECT_ID}/tasks/public-task`))
        const copiedTask = { ...sourceSnapshot.data(), projectId: MOVE_TARGET_PROJECT_ID }
        ;['readerIds', 'roleIdsVisibleTo', 'followedByVisibleTo', 'followedReaderIds', 'backlinkIdsVisibleTo'].forEach(
            field => delete copiedTask[field]
        )

        // A calendar task is keyed by its calendar event id, so the destination
        // project can already hold a document with that id — and so can any
        // project a previous move failed halfway into. Stripping the projection
        // is then not enough: an overwriting set() DELETES the destination's own
        // projection fields, which accessProjectionUnchanged() rejects.
        const occupiedRef = doc(memberDb, `items/${MOVE_TARGET_PROJECT_ID}/tasks/occupied-move`)
        await testEnv.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), occupiedRef.path), {
                projectId: MOVE_TARGET_PROJECT_ID,
                isPublicFor: [0],
                observersIds: [MEMBER_ID],
                readerIds: [0, MEMBER_ID, TEAMMATE_ID],
                roleIdsVisibleTo: { 0: [], [MEMBER_ID]: [], [TEAMMATE_ID]: [] },
            })
        })

        await assertFails(setDoc(occupiedRef, copiedTask))
        await assertSucceeds(setDoc(occupiedRef, copiedTask, { merge: true }))
    })

    it('keeps a private moved task readable and editable while its server projection is pending', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const teammateDb = testEnv.authenticatedContext(TEAMMATE_ID).firestore()
        const movedTaskRef = doc(memberDb, `items/${MOVE_TARGET_PROJECT_ID}/tasks/pending-move`)

        await assertSucceeds(
            setDoc(movedTaskRef, {
                projectId: MOVE_TARGET_PROJECT_ID,
                creatorId: MEMBER_ID,
                userId: MEMBER_ID,
                userIds: [MEMBER_ID],
                currentReviewerId: MEMBER_ID,
                isPublicFor: [MEMBER_ID],
                name: 'Moved task',
            })
        )
        await assertSucceeds(getDoc(movedTaskRef))
        await assertSucceeds(updateDoc(movedTaskRef, { name: 'Moved task updated' }))
        await assertFails(getDoc(doc(teammateDb, movedTaskRef.path)))
        await assertFails(updateDoc(doc(teammateDb, movedTaskRef.path), { name: 'Forbidden edit' }))
    })

    it('allows the projected random Someday task query', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const tasks = query(
            collection(memberDb, `items/${PROJECT_ID}/tasks`),
            where('readerIds', 'array-contains', MEMBER_ID),
            where('dueDate', '==', 253402214400000),
            where('done', '==', false),
            where('currentReviewerId', '==', MEMBER_ID),
            where('parentId', '==', null)
        )

        const snapshot = await assertSucceeds(getDocs(tasks))
        expect(snapshot.docs.map(item => item.id)).toEqual(['private-task'])
    })

    it('allows only projection-shaped Updates queries on the all and followed stores', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const teammateDb = testEnv.authenticatedContext(TEAMMATE_ID).firestore()
        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()

        const allUpdates = query(
            collection(memberDb, `feedsStore/${PROJECT_ID}/all`),
            where('readerIds', 'array-contains', MEMBER_ID),
            orderBy('lastChangeDate', 'desc')
        )
        const allSnapshot = await assertSucceeds(getDocs(allUpdates))
        expect(allSnapshot.docs.map(item => item.id)).toEqual(['public-feed', 'private-feed'])

        const followedUpdates = query(
            collection(memberDb, `feedsStore/${PROJECT_ID}/${MEMBER_ID}/feeds/followed`),
            where('readerIds', 'array-contains', MEMBER_ID),
            orderBy('lastChangeDate', 'desc')
        )
        const followedSnapshot = await assertSucceeds(getDocs(followedUpdates))
        expect(followedSnapshot.docs.map(item => item.id)).toEqual(['followed-feed'])

        await assertFails(
            getDocs(
                query(
                    collection(teammateDb, `feedsStore/${PROJECT_ID}/${MEMBER_ID}/feeds/followed`),
                    where('readerIds', 'array-contains', TEAMMATE_ID)
                )
            )
        )
        await assertFails(getDoc(doc(outsiderDb, `feedsStore/${PROJECT_ID}/all/public-feed`)))
        await assertFails(getDoc(doc(memberDb, `feedsStore/${PROJECT_ID}/all/hidden-feed`)))
    })

    it('lets a member re-privatise only the activity it can see, through readerIds-shaped queries', async () => {
        // The browser half of a privacy change (utils/backends/Feeds/feedPrivacy.js): every store
        // is queried by objectId AND the reader projection, and only the caller's own followed
        // store is reachable. A bare objectId query cannot prove canReadObject and is refused as
        // a whole, which is what used to surface as "Missing or insufficient permissions" on
        // every privacy change (and on creating a private task, e.g. an invoice task).
        const objectId = 'privacy-task'
        await testEnv.withSecurityRulesDisabled(async context => {
            const db = context.firestore()
            const feed = { objectId, isPublicFor: [0], lastChangeDate: 5, readerIds: [0, MEMBER_ID, TEAMMATE_ID] }
            await setDoc(doc(db, `feedsStore/${PROJECT_ID}/all/privacy-all`), feed)
            await setDoc(doc(db, `feedsStore/${PROJECT_ID}/${MEMBER_ID}/feeds/followed/privacy-own`), feed)
            await setDoc(doc(db, `feedsStore/${PROJECT_ID}/${TEAMMATE_ID}/feeds/followed/privacy-theirs`), feed)
            await setDoc(doc(db, `projectsInnerFeeds/${PROJECT_ID}/tasks/${objectId}/feeds/privacy-history`), feed)
        })
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const visible = path =>
            query(
                collection(memberDb, path),
                where('objectId', '==', objectId),
                where('readerIds', 'array-contains', MEMBER_ID)
            )

        const ownStore = `feedsStore/${PROJECT_ID}/${MEMBER_ID}/feeds/followed`
        const allStore = `feedsStore/${PROJECT_ID}/all`
        const history = `projectsInnerFeeds/${PROJECT_ID}/tasks/${objectId}/feeds`
        for (const path of [ownStore, allStore, history]) {
            const snapshot = await assertSucceeds(getDocs(visible(path)))
            expect(snapshot.size).toBe(1)
            await assertSucceeds(
                setDoc(doc(memberDb, `${path}/${snapshot.docs[0].id}`), { isPublicFor: [MEMBER_ID] }, { merge: true })
            )
        }
        await assertSucceeds(deleteDoc(doc(memberDb, `${ownStore}/privacy-own`)))

        // Without the projection the same query is refused outright.
        await assertFails(getDocs(query(collection(memberDb, allStore), where('objectId', '==', objectId))))
        // Another member's followed store is unreachable however the query is shaped.
        await assertFails(getDocs(visible(`feedsStore/${PROJECT_ID}/${TEAMMATE_ID}/feeds/followed`)))
    })

    it('requires the reader projection when copying a moved object activity history', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const activityHistory = collection(memberDb, `projectsInnerFeeds/${PROJECT_ID}/tasks/public-task/feeds`)

        await assertFails(getDocs(activityHistory))
        const visibleHistory = await assertSucceeds(
            getDocs(query(activityHistory, where('readerIds', 'array-contains', MEMBER_ID)))
        )

        expect(visibleHistory.docs.map(item => item.id)).toEqual(['member-visible'])
    })

    it('keeps Updates projections server-owned while allowing ordinary member feed writes', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()

        await assertSucceeds(
            setDoc(doc(memberDb, `feedsStore/${PROJECT_ID}/all/client-created`), {
                creatorId: MEMBER_ID,
                isPublicFor: [0],
                lastChangeDate: 4,
            })
        )
        await assertSucceeds(
            setDoc(doc(memberDb, `feedsStore/${PROJECT_ID}/${TEAMMATE_ID}/feeds/followed/client-created`), {
                creatorId: MEMBER_ID,
                isPublicFor: [0],
                lastChangeDate: 4,
            })
        )
        await assertFails(
            setDoc(doc(memberDb, `feedsStore/${PROJECT_ID}/all/forged`), {
                creatorId: MEMBER_ID,
                isPublicFor: [0],
                lastChangeDate: 4,
                readerIds: [OUTSIDER_ID],
            })
        )
        await assertFails(
            updateDoc(doc(memberDb, `feedsStore/${PROJECT_ID}/all/public-feed`), {
                readerIds: [MEMBER_ID, OUTSIDER_ID],
            })
        )
        await assertFails(
            setDoc(doc(outsiderDb, `feedsStore/${PROJECT_ID}/all/outsider-created`), {
                creatorId: OUTSIDER_ID,
                isPublicFor: [0],
                lastChangeDate: 4,
            })
        )
    })

    it('allows project feed creators to fan out unread counters without exposing teammate counters', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()
        const teammateCounter = doc(memberDb, `feedsCount/${PROJECT_ID}/${TEAMMATE_ID}/followed`)

        await assertSucceeds(
            setDoc(
                teammateCounter,
                {
                    notes: {
                        'note-1': {
                            'feed-1': { dateFormated: '30082026' },
                        },
                    },
                },
                { merge: true }
            )
        )
        await assertFails(getDoc(teammateCounter))
        await assertFails(setDoc(doc(outsiderDb, `feedsCount/${PROJECT_ID}/${TEAMMATE_ID}/all`), { forged: true }))
    })

    it('allows the complete member-written task transition feed batch', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const feedId = 'transition-feed'
        const taskId = 'public-task'
        const taskFeedObject = {
            type: 'task',
            taskId,
            name: 'Public task',
            userId: MEMBER_ID,
            isDone: false,
            isDeleted: false,
            isPublicFor: [0, MEMBER_ID],
            lastChangeDate: 5,
        }
        const feed = {
            type: 'task-unchecked-done',
            creatorId: MEMBER_ID,
            objectId: taskId,
            isPublicFor: [0, MEMBER_ID],
            lastChangeDate: 5,
        }
        const batch = writeBatch(memberDb)

        batch.set(doc(memberDb, `projectsFeeds/${PROJECT_ID}/31082026/${taskId}`), taskFeedObject, {
            merge: true,
        })
        batch.set(doc(memberDb, `feedsObjectsLastStates/${PROJECT_ID}/tasks/${taskId}`), taskFeedObject, {
            merge: true,
        })
        batch.set(doc(memberDb, `feedsStore/${PROJECT_ID}/all/${feedId}`), feed, { merge: true })
        batch.set(doc(memberDb, `feedsStore/${PROJECT_ID}/${MEMBER_ID}/feeds/followed/${feedId}`), feed, {
            merge: true,
        })
        batch.set(
            doc(memberDb, `feedsCount/${PROJECT_ID}/${TEAMMATE_ID}/all`),
            { tasks: { [taskId]: { [feedId]: { dateFormated: '31082026', feed } } } },
            { merge: true }
        )
        batch.set(doc(memberDb, `projectsInnerFeeds/${PROJECT_ID}/tasks/${taskId}/feeds/${feedId}`), feed)
        batch.set(doc(memberDb, `projects/${PROJECT_ID}`), { lastActionDate: 5 }, { merge: true })

        await assertSucceeds(batch.commit())
        await assertSucceeds(
            setDoc(doc(memberDb, `oldFeeds/${PROJECT_ID}/31082026/${taskId}`), taskFeedObject, { merge: true })
        )
        await assertSucceeds(setDoc(doc(memberDb, `oldFeeds/${PROJECT_ID}/31082026/${taskId}/feeds/${feedId}`), feed))
    })

    it('allows backlink queries only through the per-reader server projection', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const tasks = query(
            collection(memberDb, `items/${PROJECT_ID}/tasks`),
            where(new FieldPath('backlinkIdsVisibleTo', MEMBER_ID), 'array-contains', BACKLINK_TOKEN)
        )

        const snapshot = await assertSucceeds(getDocs(tasks))
        expect(snapshot.docs.map(item => item.id).sort()).toEqual(['private-task', 'public-task'])
    })

    it('loads note inner tasks through the per-reader backlink projection', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const projectedTasks = query(
            collection(memberDb, `items/${PROJECT_ID}/tasks`),
            where(new FieldPath('backlinkIdsVisibleTo', MEMBER_ID), 'array-contains', INNER_TASK_NOTE_TOKEN)
        )
        const legacyTasks = query(
            collection(memberDb, `items/${PROJECT_ID}/tasks`),
            where('containerNotesIds', 'array-contains', INNER_TASK_NOTE_ID)
        )

        const snapshot = await assertSucceeds(getDocs(projectedTasks))
        expect(snapshot.docs.map(item => item.id)).toEqual(['public-task'])
        await assertFails(getDocs(legacyTasks))
    })

    it('rejects an observer-only query that could return a task private to somebody else', async () => {
        await testEnv.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), `items/${PROJECT_ID}/tasks/not-readable`), {
                isPublicFor: ['someone-else'],
                observersIds: [MEMBER_ID],
                readerIds: ['someone-else'],
                roleIdsVisibleTo: { 'someone-else': [MEMBER_ID] },
            })
        })
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const tasks = query(
            collection(memberDb, `items/${PROJECT_ID}/tasks`),
            where(`roleIdsVisibleTo.${MEMBER_ID}`, 'array-contains', MEMBER_ID)
        )

        const snapshot = await assertSucceeds(getDocs(tasks))
        expect(snapshot.docs.map(item => item.id).sort()).toEqual(['private-task', 'public-task'])
    })

    it('does not let a client forge the server-owned access projection', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        await assertFails(
            updateDoc(doc(memberDb, `items/${PROJECT_ID}/tasks/public-task`), {
                readerIds: [MEMBER_ID, OUTSIDER_ID],
            })
        )
        await assertFails(
            updateDoc(doc(memberDb, `items/${PROJECT_ID}/tasks/public-task`), {
                backlinkIdsVisibleTo: { [OUTSIDER_ID]: [BACKLINK_TOKEN] },
            })
        )
    })
})

describe('missing object probes (AT-2484)', () => {
    it('lets a project member learn that an object does not exist without erroring the read', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        for (const path of [
            `items/${PROJECT_ID}/tasks/never-created`,
            `noteItems/${PROJECT_ID}/notes/never-created`,
            `goals/${PROJECT_ID}/items/never-created`,
            `projectsContacts/${PROJECT_ID}/contacts/never-created`,
            `skills/${PROJECT_ID}/items/never-created`,
            `okrs/${PROJECT_ID}/projectOkrs/never-created`,
        ]) {
            const snapshot = await assertSucceeds(getDoc(doc(memberDb, path)))
            expect(snapshot.exists()).toBe(false)
        }
    })

    it('still hides existence from outsiders and keeps existing private objects private', async () => {
        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()
        const teammateDb = testEnv.authenticatedContext(TEAMMATE_ID).firestore()
        const anonymousDb = testEnv.unauthenticatedContext().firestore()

        await assertFails(getDoc(doc(outsiderDb, `items/${PROJECT_ID}/tasks/never-created`)))
        await assertFails(getDoc(doc(anonymousDb, `items/${PROJECT_ID}/tasks/never-created`)))
        await assertFails(getDoc(doc(outsiderDb, `noteItems/${PROJECT_ID}/notes/never-created`)))
        // The probe only answers for a null resource; a real private task is still governed by the
        // ordinary read rule, so a teammate outside its isPublicFor cannot read it.
        await assertFails(getDoc(doc(teammateDb, `items/${PROJECT_ID}/tasks/private-task`)))
    })

    it('lets a member batch that carries a stale id delete nothing instead of failing as a whole', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        await testEnv.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), `items/${PROJECT_ID}/tasks/parent-with-stale-subtask`), {
                projectId: PROJECT_ID,
                isPublicFor: [0],
                subtaskIds: ['subtask-already-gone'],
                readerIds: [MEMBER_ID],
                roleIdsVisibleTo: { [MEMBER_ID]: [] },
            })
        })

        const batch = writeBatch(memberDb)
        batch.delete(doc(memberDb, `items/${PROJECT_ID}/tasks/parent-with-stale-subtask`))
        batch.delete(doc(memberDb, `items/${PROJECT_ID}/tasks/subtask-already-gone`))
        await assertSucceeds(batch.commit())

        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()
        await assertFails(deleteDoc(doc(outsiderDb, `items/${PROJECT_ID}/tasks/subtask-already-gone`)))
    })
})

describe('server-only data', () => {
    it.each([
        `userSecrets/${MEMBER_ID}/providers/google`,
        `assistants/${PROJECT_ID}/mcpSecrets/secret-a`,
        'assistantHeartbeatSchedules/schedule-a',
        'workflowAiRuns/run-a',
        'taskStatisticsEvents/event-a',
        `firestoreAccessProjectionJobs/${PROJECT_ID}`,
        'firestoreAccessProjectionMigrations/schema-v2',
        'verifiedEmailIdentities/abc123/accounts/member',
    ])('denies client reads and writes at %s', async documentPath => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        await assertFails(getDoc(doc(memberDb, documentPath)))
        await assertFails(setDoc(doc(memberDb, documentPath), { secret: 'never-client-visible' }))
    })

    // Fabricating one of these is otherwise all it takes to present somebody else's
    // address as a connected mailbox, which the Anna email channel treats as proof of
    // ownership (AT-2483). Only Cloud Functions write them, after the provider itself
    // confirmed the address.
    it.each([
        `users/${MEMBER_ID}/private/googleAuth_${PROJECT_ID}_gmail`,
        `users/${MEMBER_ID}/private/googleAuth_email_google_ab12cd34`,
        `users/${MEMBER_ID}/private/microsoftAuth_email_microsoft_ab12cd34`,
    ])('denies a client write to its own OAuth credential document %s', async documentPath => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        await assertFails(setDoc(doc(memberDb, documentPath), { email: 'victim@example.com', service: 'gmail' }))
        // Still readable: the app renders connection state from these documents.
        await assertSucceeds(getDoc(doc(memberDb, documentPath)))
    })

    it('keeps every other private document owner-writable', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        await assertSucceeds(setDoc(doc(memberDb, `users/${MEMBER_ID}/private/clockSync`), { time: 1 }))
        await assertSucceeds(
            setDoc(doc(memberDb, `users/${MEMBER_ID}/private/gmailLabeling_${PROJECT_ID}`), { enabled: true })
        )
        await assertSucceeds(
            setDoc(doc(memberDb, `users/${MEMBER_ID}/private/gmailLabelingState_${PROJECT_ID}/messages/m1`), {
                labeled: true,
            })
        )
        await assertFails(setDoc(doc(memberDb, `users/${OUTSIDER_ID}/private/clockSync`), { time: 1 }))
    })
})

describe('task transition side-effect ownership', () => {
    it('lets a member update a readable task and their undo record without writing another user statistics', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const batch = writeBatch(memberDb)

        batch.update(doc(memberDb, `items/${PROJECT_ID}/tasks/public-task`), {
            projectId: PROJECT_ID,
            done: true,
            inDone: true,
            completed: 1788134400000,
            currentReviewerId: -2,
            taskStatisticsTransition: {
                id: 'transition-a',
                actorId: MEMBER_ID,
                ownerId: TEAMMATE_ID,
            },
        })
        batch.set(doc(memberDb, `users/${MEMBER_ID}/undoActions/action-a`), {
            initiatorId: MEMBER_ID,
            status: 'applied',
        })

        await assertSucceeds(batch.commit())
        await assertFails(setDoc(doc(memberDb, `statistics/${PROJECT_ID}/${TEAMMATE_ID}/31082026`), { doneTasks: 1 }))
    })
})

describe('comment parent authorization', () => {
    beforeEach(async () => {
        await testEnv.withSecurityRulesDisabled(async context => {
            const db = context.firestore()
            await setDoc(doc(db, `chatComments/${PROJECT_ID}/tasks/public-task/comments/public-comment`), {
                commentText: 'Visible with the public task',
                creatorId: MEMBER_ID,
                created: 1,
            })
            await setDoc(doc(db, `chatComments/${PROJECT_ID}/tasks/private-task/comments/private-comment`), {
                commentText: 'Private task comment',
                creatorId: MEMBER_ID,
                created: 1,
            })
        })
    })

    it('lets a new project member read public comments but not comments on a private parent', async () => {
        const teammateDb = testEnv.authenticatedContext(TEAMMATE_ID).firestore()

        await assertSucceeds(
            getDoc(doc(teammateDb, `chatComments/${PROJECT_ID}/tasks/public-task/comments/public-comment`))
        )
        await assertFails(
            getDoc(doc(teammateDb, `chatComments/${PROJECT_ID}/tasks/private-task/comments/private-comment`))
        )
    })

    it('requires write access to the parent before creating a comment', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const teammateDb = testEnv.authenticatedContext(TEAMMATE_ID).firestore()

        await assertSucceeds(
            setDoc(doc(memberDb, `chatComments/${PROJECT_ID}/tasks/private-task/comments/owner-comment`), {
                commentText: 'Allowed private comment',
                creatorId: MEMBER_ID,
            })
        )
        await assertFails(
            setDoc(doc(teammateDb, `chatComments/${PROJECT_ID}/tasks/private-task/comments/member-comment`), {
                commentText: 'Must not reach the private task',
                creatorId: TEAMMATE_ID,
            })
        )
    })

    it('only lets the comment author edit or delete a public comment', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const teammateDb = testEnv.authenticatedContext(TEAMMATE_ID).firestore()
        const memberComment = doc(memberDb, `chatComments/${PROJECT_ID}/tasks/public-task/comments/public-comment`)
        const teammateComment = doc(teammateDb, `chatComments/${PROJECT_ID}/tasks/public-task/comments/public-comment`)

        await assertFails(updateDoc(teammateComment, { commentText: 'Rewritten by another member' }))
        await assertFails(deleteDoc(teammateComment))
        await assertSucceeds(updateDoc(memberComment, { commentText: 'Edited by its author' }))
        await assertSucceeds(deleteDoc(memberComment))
    })

    it.each([
        ['tasks', 'public-task'],
        ['notes', 'followed-note'],
        ['goals', 'public-goal'],
        ['topics', 'followed-chat'],
        ['contacts', 'public-contact'],
        ['contacts', TEAMMATE_ID],
        ['skills', 'public-skill'],
        ['assistants', 'project-assistant'],
        ['assistants', 'global-assistant'],
    ])('preserves legitimate comments for %s parents', async (chatType, objectId) => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        await assertSucceeds(
            setDoc(doc(memberDb, `chatComments/${PROJECT_ID}/${chatType}/${objectId}/comments/member-comment`), {
                commentText: 'Legitimate comment',
                creatorId: MEMBER_ID,
            })
        )
    })
})

describe('chat notification ownership', () => {
    it('lets a comment author atomically fan out inbox, push, and email notifications to project members', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const commentId = 'comment-fanout'
        const taskId = 'public-task'
        const notificationMetadata = {
            projectId: PROJECT_ID,
            chatType: 'tasks',
            objectId: taskId,
            commentId,
            creatorId: MEMBER_ID,
        }
        const batch = writeBatch(memberDb)

        batch.set(doc(memberDb, `chatComments/${PROJECT_ID}/tasks/${taskId}/comments/${commentId}`), {
            commentText: 'A real comment',
            creatorId: MEMBER_ID,
            created: 1,
        })
        batch.set(doc(memberDb, `chatNotifications/${PROJECT_ID}/${TEAMMATE_ID}/${commentId}`), {
            ...notificationMetadata,
            chatId: taskId,
            followed: true,
        })
        batch.set(doc(memberDb, `pushNotifications/${commentId}`), {
            ...notificationMetadata,
            chatId: taskId,
            userIds: [TEAMMATE_ID],
        })
        batch.set(doc(memberDb, `emailNotifications/${taskId}`), {
            ...notificationMetadata,
            objectType: 'tasks',
            userIds: [TEAMMATE_ID],
        })

        await assertSucceeds(batch.commit())
    })

    it('lets a project assistant quick topic persist its first comment and notification fan-out', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const commentId = 'quick-topic-comment'
        const topicId = 'followed-chat'
        const notificationMetadata = {
            projectId: PROJECT_ID,
            chatType: 'topics',
            objectId: topicId,
            commentId,
            creatorId: MEMBER_ID,
        }
        const batch = writeBatch(memberDb)

        batch.set(doc(memberDb, `chatComments/${PROJECT_ID}/topics/${topicId}/comments/${commentId}`), {
            commentText: 'Start a new assistant topic',
            creatorId: MEMBER_ID,
            created: 1,
        })
        batch.set(doc(memberDb, `chatNotifications/${PROJECT_ID}/${TEAMMATE_ID}/${commentId}`), {
            ...notificationMetadata,
            chatId: topicId,
            followed: false,
        })
        batch.set(doc(memberDb, `pushNotifications/${commentId}`), {
            ...notificationMetadata,
            chatId: topicId,
            userIds: [TEAMMATE_ID],
        })
        batch.set(doc(memberDb, `emailNotifications/${topicId}`), {
            ...notificationMetadata,
            // Email delivery still calls topics "chats". The authorization proof must use
            // chatType above so it resolves the actual chatComments/.../topics/... document.
            objectType: 'chats',
            userIds: [TEAMMATE_ID],
        })

        await assertSucceeds(batch.commit())
    })

    it('does not let a comment author notify users outside the project', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const commentId = 'comment-outsider'
        const batch = writeBatch(memberDb)

        batch.set(doc(memberDb, `chatComments/${PROJECT_ID}/tasks/public-task/comments/${commentId}`), {
            commentText: 'A real comment',
            creatorId: MEMBER_ID,
            created: 1,
        })
        batch.set(doc(memberDb, `pushNotifications/${commentId}`), {
            projectId: PROJECT_ID,
            chatType: 'tasks',
            objectId: 'public-task',
            commentId,
            creatorId: MEMBER_ID,
            userIds: [OUTSIDER_ID],
        })

        await assertFails(batch.commit())
    })

    it('does not let a private comment notify another project member without parent access', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const commentId = 'private-comment-fanout'
        const notificationMetadata = {
            projectId: PROJECT_ID,
            chatType: 'tasks',
            objectId: 'private-task',
            commentId,
            creatorId: MEMBER_ID,
        }
        const batch = writeBatch(memberDb)

        batch.set(doc(memberDb, `chatComments/${PROJECT_ID}/tasks/private-task/comments/${commentId}`), {
            commentText: 'Private task comment',
            creatorId: MEMBER_ID,
            created: 1,
        })
        batch.set(doc(memberDb, `chatNotifications/${PROJECT_ID}/${TEAMMATE_ID}/${commentId}`), {
            ...notificationMetadata,
            chatId: 'private-task',
            followed: false,
        })
        batch.set(doc(memberDb, `pushNotifications/${commentId}`), {
            ...notificationMetadata,
            chatId: 'private-task',
            userIds: [TEAMMATE_ID],
        })
        batch.set(doc(memberDb, 'emailNotifications/private-task'), {
            ...notificationMetadata,
            objectType: 'tasks',
            userIds: [TEAMMATE_ID],
        })

        await assertFails(batch.commit())
    })

    it('lets a restricted comment notify another explicitly authorized project member', async () => {
        await testEnv.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), `items/${PROJECT_ID}/tasks/restricted-team-task`), {
                projectId: PROJECT_ID,
                isPublicFor: [MEMBER_ID, TEAMMATE_ID],
                observersIds: [MEMBER_ID],
                readerIds: [MEMBER_ID, TEAMMATE_ID],
                roleIdsVisibleTo: { [MEMBER_ID]: [MEMBER_ID], [TEAMMATE_ID]: [MEMBER_ID] },
            })
        })

        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const commentId = 'restricted-comment-fanout'
        const taskId = 'restricted-team-task'
        const notificationMetadata = {
            projectId: PROJECT_ID,
            chatType: 'tasks',
            objectId: taskId,
            commentId,
            creatorId: MEMBER_ID,
        }
        const batch = writeBatch(memberDb)

        batch.set(doc(memberDb, `chatComments/${PROJECT_ID}/tasks/${taskId}/comments/${commentId}`), {
            commentText: 'Restricted team comment',
            creatorId: MEMBER_ID,
            created: 1,
        })
        batch.set(doc(memberDb, `chatNotifications/${PROJECT_ID}/${TEAMMATE_ID}/${commentId}`), {
            ...notificationMetadata,
            chatId: taskId,
            followed: true,
        })
        batch.set(doc(memberDb, `pushNotifications/${commentId}`), {
            ...notificationMetadata,
            chatId: taskId,
            userIds: [TEAMMATE_ID],
        })
        batch.set(doc(memberDb, `emailNotifications/${taskId}`), {
            ...notificationMetadata,
            objectType: 'tasks',
            userIds: [TEAMMATE_ID],
        })

        await assertSucceeds(batch.commit())
    })

    it('lets a later comment merge recipients into an existing email notification queue item', async () => {
        await testEnv.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), 'emailNotifications/public-task'), {
                projectId: PROJECT_ID,
                objectType: 'tasks',
                userIds: [MEMBER_ID],
            })
        })

        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const commentId = 'comment-email-merge'
        const batch = writeBatch(memberDb)
        batch.set(doc(memberDb, `chatComments/${PROJECT_ID}/tasks/public-task/comments/${commentId}`), {
            commentText: 'Another real comment',
            creatorId: MEMBER_ID,
            created: 2,
        })
        batch.set(
            doc(memberDb, 'emailNotifications/public-task'),
            {
                projectId: PROJECT_ID,
                objectType: 'tasks',
                chatType: 'tasks',
                objectId: 'public-task',
                commentId,
                creatorId: MEMBER_ID,
                userIds: arrayUnion(TEAMMATE_ID),
            },
            { merge: true }
        )

        await assertSucceeds(batch.commit())
    })

    it('does not allow a notification queue write without its author-owned comment', async () => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        await assertFails(
            setDoc(doc(memberDb, 'pushNotifications/forged-comment'), {
                projectId: PROJECT_ID,
                chatType: 'tasks',
                objectId: 'public-task',
                commentId: 'forged-comment',
                creatorId: MEMBER_ID,
                userIds: [TEAMMATE_ID],
            })
        )
    })

    it('lets the recipient clear its inbox while keeping email side channels server-owned', async () => {
        await testEnv.withSecurityRulesDisabled(async context => {
            const db = context.firestore()
            await setDoc(doc(db, `chatNotifications/${PROJECT_ID}/${MEMBER_ID}/comment-a`), {
                chatId: 'chat-a',
                followed: true,
            })
            await setDoc(doc(db, 'emailNotifications/chat-a'), {
                projectId: PROJECT_ID,
                objectId: 'chat-a',
                userIds: [MEMBER_ID],
            })
            await setDoc(doc(db, 'emailNotifications/other-chat'), {
                projectId: PROJECT_ID,
                objectId: 'other-chat',
                userIds: [TEAMMATE_ID],
            })
            await setDoc(doc(db, 'pushNotifications/push-a'), {
                projectId: PROJECT_ID,
                objectId: 'chat-a',
                userIds: [MEMBER_ID],
            })
            await setDoc(doc(db, `chatComments/${PROJECT_ID}/tasks/public-task/comments/queue-comment`), {
                commentText: 'Notification queue proof',
                creatorId: MEMBER_ID,
            })
            const queueProof = {
                projectId: PROJECT_ID,
                chatType: 'tasks',
                objectId: 'public-task',
                commentId: 'queue-comment',
                creatorId: MEMBER_ID,
                userIds: [MEMBER_ID],
            }
            await setDoc(doc(db, 'emailNotifications/public-task-security'), queueProof)
            await setDoc(doc(db, 'pushNotifications/queue-comment'), queueProof)
        })

        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const unreadSnapshot = await assertSucceeds(
            getDocs(
                query(
                    collection(memberDb, `chatNotifications/${PROJECT_ID}/${MEMBER_ID}`),
                    where('chatId', '==', 'chat-a')
                )
            )
        )
        await assertFails(
            getDocs(
                query(
                    collection(memberDb, 'emailNotifications'),
                    where('projectId', '==', PROJECT_ID),
                    where('userIds', 'array-contains', MEMBER_ID)
                )
            )
        )

        const batch = writeBatch(memberDb)
        unreadSnapshot.docs.forEach(snapshot => batch.delete(snapshot.ref))
        await assertSucceeds(batch.commit())
        await assertFails(
            updateDoc(doc(memberDb, 'emailNotifications/public-task-security'), { userIds: [OUTSIDER_ID] })
        )
        await assertFails(deleteDoc(doc(memberDb, 'emailNotifications/public-task-security')))
        await assertFails(updateDoc(doc(memberDb, 'pushNotifications/queue-comment'), { userIds: [OUTSIDER_ID] }))
        await assertFails(deleteDoc(doc(memberDb, 'pushNotifications/queue-comment')))
        await assertFails(getDoc(doc(memberDb, 'emailNotifications/missing-chat')))
    })
})

describe('explicit client collection coverage', () => {
    it.each([
        `projectsWorkstreams/${PROJECT_ID}/workstreams/default`,
        `goalsMilestones/${PROJECT_ID}/milestonesItems/milestone-a`,
        `feedsObjectsLastStates/${PROJECT_ID}/tasks/task-a`,
    ])('allows project members and denies outsiders at %s', async documentPath => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
        const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()

        await assertSucceeds(setDoc(doc(memberDb, documentPath), { value: true }))
        await assertSucceeds(getDoc(doc(memberDb, documentPath)))
        await assertFails(getDoc(doc(outsiderDb, documentPath)))
    })

    it.each([`subscriptionsPaidByOtherUser/${MEMBER_ID}`, `invoiceNumbers/customInvoiceNumber/users/${MEMBER_ID}`])(
        'keeps user-scoped state owner-only at %s',
        async documentPath => {
            const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()
            const outsiderDb = testEnv.authenticatedContext(OUTSIDER_ID).firestore()

            await assertSucceeds(setDoc(doc(memberDb, documentPath), { value: true }))
            await assertSucceeds(getDoc(doc(memberDb, documentPath)))
            await assertFails(getDoc(doc(outsiderDb, documentPath)))
        }
    )
})
