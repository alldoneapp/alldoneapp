/**
 * @jest-environment node
 */

const fs = require('fs')
const path = require('path')
const { assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing')
const {
    FieldPath,
    collection,
    doc,
    getDoc,
    getDocs,
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

let testEnv

const seed = async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
        const db = context.firestore()

        await setDoc(doc(db, `users/${MEMBER_ID}`), {
            projectIds: [PROJECT_ID],
            guideProjectIds: [],
            templateProjectIds: [],
            archivedProjectIds: [],
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
            readerIds: [MEMBER_ID],
            roleIdsVisibleTo: { [MEMBER_ID]: [MEMBER_ID] },
            backlinkIdsVisibleTo: { [MEMBER_ID]: [BACKLINK_TOKEN] },
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

    it('allows initial user and project creation only as one authoritative membership batch', async () => {
        const creatorId = 'new-user'
        const projectId = 'new-project'
        const creatorDb = testEnv.authenticatedContext(creatorId).firestore()
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
        expect(snapshot.docs.map(item => item.id).sort()).toEqual(['focus-task', 'private-task', 'public-task'])
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

describe('server-only data', () => {
    it.each([
        `userSecrets/${MEMBER_ID}/providers/google`,
        `assistants/${PROJECT_ID}/mcpSecrets/secret-a`,
        'assistantHeartbeatSchedules/schedule-a',
        'workflowAiRuns/run-a',
        `firestoreAccessProjectionJobs/${PROJECT_ID}`,
    ])('denies client reads and writes at %s', async documentPath => {
        const memberDb = testEnv.authenticatedContext(MEMBER_ID).firestore()

        await assertFails(getDoc(doc(memberDb, documentPath)))
        await assertFails(setDoc(doc(memberDb, documentPath), { secret: 'never-client-visible' }))
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
