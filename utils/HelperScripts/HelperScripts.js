import moment from 'moment'
import TasksHelper from '../components/TaskListView/Utils/TasksHelper'
import { forEach, uniq } from 'lodash'

export async function followTeamMembers(db) {
    const projects = (await db.collection('projects').get()).docs

    projects.forEach(projectDoc => {
        const batch = db.batch()
        const projectId = projectDoc.id
        const project = projectDoc.data()
        const { userIds } = project

        const users = {}
        userIds.forEach(userId => {
            users[userId] = true
        })

        userIds.forEach(userId => {
            batch.set(db.doc(`followers/${projectId}/users/${userId}`), { usersFollowing: userIds })
            batch.set(db.doc(`usersFollowing/${projectId}/entries/${userId}`), { users }, { merge: true })
        })
        batch.commit()
    })
}

export async function addSortIndexToTasks(db) {
    const projects = (await db.collection('projects').get()).docs
    projects.forEach(projectDoc => {
        addSortIndexToTasksInProject(projectDoc.id, db)
    })
}

async function addSortIndexToTasksInProject(projectId, db) {
    const tasks = (await db.collection(`items/${projectId}/tasks`).get()).docs
    let sortIndex = 1013447590823 //WE NEED A PAST TIME FOR FILLE THE INDEX IN 1000 SECONDS INTERVALE
    tasks.forEach(tasksDoc => {
        const taskId = tasksDoc.id
        sortIndex = sortIndex + 1000
        db.doc(`items/${projectId}/tasks/${taskId}`).update({ sortIndex })
    })
}

export async function addParentDoneAndUpdateCompleteToSubtasks() {
    const projects = (await db.collection('projects').get()).docs

    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(project.name)
        await addParentDoneAndUpdateCompleteToSubtasksInProject(project.id)
    }

    console.log('DONE')
}

async function addParentDoneAndUpdateCompleteToSubtasksInProject(projectId) {
    const tasks = (await db.collection(`items/${projectId}/tasks`).get()).docs
    const taskList = []
    tasks.forEach(tasksDoc => {
        const task = tasksDoc.data()
        task.id = tasksDoc.id
        taskList.push(task)
    })
    for (let i = 0; i < taskList.length; i++) {
        const task = taskList[i]
        const { subtaskIds, completed, done, parentId, userIds, id } = task

        /* if (parentId === undefined) {
            console.log(id)
            const taskUpdate = { parentId: null }

            db.doc(`items/${projectId}/tasks/${id}`).update(taskUpdate)
        }*/
        if (subtaskIds && subtaskIds.length > 0) {
            for (let m = 0; m < subtaskIds.length; m++) {
                const subtaskId = subtaskIds[m]
                //const subtask = (await db.doc(`items/${projectId}/tasks/${subtaskId}`).get()).data()
                //  console.log(subtask)

                /* if (!subtask) {
                    console.log(id)

                    const taskUpdate = { subtaskIds: firebase.firestore.FieldValue.arrayRemove(subtaskId) }
                    db.doc(`items/${projectId}/tasks/${id}`).update(taskUpdate)
                }*/

                /* if (task.completed) { //set complete first, but then comment this and completed evaluation for set the others fields
                    const subtaskUpdate = {
                        completed: task.completed,
                        userIds: task.userIds,
                        parentId: task.id,
                        dueDate: task.dueDate,
                        parentDone: task.done,
                        userId: task.userId,
                    }
                    console.log(subtaskId)
                    db.doc(`items/${projectId}/tasks/${subtaskId}`).update(subtaskUpdate)
                }*/
            }
        }
    }
}

export async function convertItemsTitlesToLowerCase(db) {
    const projects = (await db.collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let taskCount = 0
    let noteCount = 0
    let topicCount = 0
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        taskCount += await convertTasksTitlesToLowerCaseInProject(project.id, db)
        noteCount += await convertNotesTitlesToLowerCaseInProject(project.id, db)
        topicCount += await convertTopicsTitlesToLowerCaseInProject(project.id, db)
    }
    console.log(`TasksCount: ${taskCount}`)
    console.log(`NotesCount: ${noteCount}`)
    console.log(`TopicCount: ${topicCount}`)
    console.log('end')
}

async function convertTasksTitlesToLowerCaseInProject(projectId, db) {
    let taskCount = 0
    const tasks = (await db.collection(`items/${projectId}/tasks`).get()).docs
    const taskList = []
    tasks.forEach(tasksDoc => {
        const task = tasksDoc.data()
        task.id = tasksDoc.id
        taskList.push(task)
    })

    const updateTask = async task => {
        const { name, id } = task
        const taskUpdate = { name: name.toLowerCase() }
        db.doc(`items/${projectId}/tasks/${id}`).update(taskUpdate)
        console.log(name)
    }

    const promises = []

    for (let i = 0; i < taskList.length; i++) {
        const task = taskList[i]
        promises.push(updateTask(task))
        taskCount++
    }

    await Promise.all(promises)
    return taskCount
}

async function convertNotesTitlesToLowerCaseInProject(projectId, db) {
    let noteCount = 0
    const notes = (await db.collection(`noteItems/${projectId}/notes`).get()).docs
    const noteList = []
    notes.forEach(notesDoc => {
        const note = notesDoc.data()
        note.id = notesDoc.id
        noteList.push(note)
    })

    const updateNote = async note => {
        const { title, id } = note
        const noteUpdate = { title: title.toLowerCase() }
        db.doc(`noteItems/${projectId}/notes/${id}`).update(noteUpdate)
        console.log(title)
    }

    const promises = []

    for (let i = 0; i < noteList.length; i++) {
        const note = noteList[i]
        promises.push(updateNote(note))
        noteCount++
    }

    await Promise.all(promises)
    return noteCount
}

async function convertTopicsTitlesToLowerCaseInProject(projectId, db) {
    let topicCount = 0
    const topics = (await db.collection(`feedsObjectsLastStates/${projectId}/customs`).get()).docs
    const topicList = []
    topics.forEach(topicsDoc => {
        const topic = topicsDoc.data()
        topic.id = topicsDoc.id
        topicList.push(topic)
    })

    const updateTopic = async topic => {
        const { name, id } = topic
        const topicUpdate = { lowerCaseName: TasksHelper.getTaskNameWithoutMeta(name).toLowerCase() }
        db.doc(`feedsObjectsLastStates/${projectId}/customs/${id}`).update(topicUpdate)
        console.log(name)
    }

    const promises = []

    for (let i = 0; i < topicList.length; i++) {
        const topic = topicList[i]
        promises.push(updateTopic(topic))
        topicCount++
    }

    await Promise.all(promises)
    return topicCount
}

async function updateGoalsNameProperty(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { id, extendedName } = goal
            const cleanedTitle = getTaskNameWithoutMeta(extendedName)
            const goalUpdate = { name: cleanedTitle.toLowerCase() }
            appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update(goalUpdate)
            console.log(goal)
        }
    }
}

const getTaskNameWithoutMeta = taskName => {
    const words = taskName.split(' ')
    for (let i = 0; i < words.length; i++) {
        // sanitize mentions
        if (words[i].startsWith('@')) {
            const parts = words[i].split('#')
            if (parts.length === 2 && parts[1].trim().length >= 0) {
                words[i] = parts[0]
            } else {
                words[i] = words[i].replace(/M2mVOSjAVPPKweL/g, ' ')
            }
        }
    }
    return words.join(' ')
}

async function updateGoalsInDoneMilestoneProperty(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { id, milestoneId } = goal
            let goalUpdate

            if (milestoneId === `BACKLOG${project.id}`) {
                goalUpdate = { inDoneMilestone: false }
            } else {
                const milestone = (
                    await appAdmin
                        .firestore()
                        .doc(`/goalsMilestones/${project.id}/milestonesItems/${milestoneId}`)
                        .get()
                ).data()
                goalUpdate = { inDoneMilestone: milestone.done }
            }

            appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update(goalUpdate)
            console.log(goal)
        }
    }
}

async function updateGoalsSortIndexProperty(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (
            await appAdmin.firestore().collection(`goals/${project.id}/items`).orderBy('created', 'desc').get()
        ).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let initialMilliseconds = 100000
        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { id } = goal
            const goalUpdate = { sortIndex: initialMilliseconds }
            appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update(goalUpdate)
            initialMilliseconds--
            console.log(goal)
        }
    }
    console.log('done')
}

async function updateGoalsAssigneesCapacityProperty(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (
            await appAdmin.firestore().collection(`goals/${project.id}/items`).orderBy('created', 'desc').get()
        ).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { id, assigneesIds } = goal

            const goalUpdate = { assigneesCapacity: {} }
            assigneesIds.forEach(assigneeId => {
                goalUpdate.assigneesCapacity[assigneeId] = 'CAPACITY_NONE'
            })

            appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update(goalUpdate)
            console.log(goal)
        }
    }
    console.log('done')
}

async function updateGoalsMilestonesDoneDateProperty(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const milestones = (
            await appAdmin.firestore().collection(`goalsMilestones/${project.id}/milestonesItems`).get()
        ).docs
        const milestoneList = []
        milestones.forEach(doc => {
            const milestone = doc.data()
            milestone.id = doc.id
            milestoneList.push(milestone)
        })

        for (let i = 0; i < milestoneList.length; i++) {
            const milestone = milestoneList[i]
            const { id, date, doneDate } = milestone
            if (!doneDate) {
                appAdmin
                    .firestore()
                    .doc(`goalsMilestones/${project.id}/milestonesItems/${id}`)
                    .update({ doneDate: date })
            }
            console.log(goal)
        }
    }
    console.log('done')
}

async function updateGoalsHasStarProperty(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (
            await appAdmin.firestore().collection(`goals/${project.id}/items`).orderBy('created', 'desc').get()
        ).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { id, hasStar } = goal

            if (!hasStar) {
                appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({ hasStar: '#FFFFFF' })
            }

            console.log(goal)
        }
    }
    console.log('done')
}

async function updateTasksObserversProperty(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    console.log(`NUMBER OF PROJECTS: [ ${projects.length} ]`)

    const tasksPromises = []
    for (let projectDoc of projects) {
        const project = { ...projectDoc.data(), id: projectDoc.id }

        tasksPromises.push(appAdmin.firestore().collection(`items/${project.id}/tasks`).get())
    }

    await Promise.all(tasksPromises).then(async tasksPerProject => {
        for (let i = 0; i < tasksPerProject.length; i++) {
            const tasksDocs = tasksPerProject[i].docs
            console.log(`PROJECT No.: ${i + 1} / ${projects.length}`)
            console.log(`NUMBER OF TASKS FOR PROJECT No. ${i + 1} [ ${projects[i].id} ]: ${tasksDocs.length}`)

            const setTaskPromises = []
            let counterTasks = 0
            for (let taskDoc of tasksDocs) {
                const task = { ...taskDoc.data(), id: taskDoc.id }
                if (task.observersIds == null) {
                    counterTasks++
                    setTaskPromises.push(
                        console.log(`items/${projects[i].id}/tasks/${task.id}`)
                        // appAdmin
                        //     .firestore()
                        //     .doc(`items/${projects[i].id}/tasks/${task.id}`)
                        //     .update({ observersIds: [] })
                    )
                }
            }

            await Promise.all(setTaskPromises).then(() => {
                console.log(`Finish updating [ ${counterTasks} ] tasks for Project No. ${projects[i].id}`)
            })
        }
    })

    console.log('\n\n\n-----------------------------------')
    console.log('Operation Done !!!')
    console.log('-----------------------------------')
}

async function countRecords(appAdmin) {
    const db = appAdmin.firestore()
    const projects = (await db.collection('projects').get()).docs
    const projectsList = []

    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    const promises = []
    promises.push(db.collection(`users`).get())
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        promises.push(db.collection(`items/${project.id}/tasks`).get())
        promises.push(db.collection(`goalsMilestones/${project.id}/milestonesItems`).get())
        promises.push(db.collection(`goals/${project.id}/items`).get())
        promises.push(db.collection(`noteItems/${project.id}/notes`).get())
        promises.push(db.collection(`projectsContacts/${project.id}/contacts`).get())

        promises.push(db.collection(`feedsObjectsLastStates/${project.id}/customs`).get())

        promises.push(db.collection(`feedsObjectsLastStates/${project.id}/tasks`).get())
        promises.push(db.collection(`feedsObjectsLastStates/${project.id}/notes`).get())
        promises.push(db.collection(`feedsObjectsLastStates/${project.id}/goals`).get())
        promises.push(db.collection(`feedsObjectsLastStates/${project.id}/users`).get())
        promises.push(db.collection(`feedsObjectsLastStates/${project.id}/contacts`).get())
        promises.push(db.collection(`feedsObjectsLastStates/${project.id}/projects`).get())
    }

    let totalRecords = 0
    let count = 0
    await Promise.all(promises).then(groups => {
        for (let recordsGroup of groups) {
            totalRecords += recordsGroup.docs.length
            /*  console.log('-------------------------------------------------')
            console.log(`Name: ${projectsList[count].name}`)
            console.log(`ID: ${projectsList[count].id}`)
            console.log(`RECORDS: ${recordsGroup.docs.length}`)
            console.log(`NEW RECORDS TOTAL: ${totalRecords}`)
            count++*/
        }
    })
    console.log('-------------------------------------------------')
    console.log(`TOTAL RECORDS: ${totalRecords}`)
    console.log('-------------------------------------------------')
}

async function searchProblematicSubtasks(appAdmin) {
    const tasks = (
        await appAdmin
            .firestore()
            .collection(`items/jFVk3zgf3DNsVzYhhMSg/tasks`)
            .where('userId', '==', 'lejVqrT6FBcMRRCxnBbBhQwPgSg1')
            .get()
    ).docs
    const tasksList = new Map()
    const subtaskList = new Map()
    const problematic = new Map()
    tasks.forEach(taskDoc => {
        const task = taskDoc.data()
        task.id = taskDoc.id
        tasksList.set(task.id, task)
        if (task.parentId != null) {
            subtaskList.set(task.id, task)
        }
    })

    Array.from(subtaskList.values()).forEach(task => {
        if (
            (task.parentDone && (!tasksList.has(task.parentId) || !tasksList.get(task.parentId).done)) ||
            (!task.parentDone && (!tasksList.has(task.parentId) || tasksList.get(task.parentId).done))
        ) {
            problematic.set(task.id, task)
        }
    })

    const serializedUsers = JSON.stringify(Array.from(problematic.values()), null, 2)
    // if (option === EXPORT_OPTION_SAVE) {
    //     helperFn.writeFile(file, serializedUsers)
    // }

    console.log('\n\n\n-----------------------------------')
    console.log('Operation Done !!!' + problematic.size)
    console.log('-----------------------------------')
}

async function loadTaskToAlgolia(appAdmin) {
    const db = appAdmin.firestore()
    loadDataToAlgolia(db).then(() => {
        console.log('DONE')
    })
}

async function processNotesForRevisionHistory(appAdmin) {
    //INSTRUCTIONS
    //1-FOR PRODUCTION NEED TO CHANGE THE BUCKET NAME
    //2-FOR COMMUNITY NEED TO CHANGE THE PROJECTS QUERY
    //3-FOR COMMUNITY NEED TO CHANGE THE NOTES PATH
    //4-FOR COMMUNITY NEED TO CHANGE IN getPaths THE VALUE PASSED WITH TRUE

    const notes_bucket_name = 'notescontentdev'
    //const notes_bucket_name="notescontentprod"

    const notesBucket = appAdmin.storage().bucket(notes_bucket_name)
    const versionsBucket = appAdmin.storage().bucket()

    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    //const projects = (await appAdmin.firestore().collection('communities').get()).docs

    const path = 'noteItems'
    //const path = 'communityNotes'

    const projectsList = []
    let promises = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
        promises.push(appAdmin.firestore().collection(`${path}/${projectId}/notes`).get())
    })
    const promisesResults = await Promise.all(promises)

    promises = []
    for (let n = 0; n < promisesResults.length; n++) {
        const projectId = projectsList[n].id
        const notesDocs = promisesResults[n].docs
        const notesList = []
        notesDocs.forEach(doc => {
            const note = doc.data()
            note.id = doc.id
            notesList.push(note)
        })

        for (let i = 0; i < notesList.length; i++) {
            const note = notesList[i]
            const { id } = note
            const versionDate = Date.now()
            const noteCopy = { ...note, versionDate }
            delete noteCopy.id
            promises.push(appAdmin.firestore().doc(`${path}/${projectId}/notes/${id}`).update({ versionId: '-1' }))
            promises.push(
                createCopy(versionsBucket, notesBucket, projectId, id, noteCopy, appAdmin.firestore(), getPaths(false))
            )
        }
    }
    await Promise.all(promises)

    console.log('done')
}

const notesPaths = {
    noteItems: 'noteItems',
    notesData: 'notesData',
    noteItemsVersions: 'noteItemsVersions',
    noteVersionsData: 'noteVersionsData',
    noteItemsDailyVersions: 'noteItemsDailyVersions',
    noteDailyVersionsData: 'noteDailyVersionsData',
}

const communityNotesPaths = {
    noteItems: 'communityNotes',
    notesData: 'communityNotesData',
    noteItemsVersions: 'communityNoteItemsVersions',
    noteVersionsData: 'communityNoteVersionsData',
    noteItemsDailyVersions: 'communityNoteItemsDailyVersions',
    noteDailyVersionsData: 'communityNoteDailyVersionsData',
}

const getPaths = isCommunity => {
    return isCommunity ? communityNotesPaths : notesPaths
}

const createCopy = async (versionsBucket, notesBucket, projectId, noteId, noteMetaData, db, paths) => {
    const noteContentFile = notesBucket.file(`${paths.notesData}/${projectId}/${noteId}`)
    const exist = await noteContentFile.exists()

    if (exist[0]) {
        const versionId = uuid() //ADDD THIS
        const versionPath = `gs://${versionsBucket.name}/${paths.noteVersionsData}/${projectId}/${noteId}/${versionId}`
        const versionDate = Date.now()
        const promises = []
        promises.push(noteContentFile.copy(versionPath))
        promises.push(
            db
                .doc(`${paths.noteItemsVersions}/${projectId}/${noteId}/${versionId}`)
                .set({ ...noteMetaData, versionDate })
        )
        await Promise.all(promises)
    } else {
        console.log('false')
    }
}

async function cleanMissedNoteCopiesParts(appAdmin) {
    const RUN_FOR_COMMUNITY = true

    const db = appAdmin.firestore()
    const versionsBucket = appAdmin.storage().bucket()

    const notesPaths = {
        projects: 'projects',
        noteItems: 'noteItems',
        notesData: 'notesData',
        noteItemsVersions: 'noteItemsVersions',
        noteVersionsData: 'noteVersionsData',
        noteItemsDailyVersions: 'noteItemsDailyVersions',
        noteDailyVersionsData: 'noteDailyVersionsData',
    }

    const communityNotesPaths = {
        projects: 'communities',
        noteItems: 'communityNotes',
        notesData: 'communityNotesData',
        noteItemsVersions: 'communityNoteItemsVersions',
        noteVersionsData: 'communityNoteVersionsData',
        noteItemsDailyVersions: 'communityNoteItemsDailyVersions',
        noteDailyVersionsData: 'communityNoteDailyVersionsData',
    }

    const paths = RUN_FOR_COMMUNITY ? communityNotesPaths : notesPaths

    const projects = (await db.collection(paths.projects).get()).docs

    const projectsList = []
    let promises = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
        promises.push(db.collection(`${paths.noteItems}/${projectId}/notes`).get())
    })
    const promisesResults = await Promise.all(promises)

    for (let n = 0; n < promisesResults.length; n++) {
        const projectId = projectsList[n].id
        const notesDocs = promisesResults[n].docs
        console.log(notesDocs.length)
        const notesList = []
        notesDocs.forEach(doc => {
            const note = doc.data()
            note.id = doc.id
            notesList.push(note)
        })

        for (let i = 0; i < notesList.length; i++) {
            const note = notesList[i]
            const noteId = note.id

            promises = []
            promises.push(
                versionsBucket.getFiles({
                    prefix: `${paths.noteVersionsData}/${projectId}/${noteId}/`,
                })
            )
            promises.push(db.collection(`${paths.noteItemsVersions}/${projectId}/${noteId}`).get())
            const results = await Promise.all(promises)
            const versionsData = results[0][0]
            const versionsMetaDataDocs = results[1].docs

            const dataVersionsIds = []
            for (let n = 0; n < versionsData.length; n++) {
                const file = versionsData[n]
                const versionId = file.metadata.name.split('/').slice(-1).toString()
                dataVersionsIds.push(versionId)
            }

            const metaDataVersionsIds = []
            for (let n = 0; n < versionsMetaDataDocs.length; n++) {
                const versionId = versionsMetaDataDocs[n].id
                metaDataVersionsIds.push(versionId)
            }

            const toDeleteDataVersionsIds = dataVersionsIds.filter(item => !metaDataVersionsIds.includes(item))
            const toDeleteMetaDataVersionsIds = metaDataVersionsIds.filter(item => !dataVersionsIds.includes(item))

            if (toDeleteDataVersionsIds.length > 0) {
                console.log('DATA VERSIONS')
                console.log(toDeleteDataVersionsIds)
            }
            if (toDeleteMetaDataVersionsIds.length > 0) {
                console.log('META VERSIONS')
                console.log(toDeleteMetaDataVersionsIds)
            }

            promises = []
            for (let n = 0; n < toDeleteDataVersionsIds.length; n++) {
                const versionId = toDeleteDataVersionsIds[n]
                const file = versionsBucket.file(`${paths.noteVersionsData}/${projectId}/${noteId}/${versionId}`)
                promises.push(file.delete())
            }
            for (let n = 0; n < toDeleteMetaDataVersionsIds.length; n++) {
                const versionId = toDeleteMetaDataVersionsIds[n]
                promises.push(db.doc(`${paths.noteItemsVersions}/${projectId}/${noteId}/${versionId}`).delete())
            }
            await Promise.all(promises)
        }
    }

    console.log('done')
}

////////////////

async function setIsPublicForInNotes(appAdmin) {
    const RUN_FOR_COMMUNITY = false

    const notesPaths = {
        projects: 'projects',
        noteItems: 'noteItems',
    }

    const communityNotesPaths = {
        projects: 'communities',
        noteItems: 'communityNotes',
    }

    const paths = RUN_FOR_COMMUNITY ? communityNotesPaths : notesPaths

    const projects = (await appAdmin.firestore().collection(paths.projects).get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const projectId = projectsList[i].id
        promises.push(appAdmin.firestore().collection(`${paths.noteItems}/${projectId}/notes`).get())
    }
    const promisesResults = await Promise.all(promises)

    promises = []
    for (let i = 0; i < promisesResults.length; i++) {
        const projectId = projectsList[i].id
        const notesDocs = promisesResults[i].docs

        for (let n = 0; n < notesDocs.length; n++) {
            const noteId = notesDocs[n].id
            const note = notesDocs[n].data()
            const { isPrivate, isPublicFor } = note
            const updateData = {}

            if (RUN_FOR_COMMUNITY) {
                updateData.isPrivate = false
                updateData.isPublicFor = [0]
            } else {
                if (isPrivate === true) {
                    if (!isPublicFor || !isPublicFor.length) {
                        updateData.isPrivate = false
                        updateData.isPublicFor = admin.firestore.FieldValue.arrayUnion(0)
                    } else {
                        if (isPublicFor.includes(0)) {
                            if (isPublicFor.length === 1) {
                                updateData.isPrivate = false
                            } else {
                                updateData.isPublicFor = admin.firestore.FieldValue.arrayRemove(0)
                            }
                        }
                    }
                } else if (isPrivate === false) {
                    updateData.isPublicFor = admin.firestore.FieldValue.arrayUnion(0)
                } else {
                    updateData.isPrivate = false
                    updateData.isPublicFor = admin.firestore.FieldValue.arrayUnion(0)
                }
            }

            const needToBeUpdated = Object.keys(updateData).length > 0
            if (needToBeUpdated) {
                promises.push(
                    appAdmin.firestore().doc(`${paths.noteItems}/${projectId}/notes/${noteId}`).update(updateData)
                )
            }
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function setLastEditedInNotes(appAdmin) {
    const RUN_FOR_COMMUNITY = false

    const notesPaths = {
        projects: 'projects',
        noteItems: 'noteItems',
    }

    const communityNotesPaths = {
        projects: 'communities',
        noteItems: 'communityNotes',
    }

    const paths = RUN_FOR_COMMUNITY ? communityNotesPaths : notesPaths

    const projects = (await appAdmin.firestore().collection(paths.projects).get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const projectId = projectsList[i].id
        promises.push(appAdmin.firestore().collection(`${paths.noteItems}/${projectId}/notes`).get())
    }
    const promisesResults = await Promise.all(promises)

    promises = []
    for (let i = 0; i < promisesResults.length; i++) {
        const projectId = projectsList[i].id
        const notesDocs = promisesResults[i].docs

        const defaultTimestamp = moment('01-01-1970', 'DD-MM-YYYY').valueOf()

        const defaultName = 'Unknown'
        for (let n = 0; n < notesDocs.length; n++) {
            const noteId = notesDocs[n].id
            const note = notesDocs[n].data()
            const { lastEdited } = note
            let updateData = {}

            if (lastEdited) {
                const needEditTimestamp =
                    !lastEdited.timestamp || isNaN(lastEdited.timestamp) || lastEdited.timestamp < defaultTimestamp
                const needEditUserName = !lastEdited.userName

                if (needEditTimestamp && needEditUserName) {
                    updateData.lastEdited = { timestamp: defaultTimestamp, userName: defaultName }
                } else {
                    if (needEditTimestamp) {
                        updateData.lastEdited = { ...lastEdited, timestamp: defaultTimestamp }
                    }
                    if (needEditUserName) {
                        updateData.lastEdited = { ...lastEdited, userName: defaultName }
                    }
                }
            } else {
                updateData.lastEdited = { timestamp: defaultTimestamp, userName: defaultName }
            }

            const needToBeUpdated = Object.keys(updateData).length > 0
            if (needToBeUpdated) {
                promises.push(
                    appAdmin.firestore().doc(`${paths.noteItems}/${projectId}/notes/${noteId}`).update(updateData)
                )
            }
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function setFollowersIdsInNotes(appAdmin) {
    const RUN_FOR_COMMUNITY = false

    const notesPaths = {
        projects: 'projects',
        noteItems: 'noteItems',
    }

    const communityNotesPaths = {
        projects: 'communities',
        noteItems: 'communityNotes',
    }

    async function getObjectFollowersIds(projectId, objectsType, objectId, appAdmin) {
        const followersIds = (
            await appAdmin.firestore().doc(`followers/${projectId}/${objectsType}/${objectId}`).get()
        ).data()
        return followersIds && followersIds.usersFollowing ? followersIds.usersFollowing : []
    }

    const paths = RUN_FOR_COMMUNITY ? communityNotesPaths : notesPaths

    const projects = (await appAdmin.firestore().collection(paths.projects).get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const projectId = projectsList[i].id
        promises.push(appAdmin.firestore().collection(`${paths.noteItems}/${projectId}/notes`).get())
    }
    const promisesResults = await Promise.all(promises)

    promises = []
    for (let i = 0; i < promisesResults.length; i++) {
        const projectId = projectsList[i].id
        const notesDocs = promisesResults[i].docs

        const followersPromises = []
        for (let n = 0; n < notesDocs.length; n++) {
            const noteId = notesDocs[n].id
            followersPromises.push(getObjectFollowersIds(projectId, 'notes', noteId, appAdmin))
        }
        const projectFollowersIds = await Promise.all(followersPromises)

        for (let n = 0; n < notesDocs.length; n++) {
            const noteId = notesDocs[n].id
            const note = notesDocs[n].data()
            const noteFollowersIds = projectFollowersIds[n]
            let updateData = { followersIds: noteFollowersIds }
            const needToBeUpdated = Object.keys(updateData).length > 0
            if (needToBeUpdated) {
                promises.push(
                    appAdmin.firestore().doc(`${paths.noteItems}/${projectId}/notes/${noteId}`).update(updateData)
                )
            }
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function setIsVisibleInFollowedForInNotes(appAdmin) {
    const RUN_FOR_COMMUNITY = false

    const notesPaths = {
        projects: 'projects',
        noteItems: 'noteItems',
    }

    const communityNotesPaths = {
        projects: 'communities',
        noteItems: 'communityNotes',
    }

    const paths = RUN_FOR_COMMUNITY ? communityNotesPaths : notesPaths

    const projects = (await appAdmin.firestore().collection(paths.projects).get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const projectId = projectsList[i].id
        promises.push(appAdmin.firestore().collection(`${paths.noteItems}/${projectId}/notes`).get())
    }
    const promisesResults = await Promise.all(promises)

    promises = []
    for (let i = 0; i < promisesResults.length; i++) {
        const projectId = projectsList[i].id
        const notesDocs = promisesResults[i].docs

        for (let n = 0; n < notesDocs.length; n++) {
            const noteId = notesDocs[n].id
            const note = notesDocs[n].data()
            const { isPublicFor, followersIds } = note
            let updateData = {}
            const isVisibleInFollowedFor = []

            for (let i = 0; i < followersIds.length; i++) {
                const followerId = followersIds[i]
                if (isPublicFor.includes(0) || isPublicFor.includes(followerId)) {
                    isVisibleInFollowedFor.push(followerId)
                }
            }

            updateData.isVisibleInFollowedFor = isVisibleInFollowedFor

            const needToBeUpdated = Object.keys(updateData).length > 0
            if (needToBeUpdated) {
                promises.push(
                    appAdmin.firestore().doc(`${paths.noteItems}/${projectId}/notes/${noteId}`).update(updateData)
                )
            }
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function setStickyDataInNotes(appAdmin) {
    const RUN_FOR_COMMUNITY = false

    const notesPaths = {
        projects: 'projects',
        noteItems: 'noteItems',
    }

    const communityNotesPaths = {
        projects: 'communities',
        noteItems: 'communityNotes',
    }

    const paths = RUN_FOR_COMMUNITY ? communityNotesPaths : notesPaths

    const projects = (await appAdmin.firestore().collection(paths.projects).get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const projectId = projectsList[i].id
        promises.push(appAdmin.firestore().collection(`${paths.noteItems}/${projectId}/notes`).get())
    }
    const promisesResults = await Promise.all(promises)

    promises = []
    for (let i = 0; i < promisesResults.length; i++) {
        const projectId = projectsList[i].id
        const notesDocs = promisesResults[i].docs

        for (let n = 0; n < notesDocs.length; n++) {
            const noteId = notesDocs[n].id
            const note = notesDocs[n].data()
            const { stickyData } = note
            let updateData = {}

            if (stickyData) {
                const hasStickyEndDate = !isNaN(stickyData.stickyEndDate)
                if (hasStickyEndDate) {
                    if (stickyData.stickyEndDate > 0) {
                        promises.push(
                            appAdmin
                                .firestore()
                                .doc(`stickyNotesData/${noteId}`)
                                .set({ projectId, stickyEndDate: stickyData.stickyEndDate })
                        )
                    }
                } else {
                    const hasDays = !isNaN(stickyData.days) && stickyData.days > 0
                    const hasStickedOn = !isNaN(stickyData.stickedOn)
                    if (hasDays && hasStickedOn) {
                        const stickyEndDate = moment(stickyData.stickedOn).add(stickyData.days, 'days').valueOf()
                        updateData.stickyData = { stickyEndDate: stickyEndDate, days: stickyData.days }
                        promises.push(
                            appAdmin
                                .firestore()
                                .doc(`stickyNotesData/${noteId}`)
                                .set({ projectId, stickyEndDate: stickyEndDate })
                        )
                    } else {
                        updateData.stickyData = { stickyEndDate: 0, days: 0 }
                    }
                }
            } else {
                updateData.stickyData = { stickyEndDate: 0, days: 0 }
            }
            const needToBeUpdated = Object.keys(updateData).length > 0
            if (needToBeUpdated) {
                promises.push(
                    appAdmin.firestore().doc(`${paths.noteItems}/${projectId}/notes/${noteId}`).update(updateData)
                )
            }
        }
    }
    await Promise.all(promises)
    console.log('done')
}

//TASKS SYSTEM SCRIPTS

async function updateIsSubtaskPropertyTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projects.length; i++) {
        const promises = []
        const project = projects[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        tasksDoc.forEach(doc => {
            const task = doc.data()
            promises.push(
                appAdmin
                    .firestore()
                    .doc(`items/${project.id}/tasks/${doc.id}`)
                    .update({ isSubtask: !task.parentId ? false : true })
            )
        })
        await Promise.all(promises)
    }

    console.log('DONE')
}

async function updateSubtaskWorkflowPropertiesTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projects.length; i++) {
        const promises = []
        const project = projects[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs

        const subtasks = []

        tasksDoc.forEach(doc => {
            const task = doc.data()
            if (task.parentId) {
                subtasks.push({ ...task, id: doc.id })
            }
        })

        for (let n = 0; n < subtasks.length; n++) {
            const subtask = subtasks[n]
            const parentTask = (
                await appAdmin.firestore().doc(`items/${project.id}/tasks/${subtask.parentId}`).get()
            ).data()
            if (parentTask) {
                if (parentTask.completed === undefined) {
                    promises.push(
                        appAdmin.firestore().doc(`items/${project.id}/tasks/${subtask.parentId}`).update({
                            completed: null,
                        })
                    )
                }
                promises.push(
                    appAdmin
                        .firestore()
                        .doc(`items/${project.id}/tasks/${subtask.id}`)
                        .update({
                            userId: parentTask.userId,
                            completed: parentTask.completed === undefined ? null : parentTask.completed,
                            userIds: parentTask.userIds,
                            stepHistory: parentTask.stepHistory,
                            dueDate: parentTask.dueDate,
                            parentDone: parentTask.done,
                        })
                )
            }
        }
        await Promise.all(promises)
    }

    console.log('DONE')
}

async function updateCompletePropertyInOpenTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const promises = []
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs

        tasksDoc.forEach(doc => {
            const task = doc.data()

            if (!task.userIds) {
                console.log(`ProjectID: ${project.id} TaskID: ${doc.id}`)
                /*  promises.push(
                                appAdmin
                                    .firestore()
                                    .doc(`items/${project.id}/tasks/${doc.id}`)
                                    .update({ userIds: [task.userId], stepHistory: [-1] })
                            )*/
            } else {
                const taskIsOpen = task.done === false && task.userIds.length === 1
                const taskIsWorkflow = task.done === false && task.userIds.length > 1
                const taskIsDone = task.done === true
                const isNotSubtask = !task.parentId
                if (taskIsOpen) {
                    if (isNotSubtask) {
                        promises.push(
                            appAdmin.firestore().doc(`items/${project.id}/tasks/${doc.id}`).update({ completed: null })
                        )
                    }
                } else if (taskIsWorkflow) {
                    if (isNotSubtask && !task.completed) {
                        const completed = moment().subtract(365, 'days').valueOf()
                        promises.push(
                            appAdmin.firestore().doc(`items/${project.id}/tasks/${doc.id}`).update({ completed })
                        )
                        console.log('THIS WORKFLOW TASKS NEED TO HAVE COMPLETE PROPERTY')
                    }
                } else if (taskIsDone) {
                    if (isNotSubtask && !task.completed) {
                        const completed = moment().subtract(365, 'days').valueOf()
                        promises.push(
                            appAdmin.firestore().doc(`items/${project.id}/tasks/${doc.id}`).update({ completed })
                        )
                        console.log('THIS DONE TASK NEED TO HAVE COMPLETE PROPERTY')
                    }
                }
            }
        })
        await Promise.all(promises)
    }
    console.log('DONE')
}

//THIS IS ONLY NEEDED IF WE NOT HAVE USERIDS WITH SOME VALUE
async function updateUserIdsPropertyInTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    const promises = []

    for (let i = 0; i < projects.length; i++) {
        const project = projects[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs

        tasksDoc.forEach(doc => {
            const task = doc.data()
            const { userId, userIds, subtaskIds } = task
            if (!userIds) {
                promises.push(
                    appAdmin
                        .firestore()
                        .doc(`items/${project.id}/tasks/${doc.id}`)
                        .update({
                            userIds: [userId],
                            stepHistory: [-1],
                            done: false,
                            currentReviewerId: userId,
                        })
                )
                if (subtaskIds && subtaskIds.length > 0) {
                    subtaskIds.forEach(subtaskId => {
                        promises.push(
                            appAdmin
                                .firestore()
                                .doc(`items/${project.id}/tasks/${subtaskId}`)
                                .update({
                                    userIds: [userId],
                                    stepHistory: [-1],
                                    parentDone: false,
                                    currentReviewerId: userId,
                                })
                        )
                    })
                }
            }
        })
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function addCurrentReviewerIdPropertyToTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    //647
    const DONE_STEP = -2

    let promises = []

    for (let i = 0; i < 647; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)
        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const isSubtask = !!task.parentId
            const inDone = (isSubtask && task.parentDone) || (!isSubtask && task.done)
            const currentReviewerId = inDone ? DONE_STEP : task.userIds[task.userIds.length - 1]

            if (!task.currentReviewerId) {
                promises.push(
                    appAdmin.firestore().doc(`items/${project.id}/tasks/${task.id}`).update({ currentReviewerId })
                )
            }

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function updateInBacklogPropertyInTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    //647
    let promises = []

    for (let i = 100; i < 400; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { inBacklog } = task

            if (inBacklog !== false && inBacklog !== true) {
                promises.push(
                    appAdmin.firestore().doc(`items/${project.id}/tasks/${task.id}`).update({ inBacklog: false })
                )
            }

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function updateInBacklogPropertyInSubtasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { inBacklog, subtaskIds } = task

            if (subtaskIds && subtaskIds.length > 0) {
                subtaskIds.forEach(subtaskId => {
                    promises.push(
                        appAdmin.firestore().doc(`items/${project.id}/tasks/${subtaskId}`).update({ inBacklog })
                    )
                })
            }

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function updateObserversIdsPropertyInTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { observersIds } = task

            if (!observersIds) {
                promises.push(
                    appAdmin.firestore().doc(`items/${project.id}/tasks/${task.id}`).update({ observersIds: [] })
                )
            }

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function updateObserversIdsPropertyInSubtasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)

    let promises = []

    for (let i = 0; i < projects.length; i++) {
        const project = projects[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { observersIds, subtaskIds } = task

            if (subtaskIds && subtaskIds.length > 0) {
                subtaskIds.forEach(subtaskId => {
                    promises.push(
                        appAdmin.firestore().doc(`items/${project.id}/tasks/${subtaskId}`).update({ observersIds })
                    )
                })
            }

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}
//END TASKS SYSTEM SCRIPTS

async function addDueDateByObserversIdsAndInBacklogByObserversIdsInTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { observersIds, subtaskIds } = task

            const dueDateByObserversIds = {}
            const inBacklogByObserversIds = {}

            if (observersIds && observersIds.length > 0) {
                for (let m = 0; m < observersIds.length; m++) {
                    const observerId = observersIds[m]
                    dueDateByObserversIds[observerId] = moment().valueOf()
                    inBacklogByObserversIds[observerId] = false
                }
            }

            promises.push(
                appAdmin
                    .firestore()
                    .doc(`items/${project.id}/tasks/${task.id}`)
                    .update({ dueDateByObserversIds, inBacklogByObserversIds })
            )
            if (subtaskIds && subtaskIds.length > 0) {
                subtaskIds.forEach(subtaskId => {
                    promises.push(
                        appAdmin
                            .firestore()
                            .doc(`items/${project.id}/tasks/${subtaskId}`)
                            .update({ observersIds, dueDateByObserversIds, inBacklogByObserversIds })
                    )
                })
            }

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function updateGoalsAssigneesCapacityProperty(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (
            await appAdmin.firestore().collection(`goals/${project.id}/items`).orderBy('created', 'desc').get()
        ).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { id, assigneesCapacity } = goal

            if (assigneesCapacity) {
                const assigneesIds = Object.keys(assigneesCapacity)
                const assigneesCapacityUpdated = { ...assigneesCapacity }

                assigneesIds.forEach(assigneeId => {
                    if (assigneesCapacityUpdated[assigneeId] === 'CAPACITY_2_HOURS') {
                        assigneesCapacityUpdated[assigneeId] = 'XXS'
                    } else if (assigneesCapacityUpdated[assigneeId] === 'CAPACITY_HALF_DAY') {
                        assigneesCapacityUpdated[assigneeId] = 'XS'
                    } else if (assigneesCapacityUpdated[assigneeId] === 'CAPACITY_1_DAY') {
                        assigneesCapacityUpdated[assigneeId] = 'S'
                    } else if (assigneesCapacityUpdated[assigneeId] === 'CAPACITY_2_DAYS') {
                        assigneesCapacityUpdated[assigneeId] = 'M'
                    } else if (assigneesCapacityUpdated[assigneeId] === 'CAPACITY_3_4_DAYS') {
                        assigneesCapacityUpdated[assigneeId] = 'L'
                    } else if (assigneesCapacityUpdated[assigneeId] === 'CAPACITY_1_WEEK') {
                        assigneesCapacityUpdated[assigneeId] = 'XL'
                    } else if (assigneesCapacityUpdated[assigneeId] === 'CAPACITY_2_WEEKS') {
                        assigneesCapacityUpdated[assigneeId] = 'XXL'
                    }
                })

                appAdmin
                    .firestore()
                    .doc(`goals/${project.id}/items/${id}`)
                    .update({ assigneesCapacity: assigneesCapacityUpdated })
            }
        }
    }
    console.log('done')
}

///////////////IN THIS MERGE

async function setDescriptionPropertyInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (
            await appAdmin.firestore().collection(`goals/${project.id}/items`).orderBy('created', 'desc').get()
        ).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { id } = goal

            appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({ description: '' })
        }
    }
    console.log('done')
}

async function setParentGoalIdProperty() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]

            promises.push(
                appAdmin.firestore().doc(`items/${project.id}/tasks/${task.id}`).update({ parentGoalId: null })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

//LASTTTTTTTTTTS

async function setChildrenTasksAmountPropertyInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (
            await appAdmin.firestore().collection(`goals/${project.id}/items`).orderBy('created', 'desc').get()
        ).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { id } = goal

            const childrenTasksAmount = {}

            const childrenTasksDocs = (
                await appAdmin.firestore().collection(`items/${project.id}/tasks`).where('parentGoalId', '==', id).get()
            ).docs

            childrenTasksDocs.forEach(taskDoc => {
                const task = taskDoc.data()
                childrenTasksAmount[task.userId] !== null && childrenTasksAmount[task.userId] !== undefined
                    ? childrenTasksAmount[task.userId]++
                    : (childrenTasksAmount[task.userId] = 1)
            })

            appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({ childrenTasksAmount })
        }
    }
    console.log('done')
}

async function setAssigneesReminderDatePropertyInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { id, assigneesIds } = goal
            const assigneesReminderDate = {}
            if (assigneesIds) {
                assigneesIds.forEach(assigneeId => {
                    assigneesReminderDate[assigneeId] = Date.now()
                })
            }
            appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({ assigneesReminderDate })
        }
    }
    console.log('done')
}

async function setParentStreamIdPropertyInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        console.log(`${project.name}:   ${goalsList.length} Goals`)

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { id } = goal
            appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({ parentStreamId: 'ws@default' })
        }
    }
    console.log('DONE ================================')
}

////////////////// NEW DATE RANGES IN GOALS SCRIPTS

async function setMilestoneIdPropertyInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        const BACKLOG_MILESTONE_ID = 'BACKLOG'
        const backlogId = `${BACKLOG_MILESTONE_ID}${project.id}`

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { milestoneId, id } = goal
            if (!milestoneId) {
                appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({ milestoneId: backlogId })
            }
        }
    }
    console.log('done')
}

async function setDateRangePropertiesInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        const BACKLOG_DATE_NUMERIC = Number.MAX_SAFE_INTEGER
        const BACKLOG_MILESTONE_ID = 'BACKLOG'
        const backlogId = `${BACKLOG_MILESTONE_ID}${project.id}`

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { milestoneId, id } = goal

            if (milestoneId === backlogId) {
                appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({
                    startingMilestoneDate: BACKLOG_DATE_NUMERIC,
                    completionMilestoneDate: BACKLOG_DATE_NUMERIC,
                })
            } else {
                const milestone = (
                    await appAdmin.firestore().doc(`goalsMilestones/${project.id}/milestonesItems/${milestoneId}`).get()
                ).data()
                const date = milestone && milestone.date ? milestone.date : BACKLOG_DATE_NUMERIC
                appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({
                    startingMilestoneDate: date,
                    completionMilestoneDate: date,
                })
            }
        }
    }
    console.log('done')
}

async function setParentDoneMilestoneIdsPropertiesInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        const BACKLOG_MILESTONE_ID = 'BACKLOG'
        const backlogId = `${BACKLOG_MILESTONE_ID}${project.id}`

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { milestoneId, id } = goal

            if (milestoneId === backlogId) {
                appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({ parentDoneMilestoneIds: [] })
            } else {
                const milestone = (
                    await appAdmin.firestore().doc(`goalsMilestones/${project.id}/milestonesItems/${milestoneId}`).get()
                ).data()
                const parentDoneMilestoneIds = milestone && milestone.done ? [milestoneId] : []
                appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({ parentDoneMilestoneIds })
            }
        }
    }
    console.log('done')
}

async function setProgressByDoneMilestonePropertiesInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        const BACKLOG_MILESTONE_ID = 'BACKLOG'
        const backlogId = `${BACKLOG_MILESTONE_ID}${project.id}`

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { milestoneId, id } = goal

            if (milestoneId === backlogId) {
                appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({ progressByDoneMilestone: {} })
            } else {
                const milestone = (
                    await appAdmin.firestore().doc(`goalsMilestones/${project.id}/milestonesItems/${milestoneId}`).get()
                ).data()
                const progressByDoneMilestone = milestone && milestone.done ? { [milestoneId]: goal.progress } : {}
                appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({ progressByDoneMilestone })
            }
        }
    }
    console.log('done')
}

async function setSortIndexByMilestonePropertiesInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let sortKey = 0
        function generateSortIndex() {
            let newSortKey = moment().valueOf()
            if (sortKey >= newSortKey) {
                newSortKey = sortKey + 1
            }
            sortKey = newSortKey
            return newSortKey
        }

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { milestoneId, id } = goal

            if (milestoneId) {
                appAdmin
                    .firestore()
                    .doc(`goals/${project.id}/items/${id}`)
                    .update({ sortIndexByMilestone: { [milestoneId]: generateSortIndex() } })
            }
        }
    }
    console.log('done')
}

async function removeOldPropertiesInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goals = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs
        const goalsList = []
        goals.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { id } = goal
            appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({
                sortIndex: admin.firestore.FieldValue.delete(),
                inDoneMilestone: admin.firestore.FieldValue.delete(),
                milestoneId: admin.firestore.FieldValue.delete(),
            })
        }
    }
    console.log('done')
}

async function setDateByDoneMilestonePropertiesInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs
        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        for (let i = 0; i < goalsList.length; i++) {
            const goal = goalsList[i]
            const { id, parentDoneMilestoneIds } = goal

            const promises = []
            parentDoneMilestoneIds.forEach(milestoneId => {
                promises.push(
                    appAdmin.firestore().doc(`goalsMilestones/${project.id}/milestonesItems/${milestoneId}`).get()
                )
            })
            const milestonesDocs = await Promise.all(promises)

            const dateByDoneMilestone = {}
            milestonesDocs.forEach(doc => {
                const milestone = doc.data()
                dateByDoneMilestone[doc.id] = milestone.date
            })

            appAdmin.firestore().doc(`goals/${project.id}/items/${id}`).update({ dateByDoneMilestone })
        }
    }
    console.log('done')
}

async function insertDefaultWorkstreamsForProjects(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const { id: projectId, userIds = [], workstreamIds = [] } = project

        if (workstreamIds.findIndex(id => id === 'ws@default') === -1) {
            workstreamIds.unshift('ws@default')
            await appAdmin.firestore().doc(`projects/${projectId}`).update({ workstreamIds })
        }

        const date = Date.now()
        const getLastVisited = () => {
            const result = {}
            for (let uid of userIds) {
                result[uid] = date
            }
            return result
        }

        const stream = {
            uid: 'ws@default',
            displayName: 'All project',
            description: 'Default workstream to gather general project tasks',
            projectId: projectId,
            lastVisitBoard: {
                [projectId]: getLastVisited(),
            },
            userIds: userIds,
            created: date,
            creatorId: userIds[0] || '',
            lastEditionDate: date,
            photoURL: 'ws@default',
        }

        console.log(`[ ${project.id} ]: ${project.name}`)

        await appAdmin.firestore().doc(`/projectsWorkstreams/${projectId}/workstreams/ws@default`).set(stream)
    }
    console.log('done')
}

async function updateProjectColors(appAdmin) {
    const newColors = {
        '#06EEC1': '#0AFFBE', // Pelor 100
        '#E17055': '#FF925C', // Orang 200
        '#7F71EA': '#7C70FF', // Viole 300
        '#00CEC9': '#47DEFF', // Blue_ 400
        '#FDCB6E': '#F0E219', // Yello 500
        '#1DE686': '#00F477', // Green 600
        '#FB70A1': '#FF70B3', // Pink_ 700
        '#45AFFC': '#47DEFF', // Red_0 800
        '#B4E44E': '#BFFF0A', // Lime_ 900
        '#E06EFD': '#CB70FF', // Purpl 1000
    }

    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const color =
            project && project.color && newColors.hasOwnProperty(project.color) ? newColors[project.color] : '#0AFFBE'

        appAdmin.firestore().doc(`projects/${project.id}`).update({
            color: color,
        })
    }
    console.log('done')
}

async function setModernThemeNameToUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]

        appAdmin.firestore().doc(`users/${user.uid}`).update({
            themeName: 'modern',
        })
    }
    console.log('done')
}

async function setGoldToUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]

        appAdmin.firestore().doc(`users/${user.uid}`).update({
            gold: {},
        })
    }
    console.log('done')
}

async function setTimestampToStatistics(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)
        const userIds = project.userIds ? project.userIds : []

        for (let n = 0; n < userIds.length; n++) {
            const userId = userIds[n]

            const statisticsDocs = (await appAdmin.firestore().collection(`statistics/${project.id}/${userId}`).get())
                .docs
            const statisticsList = []
            statisticsDocs.forEach(statisticDoc => {
                const statistic = statisticDoc.data()
                statistic.id = statisticDoc.id
                statisticsList.push(statistic)
            })

            const promises = []
            for (let i = 0; i < statisticsList.length; i++) {
                const { id } = statisticsList[i]
                const date = moment(id, 'DDMMYYYY')
                const timestamp = date.startOf('day').hour(12).minute(0).valueOf()
                promises.push(
                    appAdmin.firestore().doc(`statistics/${project.id}/${userId}/${id}`).update({ timestamp })
                )
            }
            await Promise.all(promises)
        }
    }
    console.log('done')
}

async function setStatisticsDataToUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]

        appAdmin
            .firestore()
            .doc(`users/${user.uid}`)
            .update({
                statisticsData: { filter: 'Current month', customDateRange: [] },
            })
    }
    console.log('done')
}

async function fixWorkstreamIdAcrossAlldone(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    const DEFAULT_WORKSTREAM_ID = 'ws@default'

    const fixTasks = async (projectId, wrongWsId) => {
        const tasksDocs = (
            await appAdmin.firestore().collection(`items/${projectId}/tasks`).where('userId', '==', wrongWsId).get()
        ).docs

        const promises = []
        promises.push(
            tasksDocs.forEach(doc => {
                appAdmin
                    .firestore()
                    .doc(`items/${projectId}/tasks/${doc.id}`)
                    .update({ userId: DEFAULT_WORKSTREAM_ID, userIds: [DEFAULT_WORKSTREAM_ID] })
            })
        )
        await Promise.all(promises)
    }

    const fixGoals = async (projectId, wrongWsId) => {
        const goalsDocs = (
            await appAdmin
                .firestore()
                .collection(`goals/${projectId}/items`)
                .where('parentStreamId', '==', wrongWsId)
                .get()
        ).docs

        const promises = []
        promises.push(
            goalsDocs.forEach(doc => {
                appAdmin
                    .firestore()
                    .doc(`goals/${projectId}/items/${doc.id}`)
                    .update({ parentStreamId: DEFAULT_WORKSTREAM_ID })
            })
        )
        await Promise.all(promises)
    }

    const idsProjectsWithProbles = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)
        const wsDocs = (await appAdmin.firestore().collection(`projectsWorkstreams/${project.id}/workstreams`).get())
            .docs

        const wsList = []
        const wsWrongIdList = []
        wsDocs.forEach(doc => {
            const ws = doc.data()
            if (ws.uid === DEFAULT_WORKSTREAM_ID && ws.uid !== doc.id) {
                wsList.push(ws)
                wsWrongIdList.push(doc.id)
            }
        })

        if (wsList.length > 1) {
            idsProjectsWithProbles.push('WRONG')
        } else {
            const promises = []
            for (let n = 0; n < wsList.length; n++) {
                const ws = wsList[n]
                const wrongId = wsWrongIdList[n]
                idsProjectsWithProbles.push(project.id)
                promises.push(
                    appAdmin
                        .firestore()
                        .doc(`/projects/${project.id}`)
                        .update({
                            workstreamIds: admin.firestore.FieldValue.arrayRemove(wrongId),
                        })
                )
                promises.push(
                    appAdmin
                        .firestore()
                        .doc(`/projects/${project.id}`)
                        .update({
                            workstreamIds: admin.firestore.FieldValue.arrayUnion(DEFAULT_WORKSTREAM_ID),
                        })
                )

                promises.push(fixTasks(project.id, wrongId))
                promises.push(fixGoals(project.id, wrongId))

                promises.push(
                    appAdmin.firestore().doc(`/projectsWorkstreams/${project.id}/workstreams/${wrongId}`).delete()
                )
                promises.push(
                    appAdmin
                        .firestore()
                        .doc(`/projectsWorkstreams/${project.id}/workstreams/${DEFAULT_WORKSTREAM_ID}`)
                        .set(ws)
                )
            }
            await Promise.all(promises)
        }
    }
    console.log(idsProjectsWithProbles)
    console.log('done')
}

async function setContainerNotesIdsInTasks(appAdmin) {
    const paths = {
        noteItems: 'noteItems',
        notesData: 'notesData',
        noteItemsVersions: 'noteItemsVersions',
        noteVersionsData: 'noteVersionsData',
        noteItemsDailyVersions: 'noteItemsDailyVersions',
        noteDailyVersionsData: 'noteDailyVersionsData',
    }

    const getNoteData = async (projectId, noteId) => {
        const notes_bucket_name = 'notescontentdev'
        //const notes_bucket_name="notescontentprod"

        const notesBucket = appAdmin.storage().bucket(notes_bucket_name)

        const noteContentFile = notesBucket.file(`${paths.notesData}/${projectId}/${noteId}`)
        const [exist] = await noteContentFile.exists()

        if (exist) {
            const [content] = await noteContentFile.download()
            const noteOps = getNoteDelta(content)
            return noteOps
        } else {
            return null
        }
    }

    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const notesDocs = (await appAdmin.firestore().collection(`noteItems/${project.id}/notes`).get()).docs
        const notesList = []
        notesDocs.forEach(noteDoc => {
            const note = noteDoc.data()
            note.id = noteDoc.id
            notesList.push(note)
        })
        console.log('Notes ' + notesList.length)
        let promises = []
        for (let n = 0; n < notesList.length; n++) {
            const note = notesList[n]
            promises.push(getNoteData(project.id, note.id))
        }
        const opsResults = await Promise.all(promises)

        const updateTaskNoteContainers = async taskTagFormat => {
            const { editorId, taskId } = taskTagFormat
            const taskDoc = await appAdmin.firestore().doc(`items/${project.id}/tasks/${taskId}`).get()
            const task = taskDoc.data()
            if (task) {
                await appAdmin
                    .firestore()
                    .doc(`items/${project.id}/tasks/${taskDoc.id}`)
                    .update({
                        containerNotesIds: admin.firestore.FieldValue.arrayUnion(editorId),
                    })
                console.log('updated')
            }
        }
        promises = []
        for (let n = 0; n < opsResults.length; n++) {
            const ops = opsResults[n]
            if (ops) {
                ops.forEach(op => {
                    const { insert } = op
                    const { taskTagFormat } = insert
                    if (taskTagFormat) {
                        promises.push(updateTaskNoteContainers(taskTagFormat))
                    }
                })
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function setStatisticsModalDateToUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]

        appAdmin.firestore().doc(`users/${user.uid}`).update({
            statisticsModalDate: Date.now(),
        })
    }
    console.log('done')
}

///PERSNAL GOALS AND WORKSTREAM GOALS

async function setWorkstreamsIdsPropertyInMilestones(appAdmin) {
    const getGoalsInOpenMilestone = async (projectId, milestoneDate) => {
        const goalsDocs = (
            await appAdmin
                .firestore()
                .collection(`goals/${projectId}/items`)
                .where('completionMilestoneDate', '>=', milestoneDate)
                .get()
        ).docs
        const goals = []
        goalsDocs.forEach(doc => {
            const goal = doc.data()
            goal.id = doc.id
            if (goal.startingMilestoneDate <= milestoneDate) {
                goals.push(goal)
            }
        })
        return goals
    }

    const getGoalsInDoneMilestone = async (projectId, milestoneId) => {
        const goalsDocs = (
            await appAdmin
                .firestore()
                .collection(`goals/${projectId}/items`)
                .where('parentDoneMilestoneIds', 'array-contains-any', [milestoneId])
                .get()
        ).docs
        const goals = []
        goalsDocs.forEach(doc => {
            const goal = doc.data()
            goal.id = doc.id
            goals.push(goal)
        })
        return goals
    }

    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(project.name)
        const milestonesDocs = (
            await appAdmin.firestore().collection(`goalsMilestones/${project.id}/milestonesItems`).get()
        ).docs

        const milestonesList = []
        milestonesDocs.forEach(milestoneDoc => {
            const milestone = milestoneDoc.data()
            milestone.id = milestoneDoc.id
            milestonesList.push(milestone)
        })

        const promises = []
        for (let n = 0; n < milestonesList.length; n++) {
            const milestone = milestonesList[n]
            const goals = milestone.done
                ? await getGoalsInDoneMilestone(project.id, milestone.id)
                : await getGoalsInOpenMilestone(project.id, milestone.date)
            const workstreamsIds = []
            goals.forEach(goal => {
                const { parentStreamId } = goal
                if (parentStreamId) {
                    if (!workstreamsIds.includes(parentStreamId)) workstreamsIds.push(parentStreamId)
                } else {
                    console.log('BROKEN GOAL WITHOUT WORKSTREAM')
                }
            })

            promises.push(
                appAdmin
                    .firestore()
                    .doc(`goalsMilestones/${project.id}/milestonesItems/${milestone.id}`)
                    .update({ workstreamsIds })
            )
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function syncProjectUserIdsWithDefaultWS(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    const promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        if (project.userIds != null) {
            const dWS = await appAdmin
                .firestore()
                .doc(`/projectsWorkstreams/${project.id}/workstreams/ws@default`)
                .get()

            if (dWS.exists) {
                promises.push(
                    appAdmin
                        .firestore()
                        .doc(`/projectsWorkstreams/${project.id}/workstreams/ws@default`)
                        .update({ userIds: project.userIds })
                )
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE ================================')
}

//SCRIPTS TASKS OPT

async function removeAcceptedFromTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { accepted } = task

            const updateData = accepted
                ? {
                      accepted: admin.firestore.FieldValue.delete(),
                      suggestedBy: null,
                  }
                : {
                      accepted: admin.firestore.FieldValue.delete(),
                  }

            promises.push(appAdmin.firestore().doc(`items/${project.id}/tasks/${task.id}`).update(updateData))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function convertRecurrenceObjectToStringInTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { recurrence } = task

            const updateData = recurrence
                ? recurrence.type
                    ? {
                          recurrence: recurrence.type,
                      }
                    : {
                          recurrence: 'never',
                      }
                : {
                      recurrence: 'never',
                  }

            promises.push(appAdmin.firestore().doc(`items/${project.id}/tasks/${task.id}`).update(updateData))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function fixTypeInCreatorIdPropertyInTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { creatorId, creatorUid } = task

            const updateData =
                creatorUid && !creatorId
                    ? { creatorId: creatorUid, creatorUid: admin.firestore.FieldValue.delete() }
                    : { creatorUid: admin.firestore.FieldValue.delete() }

            promises.push(appAdmin.firestore().doc(`items/${project.id}/tasks/${task.id}`).update(updateData))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function removeMentionedUserIdsFromTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]

            const updateData = {
                mentionedUserIds: admin.firestore.FieldValue.delete(),
            }

            promises.push(appAdmin.firestore().doc(`items/${project.id}/tasks/${task.id}`).update(updateData))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function convertInBacklogAndInBacklogByObserversIdsToMaxSafeIntegerTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { inBacklog, inBacklogByObserversIds, dueDateByObserversIds, observersIds, dueDate } = task

            const newDueDateByObserversIds = {}
            observersIds.forEach(id => {
                newDueDateByObserversIds[id] = inBacklogByObserversIds[id]
                    ? Number.MAX_SAFE_INTEGER
                    : dueDateByObserversIds[id]
                    ? dueDateByObserversIds[id]
                    : Number.MAX_SAFE_INTEGER
            })
            const updateData = {
                dueDate: inBacklog ? Number.MAX_SAFE_INTEGER : dueDate,
                inBacklog: admin.firestore.FieldValue.delete(),
                dueDateByObserversIds: newDueDateByObserversIds,
                inBacklogByObserversIds: admin.firestore.FieldValue.delete(),
            }

            promises.push(appAdmin.firestore().doc(`items/${project.id}/tasks/${task.id}`).update(updateData))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function removeFollowerUserIdsAndFollowerUsersFromTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]

            const updateData = {
                followerUserIds: admin.firestore.FieldValue.delete(),
                followerUsers: admin.firestore.FieldValue.delete(),
            }

            promises.push(appAdmin.firestore().doc(`items/${project.id}/tasks/${task.id}`).update(updateData))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function removePointsFromTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        const OPEN_STEP = -1
        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { estimations } = task
            const newEstimations = estimations
                ? {
                      ...estimations,
                      [OPEN_STEP]:
                          estimations[OPEN_STEP] !== undefined && estimations[OPEN_STEP] !== null
                              ? estimations[OPEN_STEP]
                              : 0,
                  }
                : { [OPEN_STEP]: 0 }
            const updateData = {
                estimations: newEstimations,
                points: admin.firestore.FieldValue.delete(),
            }

            promises.push(appAdmin.firestore().doc(`items/${project.id}/tasks/${task.id}`).update(updateData))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setQuotaDataToUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]

        appAdmin.firestore().doc(`users/${user.uid}`).update({
            quotaWarnings: {},
            monthlyXp: 0,
            monthlyTraffic: 0,
            monthlyQuota: admin.firestore.FieldValue.delete(),
        })
    }
    console.log('done')
}

async function updateSubscriptionsMembers(appAdmin) {
    const usersDocs = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    usersDocs.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    console.log(userList.length)
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]

        const companiesDocs = (
            await appAdmin.firestore().collection(`subscriptionsMembers/${user.uid}/companies`).get()
        ).docs

        const companyList = []
        companiesDocs.forEach(companyDoc => {
            const company = { id: companyDoc.id, ...companyDoc.data() }
            companyList.push(company)
        })
        console.log(companyList.length)
        for (let n = 0; n < companyList.length; n++) {
            const company = companyList[n]
            console.log(company)
            appAdmin.firestore().doc(`subscriptionsMembers/${user.uid}/companies/${company.id}`).update({
                companyId: company.company.id,
                userPayingId: company.owner,
                company: admin.firestore.FieldValue.delete(),
                owner: admin.firestore.FieldValue.delete(),
            })
        }
    }
    console.log('done')
}

async function convertTasksEstimationsToTime() {
    const POINTS_VALUES = [0, 1, 2, 3, 5, 8, 13, 21]
    const EQUAL_TIME_VALUES = {
        0: 0,
        1: 30,
        2: 60,
        3: 120,
        5: 240,
        8: 480,
        13: 960,
        21: 1440,
    }

    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    console.log('Number of projects: ' + projectsList.length)
    console.log('====================================')

    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`${i + 1} / ${projectsList.length} => ${project.name}`)

        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })
        console.log(`Number of tasks: ${tasks.length}`)
        console.log('------------------------------------')

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { estimations } = task
            const updatedEstimations = { ...estimations }

            for (let key in estimations) {
                if (POINTS_VALUES.includes(estimations[key])) {
                    updatedEstimations[key] = EQUAL_TIME_VALUES[estimations[key]]
                }
            }

            promises.push(
                appAdmin
                    .firestore()
                    .doc(`items/${project.id}/tasks/${task.id}`)
                    .update({ estimations: updatedEstimations })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setTimeEstimationsInStatistics(appAdmin) {
    const getTimeFromPoints = donePoints => {
        switch (true) {
            case donePoints === 0:
                return 0
            case donePoints === 1:
                return 30
            case donePoints === 2:
                return 60
            case donePoints === 3:
                return 120
            case donePoints === 4:
                return 180
            case donePoints === 5:
                return 240
            case donePoints === 6:
                return 320
            case donePoints === 7:
                return 400
            case donePoints === 8:
                return 480
            case 9 <= donePoints && donePoints <= 12:
                return 480 + (donePoints - 8) * ((960 - 480) / 5)
            case donePoints === 13:
                return 960
            case 14 <= donePoints && donePoints <= 20:
                return 960 + (donePoints - 13) * ((1440 - 960) / 8)
            case donePoints === 21:
                return 1440
            case donePoints > 21:
                return donePoints * 60
        }
    }

    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    console.log('Number of projects: ' + projectsList.length)
    console.log('====================================')

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`${i + 1} / ${projectsList.length} => ${project.name}`)

        const userIds = project.userIds ? project.userIds : []

        for (let n = 0; n < userIds.length; n++) {
            const userId = userIds[n]

            const statisticsDocs = (await appAdmin.firestore().collection(`statistics/${project.id}/${userId}`).get())
                .docs
            const statisticsList = []
            statisticsDocs.forEach(statisticDoc => {
                const statistic = statisticDoc.data()
                statistic.id = statisticDoc.id
                statisticsList.push(statistic)
            })
            console.log(`Number of statistics for user [${userId}]: ${statisticsList.length}`)
            console.log('---------------------------------------------------')

            for (let i = 0; i < statisticsList.length; i++) {
                const { id, donePoints } = statisticsList[i]

                if (donePoints != null) {
                    const doneTime = getTimeFromPoints(donePoints)
                    promises.push(
                        appAdmin.firestore().doc(`statistics/${project.id}/${userId}/${id}`).update({ doneTime })
                    )
                }
            }

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function updateUserStatisticData(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]

        console.log(`${i + 1} / ${userList.length} ---------------->>`)

        if (user && user.statisticsData && user.statisticsData.filter != null) {
            const needUpdate =
                user.statisticsData.filter === 'Last week' || user.statisticsData.filter === 'Last 2 weeks'

            if (needUpdate) {
                const filter =
                    user.statisticsData.filter === 'Last week'
                        ? 'Last 7 days'
                        : user.statisticsData.filter === 'Last 2 weeks'
                        ? 'Last 14 days'
                        : user.statisticsData.filter

                await appAdmin.firestore().doc(`users/${user.uid}`).update({
                    'statisticsData.filter': filter,
                })
            }
        }
    }
    console.log('done')
}

async function getUsersList(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })
    console.log('start')
    const emails = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { displayName, email } = user
        if (!emails.includes(email)) {
            console.log({ name: displayName, email })
            emails.push(email)
        }
    }
    console.log('done')
}

//NEW GOALS

async function removeOwnerIdAndParentStreamIAndAddIsPublicForInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(project.name)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []
        for (let n = 0; n < goalsList.length; n++) {
            const goal = goalsList[n]

            promises.push(
                appAdmin
                    .firestore()
                    .doc(`goals/${project.id}/items/${goal.id}`)
                    .update({
                        ownerId: admin.firestore.FieldValue.delete(),
                        parentStreamId: admin.firestore.FieldValue.delete(),
                        isPublicFor: [0],
                    })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function removeOwnerIdAndWorkstreamsIdsFromMilestones(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(project.name)

        const milestonesDocs = (
            await appAdmin.firestore().collection(`goalsMilestones/${project.id}/milestonesItems`).get()
        ).docs

        const milestonesList = []
        milestonesDocs.forEach(milestoneDoc => {
            const milestone = milestoneDoc.data()
            milestone.id = milestoneDoc.id
            milestonesList.push(milestone)
        })

        let promises = []
        for (let n = 0; n < milestonesList.length; n++) {
            const milestone = milestonesList[n]

            promises.push(
                appAdmin.firestore().doc(`goalsMilestones/${project.id}/milestonesItems/${milestone.id}`).update({
                    ownerId: admin.firestore.FieldValue.delete(),
                    workstreamsIds: admin.firestore.FieldValue.delete(),
                })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function setAllProjectWorkstreamInGoalsWithoutAssingees(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const DEFAULT_WORKSTREAM_ID = 'ws@default'
        const CAPACITY_NONE = 'CAPACITY_NONE'

        const project = projectsList[i]
        console.log(project.name)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []
        for (let n = 0; n < goalsList.length; n++) {
            const goal = goalsList[n]
            const { assigneesIds } = goal

            if (!assigneesIds || assigneesIds.length === 0) {
                promises.push(
                    appAdmin
                        .firestore()
                        .doc(`goals/${project.id}/items/${goal.id}`)
                        .update({
                            assigneesIds: [DEFAULT_WORKSTREAM_ID],
                            assigneesCapacity: { [DEFAULT_WORKSTREAM_ID]: CAPACITY_NONE },
                            assigneesReminderDate: { [DEFAULT_WORKSTREAM_ID]: Date.now() },
                        })
                )
            }

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function setSortIndexByMilestoneInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(project.name)

        let sortKey = 0
        const generateSortIndex = () => {
            let newSortKey = moment().valueOf()
            if (sortKey >= newSortKey) {
                newSortKey = sortKey + 1
            }
            sortKey = newSortKey
            return newSortKey
        }

        const mapMilestoneData = (milestoneId, milestone) => {
            return {
                id: milestone.id ? milestone.id : milestoneId,
                extendedName: milestone.extendedName ? milestone.extendedName : 'MVP Definition',
                created: milestone.created ? milestone.created : Date.now(),
                date: milestone.date ? milestone.date : Date.now(),
                done: milestone.done ? milestone.done : false,
                assigneesCapacityDates: milestone.assigneesCapacityDates ? milestone.assigneesCapacityDates : {},
                doneDate: milestone.doneDate ? milestone.doneDate : Date.now(),
                hasStar: milestone.hasStar ? milestone.hasStar : '#FFFFFF',
            }
        }

        const getOpenMilestonesInDateRange = async (projectId, date1, date2) => {
            const milestonesDocs = (
                await appAdmin
                    .firestore()
                    .collection(`goalsMilestones/${projectId}/milestonesItems`)
                    .where('date', '>=', date1)
                    .where('date', '<=', date2)
                    .where('done', '==', false)
                    .orderBy('date', 'asc')
                    .get()
            ).docs

            const milestones = []
            milestonesDocs.forEach(doc => {
                milestones.push(mapMilestoneData(doc.id, doc.data()))
            })
            return milestones
        }

        const getOpenMilestonesFromGoal = async (projectId, goal) => {
            const { startingMilestoneDate, completionMilestoneDate } = goal
            const milestones = await getOpenMilestonesInDateRange(
                projectId,
                startingMilestoneDate,
                completionMilestoneDate
            )
            return milestones
        }

        const getMilestoneData = async (projectId, milestoneId) => {
            const milestone = (
                await appAdmin.firestore().doc(`/goalsMilestones/${projectId}/milestonesItems/${milestoneId}`).get()
            ).data()
            return milestone ? mapMilestoneData(milestoneId, milestone) : null
        }

        const getDoneMilestonesFromGoal = async (projectId, goal) => {
            const { parentDoneMilestoneIds } = goal
            const promises = []
            parentDoneMilestoneIds.forEach(milestoneId => {
                promises.push(getMilestoneData(projectId, milestoneId))
            })
            const milestones = await Promise.all(promises)
            return milestones
        }

        const getsMilestones = async (projectId, goal) => {
            const promises = []
            promises.push(getOpenMilestonesFromGoal(projectId, goal))
            promises.push(getDoneMilestonesFromGoal(projectId, goal))
            const results = await Promise.all(promises)
            const openMilestones = results[0]
            const doneMilestones = results[1]
            const milestones = [...openMilestones, ...doneMilestones]
            return milestones
        }

        const updateGoal = async (projectId, goal) => {
            const { assigneesIds } = goal

            const milestones = await getsMilestones(projectId, goal)

            const sortIndexByMilestone = {}
            milestones.forEach(milestone => {
                sortIndexByMilestone[milestone.id] = {}
                assigneesIds.forEach(assigneeId => {
                    sortIndexByMilestone[milestone.id][assigneeId] = generateSortIndex()
                })
            })

            console.log(sortIndexByMilestone)
            await appAdmin.firestore().doc(`goals/${projectId}/items/${goal.id}`).update({ sortIndexByMilestone })
        }

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []
        for (let n = 0; n < goalsList.length; n++) {
            const goal = goalsList[n]

            promises.push(updateGoal(project.id, goal))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function addParentGoalIsPublicForToTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { parentGoalId } = task

            promises.push(
                appAdmin
                    .firestore()
                    .doc(`items/${project.id}/tasks/${task.id}`)
                    .update({ parentGoalIsPublicFor: parentGoalId ? [0] : null })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function multiplyUserXpBy100(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })
    let promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { xp } = user
        if (xp) {
            promises.push(
                appAdmin
                    .firestore()
                    .doc(`users/${user.uid}`)
                    .update({
                        xp: xp * 100,
                    })
            )
        }

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setDayToStatistics(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)
        const userIds = project.userIds ? project.userIds : []

        for (let n = 0; n < userIds.length; n++) {
            const userId = userIds[n]

            const statisticsDocs = (await appAdmin.firestore().collection(`statistics/${project.id}/${userId}`).get())
                .docs
            const statisticsList = []
            statisticsDocs.forEach(statisticDoc => {
                const statistic = statisticDoc.data()
                statistic.id = statisticDoc.id
                statisticsList.push(statistic)
            })

            for (let i = 0; i < statisticsList.length; i++) {
                const { id } = statisticsList[i]
                const date = moment(id, 'DDMMYYYY')
                const dayDate = parseInt(date.format('YYYYMMDD'))
                promises.push(
                    appAdmin.firestore().doc(`statistics/${project.id}/${userId}/${id}`).update({ day: dayDate })
                )

                if (promises.length > 200) {
                    await Promise.all(promises)
                    console.log('UPDATE')
                    promises = []
                }
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function loadGoalsToAlgolia(appAdmin) {
    const db = appAdmin.firestore()
    loadDataToAlgolia(db).then(() => {
        console.log('DONE')
    })
}

async function fixUserLevelBasedOnXp(appAdmin) {
    const generateXpTable = () => {
        const maxLevel = 100
        const growthFactor = 1.2

        let needed = [0, 0, 10]
        let total = [0, 0, 10]

        for (let i = 3; i < maxLevel; i++) {
            needed.push(Math.round(needed[needed.length - 1] * growthFactor))
            total.push(total[total.length - 1] + needed[needed.length - 1])
        }

        for (let i = 0; i < maxLevel; i++) {
            needed[i] *= 100
            total[i] *= 100
        }

        return { needed, total }
    }

    const getCurrentLevel = (xp, total) => {
        if (xp === 0) return 1
        for (let i = 0; i < total.length; i++) {
            const t = total[i]
            if (t > xp) {
                return i - 1
            }
        }
    }

    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    const { total } = generateXpTable()

    let promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { xp } = user

        const level = getCurrentLevel(xp, total)

        promises.push(
            appAdmin.firestore().doc(`users/${user.uid}`).update({
                level,
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

//***************** */

async function setSkillPointsInUserBasedOnXp(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { level } = user

        let earnedSkillPoints = 10
        for (let i = 2; i <= level; i++) {
            earnedSkillPoints += Math.floor(Math.random() * 3) + 1
        }

        promises.push(
            appAdmin.firestore().doc(`users/${user.uid}`).update({
                skillPoints: earnedSkillPoints,
                showSkillPointsNotification: true,
                newEarnedSkillPoints: 0,
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function fixXpBasedOnTheNewLevelFormule(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    function generateXpTable() {
        const maxLevel = 100
        const growthFactor = 1.2

        let needed = [0, 0, 10]
        let total = [0, 0, 10]

        for (let i = 3; i < maxLevel; i++) {
            needed.push(Math.round(needed[needed.length - 1] * growthFactor))
            total.push(total[total.length - 1] + needed[needed.length - 1])
        }

        for (let i = 0; i < maxLevel; i++) {
            needed[i] *= 100
            total[i] *= 100
        }

        return { needed, total }
    }

    const XP_NEEDED_FOR_LEVEL_UP = 42000
    const XP_TABLET = generateXpTable()

    function getTotalXpNeededToReachLevel(level) {
        return level <= 1 ? 0 : XP_NEEDED_FOR_LEVEL_UP * (level - 1)
    }

    let promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { level, xp } = user

        const minXpInLevel = getTotalXpNeededToReachLevel(level)
        const percentForReachNextLevel = ((xp - XP_TABLET.total[level]) * 100) / XP_TABLET.needed[level + 1]
        const newXp = minXpInLevel + (percentForReachNextLevel / 10) * XP_NEEDED_FOR_LEVEL_UP

        console.log(percentForReachNextLevel)
        promises.push(
            appAdmin.firestore().doc(`users/${user.uid}`).update({
                xp: newXp,
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setOnlyOnKindOfAssingeesInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const DEFAULT_WORKSTREAM_ID = 'ws@default'
        const CAPACITY_NONE = 'CAPACITY_NONE'
        const WORKSTREAM_ID_PREFIX = 'ws@'

        const project = projectsList[i]
        console.log(`Project: ` + project.name)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        const isWorkstream = id => {
            return id.startsWith(WORKSTREAM_ID_PREFIX)
        }

        const generateUpdateObject = (oldAssigneesIds, oldAssigneesCapacity, oldAssigneesReminderDate) => {
            if (!oldAssigneesIds || oldAssigneesIds.length === 0) {
                return {
                    assigneesIds: [DEFAULT_WORKSTREAM_ID],
                    assigneesCapacity: { [DEFAULT_WORKSTREAM_ID]: CAPACITY_NONE },
                    assigneesReminderDate: { [DEFAULT_WORKSTREAM_ID]: Date.now() },
                }
            }

            const wsIds = []
            const usersIds = []
            oldAssigneesIds.forEach(assigneeId => {
                isWorkstream(assigneeId) ? wsIds.push(assigneeId) : usersIds.push(assigneeId)
            })

            if (wsIds.length === 0 || usersIds.length === 0) {
                return {
                    assigneesIds: oldAssigneesIds,
                    assigneesCapacity: oldAssigneesCapacity,
                    assigneesReminderDate: oldAssigneesReminderDate,
                }
            }

            const newAssigneesCapacity = {}
            const newAssigneesReminderDate = {}
            usersIds.forEach(id => {
                newAssigneesCapacity[id] = oldAssigneesCapacity[id]
                newAssigneesReminderDate[id] = oldAssigneesReminderDate[id]
            })
            return {
                assigneesIds: usersIds,
                assigneesCapacity: newAssigneesCapacity,
                assigneesReminderDate: newAssigneesReminderDate,
            }
        }

        let promises = []
        for (let n = 0; n < goalsList.length; n++) {
            const goal = goalsList[n]
            const { assigneesIds, assigneesCapacity, assigneesReminderDate } = goal

            const updateObject = generateUpdateObject(assigneesIds, assigneesCapacity, assigneesReminderDate)
            promises.push(appAdmin.firestore().doc(`goals/${project.id}/items/${goal.id}`).update(updateObject))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function renamePropertyInProjects(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const { invoicingData } = project

        const updateData = { invoicingData: admin.firestore.FieldValue.delete() }
        if (invoicingData) {
            updateData.hourlyRatesData = invoicingData
        }

        promises.push(appAdmin.firestore().doc(`projects/${project.id}`).update(updateData))

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function removeIsArchivedPropertyInProjects(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        promises.push(
            appAdmin
                .firestore()
                .doc(`projects/${project.id}`)
                .update({ isArchived: admin.firestore.FieldValue.delete() })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function setCommunityProjectIdsPropertyInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]

        promises.push(
            appAdmin.firestore().doc(`users/${user.uid}`).update({
                communityProjectIds: [],
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

///////////GOALS V5 BRANCH

async function setAllGoalsSection(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)
        const userIds = project.userIds ? project.userIds : []

        for (let n = 0; n < userIds.length; n++) {
            const userId = userIds[n]

            promises.push(
                appAdmin
                    .firestore()
                    .doc(`allSections/${project.id}/${userId}/allGoals`)
                    .set({ lastVisitBoardInGoals: Date.now() })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setStartingAndCompletionDateBothInTheSameDateIfAnyIsInSmoeday(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []
        for (let n = 0; n < goalsList.length; n++) {
            const goal = goalsList[n]
            const { startingMilestoneDate, completionMilestoneDate } = goal

            if (
                startingMilestoneDate === Number.MAX_SAFE_INTEGER ||
                completionMilestoneDate === Number.MAX_SAFE_INTEGER
            ) {
                const updateObject = {
                    startingMilestoneDate: Number.MAX_SAFE_INTEGER,
                    completionMilestoneDate: Number.MAX_SAFE_INTEGER,
                }

                promises.push(appAdmin.firestore().doc(`goals/${project.id}/items/${goal.id}`).update(updateObject))

                if (promises.length > 200) {
                    await Promise.all(promises)
                    console.log('UPDATED')
                    promises = []
                }
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function setStartingAndCompletionForBeenBothBeforeAndAfter(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []
        for (let n = 0; n < goalsList.length; n++) {
            const goal = goalsList[n]
            const { startingMilestoneDate, completionMilestoneDate } = goal

            if (startingMilestoneDate > completionMilestoneDate || completionMilestoneDate < startingMilestoneDate) {
                const updateObject = {
                    startingMilestoneDate: completionMilestoneDate,
                    completionMilestoneDate: completionMilestoneDate,
                }

                promises.push(appAdmin.firestore().doc(`goals/${project.id}/items/${goal.id}`).update(updateObject))

                if (promises.length > 200) {
                    await Promise.all(promises)
                    console.log('UPDATED')
                    promises = []
                }
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function removeEmptyMilestones(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    const checkIfMilestoneIsEmpty = async (projectId, milestoneDate) => {
        const goalsDocs = (
            await appAdmin
                .firestore()
                .collection(`goals/${projectId}/items`)
                .where('completionMilestoneDate', '==', milestoneDate)
                .get()
        ).docs
        return goalsDocs.length === 0
    }

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const milestonesDocs = (
            await appAdmin.firestore().collection(`goalsMilestones/${project.id}/milestonesItems`).get()
        ).docs

        const milestonesList = []
        milestonesDocs.forEach(milestoneDoc => {
            const milestone = milestoneDoc.data()
            milestone.id = milestoneDoc.id
            milestonesList.push(milestone)
        })

        let promises = []
        for (let n = 0; n < milestonesList.length; n++) {
            const milestone = milestonesList[n]
            const { date, done } = milestone

            const isEmpty = done ? false : await checkIfMilestoneIsEmpty(project.id, date)

            if (isEmpty) {
                promises.push(
                    appAdmin.firestore().doc(`goalsMilestones/${project.id}/milestonesItems/${milestone.id}`).delete()
                )

                if (promises.length > 200) {
                    await Promise.all(promises)
                    console.log('UPDATED')
                    promises = []
                }
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function addMilestoneIfTheGoalDoNoThaveMilestoneParents(appAdmin) {
    let sortKey = 0
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    const existMilestoneInDate = async (projectId, date) => {
        const milestoneDoc = (
            await appAdmin
                .firestore()
                .collection(`goalsMilestones/${projectId}/milestonesItems`)
                .where('date', '==', date)
                .where('done', '==', false)
                .limit(1)
                .get()
        ).docs[0]
        return !!milestoneDoc
    }

    const getNewDefaultGoalMilestone = date => {
        const milestone = {
            extendedName: '',
            created: date,
            date: date,
            done: false,
            assigneesCapacityDates: {},
            doneDate: date,
            hasStar: '#FFFFFF',
        }
        return milestone
    }

    const getId = () => {
        // Modeled after base64 web-safe chars, but ordered by ASCII.
        const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'

        // Timestamp of last push, used to prevent local collisions if you push twice in one ms.
        let lastPushTime = 0

        // We generate 72-bits of randomness which get turned into 12 characters and appended to the
        // timestamp to prevent collisions with other clients.  We store the last characters we
        // generated because in the event of a collision, we'll use those same characters except
        // "incremented" by one.
        let lastRandChars = []

        let now = new Date().getTime()
        let duplicateTime = now === lastPushTime
        lastPushTime = now

        let timeStampChars = new Array(8)
        for (let i = 7; i >= 0; i--) {
            timeStampChars[i] = PUSH_CHARS.charAt(now % 64)
            // NOTE: Can't use << here because javascript will convert to int and lose the upper bits.
            now = Math.floor(now / 64)
        }
        if (now !== 0) throw new Error('We should have converted the entire timestamp.')

        let id = timeStampChars.join('')

        if (!duplicateTime) {
            for (let i = 0; i < 12; i++) {
                lastRandChars[i] = Math.floor(Math.random() * 64)
            }
        } else {
            // If the timestamp hasn't changed since last push, use the same random number, except incremented by 1.
            for (let i = 11; i >= 0 && lastRandChars[i] === 63; i--) {
                lastRandChars[i] = 0
            }
            lastRandChars[i]++
        }
        for (let i = 0; i < 12; i++) {
            id += PUSH_CHARS.charAt(lastRandChars[i])
        }
        if (id.length != 20) throw new Error('Length should be 20.')

        return id
    }

    const getGoalsInOpenMilestone = async (
        projectId,
        milestoneDate,
        idsOfGoalsToExclude,
        getOnlyIncompleteGoalsInBacklog
    ) => {
        const goalsDocs = (
            await appAdmin
                .firestore()
                .collection(`goals/${projectId}/items`)
                .where('completionMilestoneDate', '>=', milestoneDate)
                .get()
        ).docs
        const goals = []
        goalsDocs.forEach(doc => {
            const goal = doc.data()
            goal.id = doc.id
            if (
                goal.startingMilestoneDate <= milestoneDate &&
                !idsOfGoalsToExclude.includes(goal.id) &&
                (milestoneDate !== Number.MAX_SAFE_INTEGER || !getOnlyIncompleteGoalsInBacklog || goal.progress !== 100)
            ) {
                goals.push(goal)
            }
        })
        return goals
    }

    const generateSortIndex = () => {
        let newSortKey = moment().valueOf()
        if (sortKey >= newSortKey) {
            newSortKey = sortKey + 1
        }
        sortKey = newSortKey
        return newSortKey
    }

    const updateGoalSortIndexes = async (projectId, goalId, milestoneId, assigneesIds) => {
        const sortIndexData = { [milestoneId]: {} }
        assigneesIds.forEach(assigneeId => {
            sortIndexData[milestoneId][assigneeId] = generateSortIndex()
        })
        await appAdmin
            .firestore()
            .doc(`goals/${projectId}/items/${goalId}`)
            .set({ sortIndexByMilestone: sortIndexData }, { merge: true })
    }

    const addOpenMilestoneSortIndexToGoals = async (projectId, milestoneId, milestoneDate) => {
        const goals = await getGoalsInOpenMilestone(projectId, milestoneDate, [], true)
        const promises = []
        goals.forEach(goal => {
            promises.push(updateGoalSortIndexes(projectId, goal.id, milestoneId, goal.assigneesIds))
        })
        await Promise.all(promises)
    }

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []
        for (let n = 0; n < goalsList.length; n++) {
            const goal = goalsList[n]
            const { completionMilestoneDate, parentDoneMilestoneIds } = goal

            const needToCreateMilestone =
                parentDoneMilestoneIds.length === 0 &&
                completionMilestoneDate !== Number.MAX_SAFE_INTEGER &&
                !(await existMilestoneInDate(project.id, completionMilestoneDate))

            if (needToCreateMilestone) {
                const milestone = getNewDefaultGoalMilestone(completionMilestoneDate)
                const milestoneId = getId()

                promises.push(
                    appAdmin
                        .firestore()
                        .collection(`goalsMilestones/${project.id}/milestonesItems`)
                        .doc(milestoneId)
                        .set(milestone)
                )
                promises.push(addOpenMilestoneSortIndexToGoals(project.id, milestoneId, milestone.date))

                if (promises.length > 200) {
                    await Promise.all(promises)
                    console.log('UPDATED')
                    promises = []
                }
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function matchStartingDateWithReminderDate(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []
        for (let n = 0; n < goalsList.length; n++) {
            const goal = goalsList[n]
            const { assigneesReminderDate, startingMilestoneDate } = goal

            const newAssigneesReminderDate = {}
            const assigneesIds = Object.keys(assigneesReminderDate)
            assigneesIds.forEach(id => {
                newAssigneesReminderDate[id] = startingMilestoneDate
            })

            const updateObject = { assigneesReminderDate: newAssigneesReminderDate }
            promises.push(appAdmin.firestore().doc(`goals/${project.id}/items/${goal.id}`).update(updateObject))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function convertReminderBacklogDateToNumeric(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []
        for (let n = 0; n < goalsList.length; n++) {
            const goal = goalsList[n]
            const { assigneesReminderDate } = goal

            const newAssigneesReminderDate = {}
            const assigneesIds = Object.keys(assigneesReminderDate)
            assigneesIds.forEach(id => {
                newAssigneesReminderDate[id] =
                    assigneesReminderDate[id] === 'BACKLOG' ? Number.MAX_SAFE_INTEGER : assigneesReminderDate[id]
            })

            const updateObject = { assigneesReminderDate: newAssigneesReminderDate }
            promises.push(appAdmin.firestore().doc(`goals/${project.id}/items/${goal.id}`).update(updateObject))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

//GUIDESSSSSS

async function setGuideProjectIdsPropertyInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { communityProjectIds } = user
        promises.push(
            appAdmin.firestore().doc(`users/${user.uid}`).update({
                guideProjectIds: communityProjectIds,
                communityProjectIds: admin.firestore.FieldValue.delete(),
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setIsGuidePropertyInProjects(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []

    const guideIds = []

    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { guideProjectIds } = user

        guideProjectIds.forEach(id => {
            if (!guideIds.includes(id)) guideIds.push(id)
        })
    }

    for (let i = 0; i < guideIds.length; i++) {
        const guideId = guideIds[i]

        promises.push(
            appAdmin.firestore().doc(`projects/${guideId}`).update({
                isGuide: true,
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function removeGuideInvitation(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').where('isGuide', '==', true).get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        async function removeProjectInvitationFromUser(projectId, userId) {
            await appAdmin
                .firestore()
                .doc(`users/${userId}`)
                .update({
                    invitedProjectIds: admin.firestore.FieldValue.arrayRemove(projectId),
                })

            await appAdmin
                .firestore()
                .doc(`projects/${projectId}`)
                .update({
                    invitedUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                })
        }

        async function removeAllInvitationInProject(projectId) {
            const invitationsDocs = (
                await appAdmin.firestore().collection(`projectsInvitation/${projectId}/invitations`).get()
            ).docs
            const promises = []
            invitationsDocs.forEach(doc => {
                const invitation = doc.data()
                promises.push(
                    appAdmin.firestore().doc(`projectsInvitation/${projectId}/invitations/${doc.id}`).delete()
                )
                if (invitation.userId) promises.push(removeProjectInvitationFromUser(projectId, invitation.userId))
            })
            await Promise.all(promises)
        }

        promises.push(removeAllInvitationInProject(project.id))

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function checkIfGuidesHaveMoreThanOneOrTwoUser(appAdmin) {
    const administratorUserId = (await appAdmin.firestore().doc('roles/administrator').get()).data().userId
    const projects = (await appAdmin.firestore().collection('projects').where('isGuide', '==', true).get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)
        const { userIds } = project

        if (userIds.length > 2) {
            console.log('MORE THAN ONE USER' + ' ' + project.id)
        } else if (userIds.length === 2 && !userIds.includes(administratorUserId)) {
            console.log('MORE THAN ONE USER' + ' ' + project.id)
        }
    }
    console.log('done')
}

async function convertGuidesToGlobally(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').where('isGuide', '==', true).get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)
        const { userIds } = project

        userIds.forEach(userId => {
            promises.push(
                appAdmin
                    .firestore()
                    .doc(`users/${userId}`)
                    .update({
                        guideProjectIds: admin.firestore.FieldValue.arrayUnion(project.id),
                        archivedProjectIds: admin.firestore.FieldValue.arrayRemove(project.id),
                    })
            )
        })

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function setGuideCreatorIdProperty(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').where('isGuide', '==', true).get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    const administratorUserId = (await appAdmin.firestore().doc('roles/administrator').get()).data().userId

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)
        const { userIds } = project

        const guideCreatorId =
            userIds.length === 1 ? userIds[0] : userIds.find(userId => userId !== administratorUserId)

        promises.push(
            appAdmin.firestore().doc(`projects/${project.id}`).update({
                guideCreatorId,
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function setDynamicPorgressInGoals(appAdmin) {
    const getGoalTasks = async (projectId, goalId) => {
        const tasksDocs = (
            await appAdmin
                .firestore()
                .collection(`/items/${projectId}/tasks`)
                .where('parentGoalId', '==', goalId)
                .where('parentId', '==', null)
                .get()
        ).docs

        const tasks = []
        tasksDocs.forEach(doc => {
            tasks.push(doc.data())
        })
        return tasks
    }

    const getDynamicPorgress = tasks => {
        const tasksAmount = tasks.length
        let doneTasksAmount = 0
        tasks.forEach(task => {
            if (task.done) doneTasksAmount++
        })

        const dynamicProgress = tasksAmount > 0 ? Math.round((doneTasksAmount / tasksAmount) * 100) : 0
        return dynamicProgress
    }

    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []

        for (let k = 0; k < goalsList.length; k++) {
            const goal = goalsList[k]

            const tasks = await getGoalTasks(project.id, goal.id)
            const dynamicProgress = getDynamicPorgress(tasks)
            console.log('Dynamic ' + dynamicProgress)
            promises.push(
                appAdmin.firestore().doc(`goals/${project.id}/items/${goal.id}`).update({
                    dynamicProgress,
                })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }

        await Promise.all(promises)
    }
    console.log('done')
}

///////////////////////NEWWW

async function setTemplatePropertiesInProjects(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const { isGuide, parentGuideId, guideCreatorId } = project
        promises.push(
            appAdmin
                .firestore()
                .doc(`projects/${project.id}`)
                .update({
                    isTemplate: isGuide ? isGuide : false,
                    parentTemplateId: parentGuideId ? parentGuideId : '',
                    templateCreatorId: guideCreatorId ? guideCreatorId : '',
                    isGuide: admin.firestore.FieldValue.delete(),
                    parentGuideId: admin.firestore.FieldValue.delete(),
                    guideCreatorId: admin.firestore.FieldValue.delete(),
                })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setTemplatePropertiesInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { guideProjectIds } = user
        promises.push(
            appAdmin
                .firestore()
                .doc(`users/${user.uid}`)
                .update({
                    templateProjectIds: guideProjectIds ? guideProjectIds : [],
                    guideProjectIds: admin.firestore.FieldValue.delete(),
                })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setGuidePropertiesInProjects(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const { targetProjectId } = project
        promises.push(
            appAdmin
                .firestore()
                .doc(`projects/${project.id}`)
                .update({
                    guideProjectId: targetProjectId ? targetProjectId : '',
                    targetProjectId: admin.firestore.FieldValue.delete(),
                })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

////////////

async function setOwnerIdInGoalsAndMilestones(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        const milestoneDocs = (
            await appAdmin.firestore().collection(`goalsMilestones/${project.id}/milestonesItems`).get()
        ).docs

        const milestonesList = []
        milestoneDocs.forEach(milestoneDoc => {
            const milestone = milestoneDoc.data()
            milestone.id = milestoneDoc.id
            milestonesList.push(milestone)
        })

        const ownerId = project.parentTemplateId
            ? goalsList.length > 0
                ? goalsList[0].assigneesIds[0]
                : null
            : 'ALL_USERS'

        let promises = []

        if (ownerId) {
            for (let n = 0; n < goalsList.length; n++) {
                const goal = goalsList[n]

                promises.push(appAdmin.firestore().doc(`goals/${project.id}/items/${goal.id}`).update({ ownerId }))

                if (promises.length > 200) {
                    await Promise.all(promises)
                    console.log('UPDATED')
                    promises = []
                }
            }

            for (let n = 0; n < milestonesList.length; n++) {
                const milestone = milestonesList[n]

                promises.push(
                    appAdmin
                        .firestore()
                        .doc(`goalsMilestones/${project.id}/milestonesItems/${milestone.id}`)
                        .update({ ownerId })
                )

                if (promises.length > 200) {
                    await Promise.all(promises)
                    console.log('UPDATED')
                    promises = []
                }
            }
        }

        await Promise.all(promises)
    }
    console.log('done')
}

async function setGuideProjectIdsPropertyInUsersLast(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        promises.push(
            appAdmin.firestore().doc(`users/${user.uid}`).update({
                guideProjectIds: [],
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function addGuideProjectIdsPropertyInUsers(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const { parentTemplateId, userIds } = project
        if (parentTemplateId && userIds && userIds.length > 0) {
            userIds.forEach(userId => {
                promises.push(
                    appAdmin
                        .firestore()
                        .doc(`users/${userId}`)
                        .update({
                            guideProjectIds: admin.firestore.FieldValue.arrayUnion(project.id),
                        })
                )
            })
        }
        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function changeNameOfGuideProjectIdPropertyForGuideProjectIdInTemplates(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').where('isTemplate', '==', true).get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)
        const { guideProjectId } = project

        promises.push(
            appAdmin
                .firestore()
                .doc(`projects/${project.id}`)
                .update({
                    guideProjectId: admin.firestore.FieldValue.delete(),
                    guideProjectIds: guideProjectId ? [guideProjectId] : [],
                })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function addActiveGuideIdAndRemoveHideGuides(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        console.log(user.displayName)
        promises.push(
            appAdmin.firestore().doc(`users/${user.uid}`).update({
                hideGuides: admin.firestore.FieldValue.delete(),
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function getContactConvertedIntoUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { projectIds } = user

        if (!projectIds) {
            console.log(user.uid)
        }
    }
    console.log('DONE')
}

async function setLinkedToTemplatePropertyInNotes(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const notesDocs = (await appAdmin.firestore().collection(`noteItems/${project.id}/notes`).get()).docs

        const notesList = []
        notesDocs.forEach(noteDoc => {
            const note = noteDoc.data()
            note.id = noteDoc.id
            notesList.push(note)
        })

        let promises = []

        for (let k = 0; k < notesList.length; k++) {
            const note = notesList[k]

            promises.push(
                appAdmin.firestore().doc(`noteItems/${project.id}/notes/${note.id}`).update({
                    linkedToTemplate: false,
                })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }

        await Promise.all(promises)
    }
    console.log('done')
}

async function removeActiveGuideIdPropertyFromUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        console.log(user.displayName)
        promises.push(
            appAdmin.firestore().doc(`users/${user.uid}`).update({
                activeGuideId: admin.firestore.FieldValue.delete(),
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setDefaultColorInProject(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const { color } = project

        if (!color || color === '#00CEC9') {
            promises.push(
                appAdmin.firestore().doc(`projects/${project.id}`).update({
                    color: '#47A3FF',
                })
            )
        }

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function renameAllProjectToTeam(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const doc = await appAdmin.firestore().doc(`projectsWorkstreams/${project.id}/workstreams/ws@default`).get()
        if (doc.data()) {
            promises.push(
                appAdmin
                    .firestore()
                    .doc(`projectsWorkstreams/${project.id}/workstreams/ws@default`)
                    .update({ displayName: 'Team' })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function convertGolfByProjectIntoGlobalGoldInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { gold, displayName } = user
        console.log(displayName)

        let total = 0
        if (gold) {
            const goldByProjectValues = Object.values(gold)
            goldByProjectValues.forEach(goldP => {
                total += goldP
            })
        }

        promises.push(
            appAdmin.firestore().doc(`users/${user.uid}`).update({
                gold: total,
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setDailyGoldInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { displayName } = user
        console.log(displayName)

        promises.push(
            appAdmin.firestore().doc(`users/${user.uid}`).update({
                dailyGold: 150,
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function updateStructureOfDoneProgressDataInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        let promises = []
        promises.push(
            (await appAdmin.firestore().collection(`goalsMilestones/${project.id}/milestonesItems`).get()).docs
        )
        promises.push((await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs)

        const [milestonesDocs, goalsDocs] = await Promise.all(promises)

        const milestonesMap = {}
        milestonesDocs.forEach(doc => {
            const milestone = doc.data()
            milestone.id = doc.id
            milestonesMap[doc.id] = milestone
        })

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        promises = []
        for (let n = 0; n < goalsList.length; n++) {
            const goal = goalsList[n]
            const { progressByDoneMilestone } = goal

            if (progressByDoneMilestone) {
                const newProgressByDoneMilestone = {}
                const milestoneIds = Object.keys(progressByDoneMilestone)
                milestoneIds.forEach(id => {
                    newProgressByDoneMilestone[id] = {
                        progress: progressByDoneMilestone[id],
                        doneDate: milestonesMap[id].doneDate ? milestonesMap[id].doneDate : milestonesMap[id].date,
                    }
                })

                const updateObject = { progressByDoneMilestone: newProgressByDoneMilestone }
                promises.push(appAdmin.firestore().doc(`goals/${project.id}/items/${goal.id}`).update(updateObject))

                if (promises.length > 200) {
                    await Promise.all(promises)
                    console.log('UPDATED')
                    promises = []
                }
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

async function cleanProjectIdsInUser(appAdmin) {
    const userDocs = (await appAdmin.firestore().collection('users').get()).docs
    const users = []
    userDocs.forEach(doc => {
        const uid = doc.id
        const user = doc.data()
        user.uid = uid
        users.push(user)
    })

    const updateUserData = async user => {
        const { uid, projectIds, archivedProjectIds, templateProjectIds, guideProjectIds } = user

        const newProjectIds = []
        const newArchivedProjectIds = []
        const newTemplateProjectIds = []
        const newGuideProjectIds = []

        const projectDocs = (
            await appAdmin.firestore().collection('projects').where('userIds', 'array-contains', uid).get()
        ).docs

        projectDocs.forEach(doc => {
            const projectId = doc.id
            const project = doc.data()
            const { isTemplate, parentTemplateId } = project
            const isGuide = !!parentTemplateId

            if (projectIds && projectIds.includes(projectId)) newProjectIds.push(projectId)
            if (archivedProjectIds && archivedProjectIds.includes(projectId)) newArchivedProjectIds.push(projectId)
            if (templateProjectIds && isTemplate && templateProjectIds.includes(projectId))
                newTemplateProjectIds.push(projectId)
            if (guideProjectIds && isGuide && guideProjectIds.includes(projectId)) newGuideProjectIds.push(projectId)
        })

        await appAdmin.firestore().doc(`users/${uid}`).update({
            projectIds: newProjectIds,
            archivedProjectIds: newArchivedProjectIds,
            templateProjectIds: newTemplateProjectIds,
            guideProjectIds: newGuideProjectIds,
        })
    }

    let promises = []

    for (let i = 0; i < users.length; i++) {
        console.log(`${i} ${users[i].displayName}`)
        if (promises.length >= 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
        promises.push(updateUserData(users[i]))
    }
    await Promise.all(promises)
    console.log('done')
}

async function setLastLoggedUserDateAndIndexedInAlgoliaInProjects(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        promises.push(
            appAdmin
                .firestore()
                .doc(`projects/${project.id}`)
                .update({ lastLoggedUserDate: Date.now(), indexedInAlgolia: true })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function updateDoneDateInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        let promises = []
        promises.push(
            (await appAdmin.firestore().collection(`goalsMilestones/${project.id}/milestonesItems`).get()).docs
        )
        promises.push((await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs)

        const [milestonesDocs, goalsDocs] = await Promise.all(promises)

        const milestonesMap = {}
        milestonesDocs.forEach(doc => {
            const milestone = doc.data()
            milestone.id = doc.id
            milestonesMap[doc.id] = milestone
        })

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        promises = []
        for (let n = 0; n < goalsList.length; n++) {
            const goal = goalsList[n]
            const { progressByDoneMilestone } = goal

            if (progressByDoneMilestone) {
                const newProgressByDoneMilestone = {}
                const milestoneIds = Object.keys(progressByDoneMilestone)
                milestoneIds.forEach(id => {
                    newProgressByDoneMilestone[id] = {
                        progress: progressByDoneMilestone[id].progress,
                        doneDate: milestonesMap[id].doneDate ? milestonesMap[id].doneDate : milestonesMap[id].date,
                    }
                })

                const updateObject = { progressByDoneMilestone: newProgressByDoneMilestone }
                promises.push(appAdmin.firestore().doc(`goals/${project.id}/items/${goal.id}`).update(updateObject))

                if (promises.length > 200) {
                    await Promise.all(promises)
                    console.log('UPDATED')
                    promises = []
                }
            }
        }
        await Promise.all(promises)
    }
    console.log('done')
}

//////////////LASTSSSSSS

async function setDefaultProjectInUsers(appAdmin) {
    const userDocs = (await appAdmin.firestore().collection('users').get()).docs
    const users = []
    userDocs.forEach(doc => {
        const uid = doc.id
        const user = doc.data()
        user.uid = uid
        users.push(user)
    })

    const updateUserData = async user => {
        const { uid, projectIds, archivedProjectIds, templateProjectIds, guideProjectIds } = user

        const projectDocs = (
            await appAdmin
                .firestore()
                .collection('projects')
                .where('userIds', 'array-contains', uid)
                .orderBy('created', 'asc')
                .get()
        ).docs

        let defaultProjectId = ''
        projectDocs.forEach(doc => {
            const projectId = doc.id

            if (
                !defaultProjectId &&
                projectIds &&
                projectIds.includes(projectId) &&
                (!archivedProjectIds || !archivedProjectIds.includes(projectId)) &&
                (!templateProjectIds || !templateProjectIds.includes(projectId)) &&
                (!guideProjectIds || !guideProjectIds.includes(projectId))
            ) {
                defaultProjectId = projectId
            }
        })

        await appAdmin.firestore().doc(`users/${uid}`).update({ defaultProjectId })
    }

    let promises = []

    for (let i = 0; i < users.length; i++) {
        console.log(`${i} ${users[i].displayName}`)
        if (promises.length >= 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
        promises.push(updateUserData(users[i]))
    }
    await Promise.all(promises)
    console.log('done')
}

async function setTemplateAndGuideDataInProjects(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const { isTemplate, parentTemplateId } = project

        const updateData = {}
        if (!isTemplate) updateData.isTemplate = false
        if (!parentTemplateId) updateData.parentTemplateId = ''

        if (!isTemplate || !parentTemplateId) {
            promises.push(appAdmin.firestore().doc(`projects/${project.id}`).update(updateData))
        }

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

/////////////SCRIPTS FROM DELETE USER

async function removeUserDataFromChatComments(appAdmin) {
    const removeDataInComment = async (projectId, objectType, objectId, commentId) => {
        await appAdmin
            .firestore()
            .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)
            .update({
                avatarUrl: admin.firestore.FieldValue.delete(),
                creatorAvatarURL: admin.firestore.FieldValue.delete(),
                creatorName: admin.firestore.FieldValue.delete(),
                creatorUserName: admin.firestore.FieldValue.delete(),
            })
    }

    const removeDataInObject = async (projectId, objectType, objectId) => {
        const cDocs = (
            await appAdmin.firestore().collection(`chatComments/${projectId}/${objectType}/${objectId}/comments`).get()
        ).docs

        const promises = []
        cDocs.forEach(doc => {
            promises.push(removeDataInComment(projectId, objectType, objectId, doc.id))
        })
        await Promise.all(promises)
    }

    const removeDataInType = async (projectId, objectType) => {
        const oDocs = (await appAdmin.firestore().collection(`chatComments/${projectId}/${objectType}`).get()).docs

        const promises = []
        oDocs.forEach(doc => {
            promises.push(removeDataInObject(projectId, objectType, doc.id))
        })
        await Promise.all(promises)
    }

    const removeDataInProject = async projectId => {
        const objectTypes = ['tasks', 'topics', 'notes', 'contacts', 'goals', 'skills', 'assistants']

        const promises = []
        for (let n = 0; n < objectTypes.length; n++) {
            promises.push(removeDataInType(projectId, objectTypes[n]))
        }
        await Promise.all(promises)
    }

    const pDocs = await appAdmin.firestore().collection('projects').get()
    const projectIds = []
    pDocs.forEach(doc => {
        projectIds.push(doc.id)
    })

    for (let i = 0; i < projectIds.length; i++) {
        console.log(`PROJECT NO: ${i}/${projectIds.length - 1}`)
        await removeDataInProject(projectIds[i])
    }

    console.log('done')
}

async function updateUserDataInChatEditData(appAdmin) {
    const updateDataInChat = async (projectId, objectId, editorId) => {
        await appAdmin
            .firestore()
            .doc(`chatObjects/${projectId}/chats/${objectId}`)
            .update({
                [`lastEdited.userName`]: admin.firestore.FieldValue.delete(),
                [`lastEdited.editorId`]: editorId,
            })
    }

    const updateDataInProject = async projectId => {
        const cDocs = (await appAdmin.firestore().collection(`chatObjects/${projectId}/chats`).get()).docs

        const promises = []
        cDocs.forEach(doc => {
            const chat = doc.data()
            promises.push(updateDataInChat(projectId, doc.id, chat.creatorId))
        })
        await Promise.all(promises)
    }

    const pDocs = await appAdmin.firestore().collection('projects').get()
    const projectIds = []
    pDocs.forEach(doc => {
        projectIds.push(doc.id)
    })

    for (let i = 0; i < projectIds.length; i++) {
        console.log(`PROJECT NO: ${i}/${projectIds.length - 1}`)
        await updateDataInProject(projectIds[i])
    }

    console.log('done')
}

async function updateUserDataInCommunityNotesEditData(appAdmin) {
    const updateDataInNote = async (projectId, objectId, editorId) => {
        await appAdmin
            .firestore()
            .doc(`communityNotes/${projectId}/notes/${objectId}`)
            .update({
                [`lastEdited.userName`]: admin.firestore.FieldValue.delete(),
                [`lastEdited.editorId`]: editorId,
                creatorPhotoURL: admin.firestore.FieldValue.delete(),
            })
    }

    const updateDataInProject = async projectId => {
        const docs = (await appAdmin.firestore().collection(`communityNotes/${projectId}/notes`).get()).docs

        const promises = []
        docs.forEach(doc => {
            const note = doc.data()
            promises.push(updateDataInNote(projectId, doc.id, note.creatorId))
        })
        await Promise.all(promises)
    }

    const cDocs = await appAdmin.firestore().collection('communities').get()
    const communityIds = []
    cDocs.forEach(doc => {
        communityIds.push(doc.id)
    })

    for (let i = 0; i < communityIds.length; i++) {
        console.log(`COMMUNITY NO: ${i}/${communityIds.length - 1}`)
        await updateDataInProject(communityIds[i])
    }

    console.log('done')
}

async function updateUserDataInCommunityDailyNotesEditData(appAdmin) {
    const updateDataInNote = async (projectId, objectId, editorId) => {
        await appAdmin
            .firestore()
            .doc(`communityNoteItemsDailyVersions/${projectId}/notes/${objectId}`)
            .update({
                [`lastEdited.userName`]: admin.firestore.FieldValue.delete(),
                [`lastEdited.editorId`]: editorId,
                creatorPhotoURL: admin.firestore.FieldValue.delete(),
            })
    }

    const updateDataInProject = async projectId => {
        const docs = (await appAdmin.firestore().collection(`communityNoteItemsDailyVersions/${projectId}/notes`).get())
            .docs

        const promises = []
        docs.forEach(doc => {
            const note = doc.data()
            promises.push(updateDataInNote(projectId, doc.id, note.creatorId))
        })
        await Promise.all(promises)
    }

    const cDocs = await appAdmin.firestore().collection('communities').get()
    const communityIds = []
    cDocs.forEach(doc => {
        communityIds.push(doc.id)
    })

    for (let i = 0; i < communityIds.length; i++) {
        console.log(`COMMUNITY NO: ${i}/${communityIds.length - 1}`)
        await updateDataInProject(communityIds[i])
    }

    console.log('done')
}

async function updateUserDataInCommunityVersionNotesEditData(appAdmin) {
    const updateDataInVersion = async (projectId, noteId, versionId, editorId) => {
        await appAdmin
            .firestore()
            .doc(`communityNoteItemsVersions/${projectId}/${noteId}/${versionId}`)
            .update({
                [`lastEdited.userName`]: admin.firestore.FieldValue.delete(),
                [`lastEdited.editorId`]: editorId,
                creatorPhotoURL: admin.firestore.FieldValue.delete(),
            })
    }

    const updateDataInNote = async (projectId, noteId) => {
        const docs = (await appAdmin.firestore().collection(`communityNoteItemsVersions/${projectId}/${noteId}`).get())
            .docs

        const promises = []
        docs.forEach(doc => {
            const noteVersion = doc.data()
            promises.push(updateDataInVersion(projectId, noteId, doc.id, noteVersion.creatorId))
        })
        await Promise.all(promises)
    }

    const updateDataInProject = async projectId => {
        const docs = (await appAdmin.firestore().collection(`communityNotes/${projectId}/notes`).get()).docs

        const promises = []
        docs.forEach(doc => {
            promises.push(updateDataInNote(projectId, doc.id))
        })
        await Promise.all(promises)
    }

    const cDocs = await appAdmin.firestore().collection('communities').get()
    const communityIds = []
    cDocs.forEach(doc => {
        communityIds.push(doc.id)
    })

    for (let i = 0; i < communityIds.length; i++) {
        console.log(`COMMUNITY NO: ${i}/${communityIds.length - 1}`)
        await updateDataInProject(communityIds[i])
    }

    console.log('done')
}

async function updateUserDataInNotesEditData(appAdmin) {
    const updateDataInNote = async (projectId, objectId, editorId) => {
        await appAdmin
            .firestore()
            .doc(`noteItems/${projectId}/notes/${objectId}`)
            .update({
                [`lastEdited.userName`]: admin.firestore.FieldValue.delete(),
                [`lastEdited.editorId`]: editorId,
                creatorPhotoURL: admin.firestore.FieldValue.delete(),
            })
    }

    const updateDataInProject = async projectId => {
        const docs = (await appAdmin.firestore().collection(`noteItems/${projectId}/notes`).get()).docs

        const promises = []
        docs.forEach(doc => {
            const note = doc.data()
            promises.push(updateDataInNote(projectId, doc.id, note.creatorId))
        })
        await Promise.all(promises)
    }

    const pDocs = await appAdmin.firestore().collection('projects').get()
    const projectIds = []
    pDocs.forEach(doc => {
        projectIds.push(doc.id)
    })

    for (let i = 0; i < projectIds.length; i++) {
        console.log(`PROJECT NO: ${i}/${projectIds.length - 1}`)
        await updateDataInProject(projectIds[i])
    }

    console.log('done')
}

async function updateUserDataInDailyNotesEditData(appAdmin) {
    const updateDataInNote = async (projectId, objectId, editorId) => {
        await appAdmin
            .firestore()
            .doc(`noteItemsDailyVersions/${projectId}/notes/${objectId}`)
            .update({
                [`lastEdited.userName`]: admin.firestore.FieldValue.delete(),
                [`lastEdited.editorId`]: editorId,
                creatorPhotoURL: admin.firestore.FieldValue.delete(),
            })
    }

    const updateDataInProject = async projectId => {
        const docs = (await appAdmin.firestore().collection(`noteItemsDailyVersions/${projectId}/notes`).get()).docs

        const promises = []
        docs.forEach(doc => {
            const note = doc.data()
            promises.push(updateDataInNote(projectId, doc.id, note.creatorId))
        })
        await Promise.all(promises)
    }

    const pDocs = await appAdmin.firestore().collection('projects').get()
    const projectIds = []
    pDocs.forEach(doc => {
        projectIds.push(doc.id)
    })

    for (let i = 0; i < projectIds.length; i++) {
        console.log(`PROJECT NO: ${i}/${projectIds.length - 1}`)
        await updateDataInProject(projectIds[i])
    }

    console.log('done')
}

async function updateUserDataInVersionNotesEditData(appAdmin) {
    const updateDataInVersion = async (projectId, noteId, versionId, editorId) => {
        await appAdmin
            .firestore()
            .doc(`noteItemsVersions/${projectId}/${noteId}/${versionId}`)
            .update({
                [`lastEdited.userName`]: admin.firestore.FieldValue.delete(),
                [`lastEdited.editorId`]: editorId,
                creatorPhotoURL: admin.firestore.FieldValue.delete(),
            })
    }

    const updateDataInNote = async (projectId, noteId) => {
        const docs = (await appAdmin.firestore().collection(`noteItemsVersions/${projectId}/${noteId}`).get()).docs

        const promises = []
        docs.forEach(doc => {
            const noteVersion = doc.data()
            promises.push(updateDataInVersion(projectId, noteId, doc.id, noteVersion.creatorId))
        })
        await Promise.all(promises)
    }

    const updateDataInProject = async projectId => {
        const docs = (await appAdmin.firestore().collection(`noteItems/${projectId}/notes`).get()).docs

        const promises = []
        docs.forEach(doc => {
            promises.push(updateDataInNote(projectId, doc.id))
        })
        await Promise.all(promises)
    }

    const pDocs = await appAdmin.firestore().collection('projects').get()
    const projectIds = []
    pDocs.forEach(doc => {
        projectIds.push(doc.id)
    })

    for (let i = 0; i < projectIds.length; i++) {
        console.log(`PROJECT NO: ${i}/${projectIds.length - 1}`)
        await updateDataInProject(projectIds[i])
    }

    console.log('done')
}

async function removeCommentsAndCommentsInfo(appAdmin) {
    const projectEnv = 'alldonestaging'
    await recursiveDeleteHelper(firebase_tools, projectEnv, 'comments')
    await recursiveDeleteHelper(firebase_tools, projectEnv, 'commentsInfo')
    console.log('done')
}

async function setPreviousStatisticsModalDateToUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { statisticsModalDate } = user
        appAdmin.firestore().doc(`users/${user.uid}`).update({
            previousStatisticsModalDate: statisticsModalDate,
        })
    }
    console.log('done')
}

async function updateEditionDataInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []

        for (let k = 0; k < goalsList.length; k++) {
            const goal = goalsList[k]
            const { creatorId } = goal

            promises.push(
                appAdmin
                    .firestore()
                    .doc(`goals/${project.id}/items/${goal.id}`)
                    .update({
                        lastEditorName: admin.firestore.FieldValue.delete(),
                        lastEditorId: creatorId ? creatorId : '',
                    })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }

        await Promise.all(promises)
    }
    console.log('done')
}

async function updateEditionDataInSkills(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const docs = (await appAdmin.firestore().collection(`skills/${project.id}/items`).get()).docs

        const list = []
        docs.forEach(doc => {
            const item = doc.data()
            item.id = doc.id
            list.push(item)
        })

        let promises = []

        for (let k = 0; k < list.length; k++) {
            const item = list[k]
            const { userId } = item

            promises.push(
                appAdmin
                    .firestore()
                    .doc(`skills/${project.id}/items/${item.id}`)
                    .update({
                        lastEditorName: admin.firestore.FieldValue.delete(),
                        lastEditorId: userId ? userId : '',
                    })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }

        await Promise.all(promises)
    }
    console.log('done')
}

async function removeXpPoints(appAdmin) {
    const projectEnv = 'alldonestaging'
    //const projectEnv = 'alldonealeph'

    await recursiveDeleteHelper(firebase_tools, projectEnv, 'xpPoints')
    console.log('done')
}

async function removeLastChangeUserIdFromNotes(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const docs = (await appAdmin.firestore().collection(`noteItems/${project.id}/notes`).get()).docs

        const list = []
        docs.forEach(doc => {
            const item = doc.data()
            item.id = doc.id
            list.push(item)
        })

        let promises = []

        for (let k = 0; k < list.length; k++) {
            const item = list[k]

            promises.push(
                appAdmin.firestore().doc(`noteItems/${project.id}/notes/${item.id}`).update({
                    lastChangeUserId: admin.firestore.FieldValue.delete(),
                })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }

        await Promise.all(promises)
    }
    console.log('done')
}

async function updateObjectNotesCreatorId(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    const updateCreatorId = async (projectId, note, promises, appAdmin) => {
        const { parentObject } = note
        const { id, type } = parentObject

        let creatorId = note.creatorId

        if (type === 'topics') {
            const data = (await appAdmin.firestore().doc(`chatObjects/${projectId}/chats/${id}`).get()).data()
            if (data) creatorId = data.creatorId
        } else if (type === 'contacts') {
            const data = (await appAdmin.firestore().doc(`projectsContacts/${projectId}/contacts/${id}`).get()).data()
            if (data) creatorId = data.recorderUserId
        } else if (type === 'goals') {
            const data = (await appAdmin.firestore().doc(`goals/${projectId}/items/${id}`).get()).data()
            if (data) creatorId = data.creatorId
        } else if (type === 'skills') {
            const data = (await appAdmin.firestore().doc(`skills/${projectId}/items/${id}`).get()).data()
            if (data) creatorId = data.userId
        } else if (type === 'tasks') {
            const data = (await appAdmin.firestore().doc(`items/${projectId}/tasks/${id}`).get()).data()
            if (data) creatorId = data.creatorId
        } else if (type === 'users') {
            if (id) creatorId = id
        }

        if (creatorId) {
            promises.push(
                appAdmin.firestore().doc(`noteItems/${projectId}/notes/${note.id}`).update({
                    creatorId,
                })
            )
        }
    }

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const docs = (
            await appAdmin
                .firestore()
                .collection(`noteItems/${project.id}/notes`)
                .where('parentObject', '!=', null)
                .get()
        ).docs

        const list = []
        docs.forEach(doc => {
            const item = doc.data()
            item.id = doc.id
            list.push(item)
        })

        let promises = []

        for (let k = 0; k < list.length; k++) {
            const item = list[k]

            promises.push(updateCreatorId(project.id, item, promises, appAdmin))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }

        await Promise.all(promises)
    }
    console.log('done')
}

async function updateChatsCreatorId(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    const updateCreatorId = async (projectId, chat, promises, appAdmin) => {
        const { id, type } = chat

        let creatorId = chat.creatorId

        if (type === 'contacts') {
            const data = (await appAdmin.firestore().doc(`projectsContacts/${projectId}/contacts/${id}`).get()).data()
            if (data) {
                creatorId = data.recorderUserId
            } else {
                const userData = (await appAdmin.firestore().doc(`users/${id}`).get()).data()
                if (userData) creatorId = id
            }
        } else if (type === 'goals') {
            const data = (await appAdmin.firestore().doc(`goals/${projectId}/items/${id}`).get()).data()
            if (data) creatorId = data.creatorId
        } else if (type === 'skills') {
            const data = (await appAdmin.firestore().doc(`skills/${projectId}/items/${id}`).get()).data()
            if (data) creatorId = data.userId
        } else if (type === 'tasks') {
            const data = (await appAdmin.firestore().doc(`items/${projectId}/tasks/${id}`).get()).data()
            if (data) creatorId = data.creatorId
        } else if (type === 'notes') {
            const data = (await appAdmin.firestore().doc(`noteItems/${projectId}/notes/${id}`).get()).data()
            if (data) creatorId = data.creatorId
        }

        if (creatorId) {
            promises.push(
                appAdmin.firestore().doc(`chatObjects/${projectId}/chats/${id}`).update({
                    creatorId,
                })
            )
        }
    }

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const docs = (
            await appAdmin.firestore().collection(`chatObjects/${project.id}/chats`).where('type', '!=', 'topics').get()
        ).docs

        const list = []
        docs.forEach(doc => {
            const item = doc.data()
            item.id = doc.id
            list.push(item)
        })

        let promises = []

        for (let k = 0; k < list.length; k++) {
            const item = list[k]

            promises.push(updateCreatorId(project.id, item, promises, appAdmin))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }

        await Promise.all(promises)
    }
    console.log('done')
}

async function updateSortIndexInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []

        for (let k = 0; k < goalsList.length; k++) {
            const goal = goalsList[k]
            const { sortIndexByMilestone } = goal

            const newSortIndexByMilestone = {}
            const milestoneIds = sortIndexByMilestone ? Object.keys(sortIndexByMilestone) : []
            milestoneIds.forEach(id => {
                newSortIndexByMilestone[id] = {
                    ...sortIndexByMilestone[id],
                    allGoals: moment().valueOf(),
                }
            })

            promises.push(
                appAdmin.firestore().doc(`goals/${project.id}/items/${goal.id}`).update({
                    sortIndexByMilestone: newSortIndexByMilestone,
                })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }

        await Promise.all(promises)
    }
    console.log('done')
}

async function updateWorkflowData(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    const promises = []
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { workflow, uid } = user
        if (workflow) {
            const projectIds = Object.keys(workflow)
            projectIds.forEach(projectId => {
                const stepIds = Object.keys(workflow[projectId])
                stepIds.forEach(stepId => {
                    workflow[projectId][stepId].addedById = uid
                    delete workflow[projectId][stepId].addedBy
                    delete workflow[projectId][stepId].reviewerName
                    delete workflow[projectId][stepId].reviewerPhotoURL
                })
            })
            promises.push(
                appAdmin.firestore().doc(`users/${user.uid}`).update({
                    workflow,
                })
            )
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function updateAllGoalsSection(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    const promises = []
    console.log(userList.length)
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { projectIds, guideProjectIds, uid } = user
        console.log(user.displayName)
        if (projectIds) {
            const notGuideProjectIds = guideProjectIds
                ? projectIds.filter(projectId => !guideProjectIds.includes(projectId))
                : projectIds

            notGuideProjectIds.forEach(projectId => {
                const allGoals = { lastVisitBoardInGoals: Date.now() }
                promises.push(
                    appAdmin.firestore().doc(`allSections/${projectId}/${uid}/allGoals`).set(allGoals, { merge: true })
                )
            })

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function updateSortIndexInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []

        for (let k = 0; k < goalsList.length; k++) {
            const goal = goalsList[k]
            const { sortIndexByMilestone } = goal

            const newSortIndexByMilestone = {}
            const milestoneIds = sortIndexByMilestone ? Object.keys(sortIndexByMilestone) : []
            milestoneIds.forEach(id => {
                const values = Object.values(sortIndexByMilestone[id])
                const newValue = values[0] ? values[0] : moment().valueOf()
                newSortIndexByMilestone[id] = newValue
            })

            promises.push(
                appAdmin.firestore().doc(`goals/${project.id}/items/${goal.id}`).update({
                    sortIndexByMilestone: newSortIndexByMilestone,
                })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }

        await Promise.all(promises)
    }
    console.log('done')
}

async function removeCommunityCollections(appAdmin) {
    const projectEnv = 'alldonestaging'
    //const projectEnv = 'alldonealeph'

    await recursiveDeleteHelper(firebase_tools, projectEnv, 'permissions')
    await recursiveDeleteHelper(firebase_tools, projectEnv, 'communities')
    await recursiveDeleteHelper(firebase_tools, projectEnv, 'communityNoteItemsVersions')
    await recursiveDeleteHelper(firebase_tools, projectEnv, 'communityNotes')
    console.log('done')
}

async function updateDialyTopicDate(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    const promises = []
    console.log(userList.length)
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { uid, statisticsModalDate, previousStatisticsModalDate } = user
        console.log(user.displayName)

        promises.push(
            appAdmin
                .firestore()
                .doc(`users/${uid}`)
                .update({
                    dailyTopicDate: statisticsModalDate ? statisticsModalDate : Date.now(),
                    previousDailyTopicDate: previousStatisticsModalDate ? previousStatisticsModalDate : Date.now(),
                })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

///////////UNLOCK GOALS

async function updateUnlockedKeysByGuidesPropertyInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    const promises = []
    console.log(userList.length)
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { uid } = user
        console.log(user.displayName)

        promises.push(
            appAdmin.firestore().doc(`users/${uid}`).update({
                unlockedKeysByGuides: {},
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function updateLockKeyPropertyInGoals(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const goalsDocs = (await appAdmin.firestore().collection(`goals/${project.id}/items`).get()).docs

        const goalsList = []
        goalsDocs.forEach(goalDoc => {
            const goal = goalDoc.data()
            goal.id = goalDoc.id
            goalsList.push(goal)
        })

        let promises = []

        for (let k = 0; k < goalsList.length; k++) {
            const goal = goalsList[k]

            promises.push(
                appAdmin.firestore().doc(`goals/${project.id}/items/${goal.id}`).update({
                    lockKey: '',
                })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATED')
                promises = []
            }
        }

        await Promise.all(promises)
    }
    console.log('done')
}

async function updateLockKeyPropertyInTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]

            if (task.lockKey === undefined) {
                promises.push(appAdmin.firestore().doc(`items/${project.id}/tasks/${task.id}`).update({ lockKey: '' }))

                if (promises.length > 200) {
                    await Promise.all(promises)
                    console.log('UPDATE')
                    promises = []
                }
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function updateVisitBoardsPropertiesInContacts() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const objectDocs = (await appAdmin.firestore().collection(`projectsContacts/${project.id}/contacts`).get()).docs
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const objects = []
        objectDocs.forEach(doc => {
            const object = { ...doc.data(), id: doc.id }
            objects.push(object)
        })

        for (let n = 0; n < objects.length; n++) {
            const object = objects[n]
            const { lastVisitBoard, lastVisitBoardInGoals } = object
            if (!lastVisitBoard || !lastVisitBoardInGoals) {
                const updateData = {}
                if (!lastVisitBoard) updateData.lastVisitBoard = {}
                if (!lastVisitBoardInGoals) updateData.lastVisitBoardInGoals = {}

                promises.push(
                    appAdmin.firestore().doc(`projectsContacts/${project.id}/contacts/${object.id}`).update(updateData)
                )

                if (promises.length > 200) {
                    await Promise.all(promises)
                    console.log('UPDATE')
                    promises = []
                }
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setGlobalAssistantIdsInProjects() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        promises.push(
            appAdmin
                .firestore()
                .doc(`projects/${project.id}`)
                .update({ globalAssistantIds: admin.firestore.FieldValue.arrayUnion('-NrGgsBOEeiThnIAaasb') })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setAssistantIdInObjects() {
    const type = 'tasks'

    const projects = type === 'users' ? [] : (await appAdmin.firestore().collection('projects').get()).docs

    let projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    if (type === 'users') projectsList = [{ name: 'test' }]

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]

        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        let path = ''

        if (type === 'tasks') path = `items/${project.id}/tasks`
        else if (type === 'chats') path = `chatObjects/${project.id}/chats`
        else if (type === 'contacts') path = `projectsContacts/${project.id}/contacts`
        else if (type === 'skills') path = `skills/${project.id}/items`
        else if (type === 'notes') path = `noteItems/${project.id}/notes`
        else if (type === 'goals') path = `goals/${project.id}/items`
        else if (type === 'users') path = `users`

        const objectDocs = (await appAdmin.firestore().collection(path).get()).docs

        const objects = []
        objectDocs.forEach(doc => {
            const object = { ...doc.data(), id: doc.id }
            objects.push(object)
        })

        for (let n = 0; n < objects.length; n++) {
            const object = objects[n]
            const { assistantId, linkedParentAssistantIds } = object

            if (type === 'tasks' || type === 'notes') {
                if (
                    assistantId === null ||
                    assistantId === undefined ||
                    linkedParentAssistantIds === null ||
                    linkedParentAssistantIds === undefined
                ) {
                    const updateData = {}
                    if (assistantId === null || assistantId === undefined) updateData.assistantId = ''
                    if (linkedParentAssistantIds === null || linkedParentAssistantIds === undefined)
                        updateData.linkedParentAssistantIds = []

                    promises.push(appAdmin.firestore().doc(`${path}/${object.id}`).update(updateData))
                }
            } else {
                if (assistantId === null || assistantId === undefined) {
                    promises.push(appAdmin.firestore().doc(`${path}/${object.id}`).update({ assistantId: '' }))
                }
            }

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }

    await Promise.all(promises)
    console.log('DONE')
}

async function setNoteIdsByProjectInAssistants() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = [{ name: 'Global', id: 'globalProject' }]
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const objectDocs = (await appAdmin.firestore().collection(`assistants/${project.id}/items`).get()).docs
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const objects = []
        objectDocs.forEach(doc => {
            const object = { ...doc.data(), id: doc.id }
            objects.push(object)
        })

        for (let n = 0; n < objects.length; n++) {
            const object = objects[n]

            promises.push(
                appAdmin.firestore().doc(`assistants/${project.id}/items/${object.id}`).update({ noteIdsByProject: {} })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setNoteIdsByProjectInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    const promises = []
    console.log(userList.length)
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { uid } = user
        console.log(user.displayName)

        promises.push(
            appAdmin.firestore().doc(`users/${uid}`).update({
                noteIdsByProject: {},
                noteId: admin.firestore.FieldValue.delete(),
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function removeLastLoggedUserDateAndIndexedInAlgoliaInProjects(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        promises.push(
            appAdmin
                .firestore()
                .doc(`projects/${project.id}`)
                .update({ lastLoggedUserDate: admin.firestore.FieldValue.delete(), indexedInAlgolia: false })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function setLastDateSearchModalOpenInProjects(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        promises.push(
            appAdmin
                .firestore()
                .doc(`projects/${project.id}`)
                .update({ lastDateAlgoliaUsed: moment().subtract(2, 'week').valueOf() })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

/////////////////////////

async function setEditionDataInWorkstreams(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const objectDocs = (
            await appAdmin.firestore().collection(`projectsWorkstreams/${project.id}/workstreams`).get()
        ).docs
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const objects = []
        objectDocs.forEach(doc => {
            const object = { ...doc.data(), id: doc.id }
            objects.push(object)
        })

        for (let n = 0; n < objects.length; n++) {
            const object = objects[n]
            const { creatorId } = object

            promises.push(
                appAdmin
                    .firestore()
                    .doc(`projectsWorkstreams/${project.id}/workstreams/${object.id}`)
                    .update({
                        lastEditorId: creatorId || '',
                    })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setEditionDataInContacts() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const objectDocs = (await appAdmin.firestore().collection(`projectsContacts/${project.id}/contacts`).get()).docs
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const objects = []
        objectDocs.forEach(doc => {
            const object = { ...doc.data(), id: doc.id }
            objects.push(object)
        })

        for (let n = 0; n < objects.length; n++) {
            const object = objects[n]
            const { recorderUserId, lastChangeUserId, lastInteraction } = object

            promises.push(
                appAdmin
                    .firestore()
                    .doc(`projectsContacts/${project.id}/contacts/${object.id}`)
                    .update({
                        lastEditorId: lastChangeUserId || recorderUserId || '',
                        lastEditionDate: (lastInteraction && lastInteraction[project.id]?.dateTime) || Date.now(),
                        lastChangeUserId: admin.firestore.FieldValue.delete(),
                        lastInteraction: admin.firestore.FieldValue.delete(),
                    })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setEditionDataInNotes() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const objectDocs = (await appAdmin.firestore().collection(`noteItems/${project.id}/notes`).get()).docs
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const objects = []
        objectDocs.forEach(doc => {
            const object = { ...doc.data(), id: doc.id }
            objects.push(object)
        })

        for (let n = 0; n < objects.length; n++) {
            const object = objects[n]
            const { lastEdited, creatorId } = object

            const date = lastEdited && lastEdited.timestamp ? lastEdited.timestamp : Date.now()
            const creator = lastEdited && lastEdited.editorId ? lastEdited.editorId : creatorId || ''
            promises.push(
                appAdmin.firestore().doc(`noteItems/${project.id}/notes/${object.id}`).update({
                    lastEditorId: creator,
                    lastEditionDate: date,
                    lastEdited: admin.firestore.FieldValue.delete(),
                })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setEditionDataInChats() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const objectDocs = (await appAdmin.firestore().collection(`chatObjects/${project.id}/chats`).get()).docs
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const objects = []
        objectDocs.forEach(doc => {
            const object = { ...doc.data(), id: doc.id }
            objects.push(object)
        })

        for (let n = 0; n < objects.length; n++) {
            const object = objects[n]
            const { lastEdited, creatorId } = object

            const date =
                lastEdited && lastEdited.timestamp && lastEdited.timestamp.seconds
                    ? lastEdited.timestamp.seconds * 1000
                    : Date.now()
            const creator = lastEdited && lastEdited.editorId ? lastEdited.editorId : creatorId || ''
            const comment = lastEdited && lastEdited.lastCommentText ? lastEdited.lastCommentText : ''
            promises.push(
                appAdmin
                    .firestore()
                    .doc(`chatObjects/${project.id}/chats/${object.id}`)
                    .update({
                        lastEditorId: creator,
                        lastEditionDate: date,
                        lastCommentText: comment,
                        lastCommentOwnerId: comment ? creator : '',
                        lastEdited: admin.firestore.FieldValue.delete(),
                    })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setEditionDataInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    console.log(userList.length)
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { uid, lastChangeUserId, lastInteraction } = user
        console.log(user.displayName)

        promises.push(
            appAdmin
                .firestore()
                .doc(`users/${uid}`)
                .update({
                    lastEditorId: lastChangeUserId || uid,
                    lastEditionDate: Date.now(),
                    lastChangeUserId: admin.firestore.FieldValue.delete(),
                    lastInteraction: admin.firestore.FieldValue.delete(),
                })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function setEditionDataInTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const objectDocs = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const objects = []
        objectDocs.forEach(doc => {
            const object = { ...doc.data(), id: doc.id }
            objects.push(object)
        })

        for (let n = 0; n < objects.length; n++) {
            const object = objects[n]
            const { lastChangeUserId, dueDate, completed, done, parentDone, isSubtask, creatorId } = object

            const date = isSubtask ? (parentDone ? completed : dueDate) : done ? completed : dueDate
            promises.push(
                appAdmin
                    .firestore()
                    .doc(`items/${project.id}/tasks/${object.id}`)
                    .update({
                        lastEditorId: lastChangeUserId || creatorId || '',
                        lastEditionDate: date || Date.now(),
                        lastChangeUserId: admin.firestore.FieldValue.delete(),
                    })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setActiveFullSearchInProjects(appAdmin) {
    let promises = []
    promises.push(appAdmin.firestore().collection('users').get())
    promises.push(appAdmin.firestore().collection('projects').get())
    const [users, projects] = await Promise.all(promises)

    const usersMap = []
    users.docs.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        usersMap[userId] = user
    })

    const projectsList = []
    projects.docs.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const archivedForUsers = []
        if (project.userIds) {
            project.userIds.forEach(uid => {
                const user = usersMap[uid]
                if (user && user.archivedProjectIds && user.archivedProjectIds.includes(project.id))
                    archivedForUsers.push(uid)
            })
        }
        promises.push(
            appAdmin
                .firestore()
                .doc(`projects/${project.id}`)
                .update({
                    activeFullSearch: null,
                    archivedForUsers: uniq(archivedForUsers),
                    lastDateAlgoliaUsed: admin.firestore.FieldValue.delete(),
                    indexedInAlgolia: admin.firestore.FieldValue.delete(),
                })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

////// LASTSSSSSSSS

async function setAlgoliaDataInProjects(appAdmin) {
    const projects = await appAdmin.firestore().collection('projects').get()

    const projectsList = []
    projects.docs.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        promises.push(
            appAdmin
                .firestore()
                .doc(`projects/${project.id}`)
                .update({
                    activeFullSearch: null,
                    lastLoggedUserDate: moment().subtract(1, 'year').valueOf(),
                    active: false,
                })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function setActiveFullSearchDateInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    console.log(userList.length)
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { uid } = user
        console.log(user.displayName)

        promises.push(
            appAdmin.firestore().doc(`users/${uid}`).update({
                activeFullSearchDate: null,
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

//LASTSSSSSS

async function setCommentsDataInProjects(appAdmin) {
    const objectType = 'tasks'
    //const objectType = 'notes'
    //const objectType = 'goals'
    //const objectType = 'skills'
    //const objectType = 'assistants'
    //const objectType = 'contacts'
    //const objectType = 'chats'
    //const objectType = 'users'

    const getObjectDocPath = (projectId, objectId, objectType) => {
        if (objectType === 'tasks') {
            return appAdmin.firestore().doc(`items/${projectId}/tasks/${objectId}`)
        } else if (objectType === 'notes') {
            return appAdmin.firestore().doc(`noteItems/${projectId}/notes/${objectId}`)
        } else if (objectType === 'goals') {
            return appAdmin.firestore().doc(`goals/${projectId}/items/${objectId}`)
        } else if (objectType === 'skills') {
            return appAdmin.firestore().doc(`skills/${projectId}/items/${objectId}`)
        } else if (objectType === 'assistants') {
            return appAdmin.firestore().doc(`assistants/${projectId}/items/${objectId}`)
        } else if (objectType === 'contacts') {
            return appAdmin.firestore().doc(`projectsContacts/${projectId}/contacts/${objectId}`)
        } else if (objectType === 'chats') {
            return appAdmin.firestore().doc(`chatObjects/${projectId}/chats/${objectId}`)
        } else if (objectType === 'users') {
            return appAdmin.firestore().doc(`users/${objectId}`)
        }
    }

    const getObjectsCollectionPath = (projectId, objectType) => {
        if (objectType === 'tasks') {
            return appAdmin.firestore().collection(`items/${projectId}/tasks`)
        } else if (objectType === 'notes') {
            return appAdmin.firestore().collection(`noteItems/${projectId}/notes`)
        } else if (objectType === 'goals') {
            return appAdmin.firestore().collection(`goals/${projectId}/items`)
        } else if (objectType === 'skills') {
            return appAdmin.firestore().collection(`skills/${projectId}/items`)
        } else if (objectType === 'assistants') {
            return appAdmin.firestore().collection(`assistants/${projectId}/items`)
        } else if (objectType === 'contacts') {
            return appAdmin.firestore().collection(`projectsContacts/${projectId}/contacts`)
        } else if (objectType === 'chats') {
            return appAdmin.firestore().collection(`chatObjects/${projectId}/chats`)
        } else if (objectType === 'users') {
            return appAdmin.firestore().collection(`users`)
        }
    }

    const getCommentsPath = (projectId, objectId, objectType) => {
        if (objectType === 'tasks') {
            return appAdmin.firestore().collection(`chatComments/${projectId}/tasks/${objectId}/comments`)
        } else if (objectType === 'notes') {
            return appAdmin.firestore().collection(`chatComments/${projectId}/notes/${objectId}/comments`)
        } else if (objectType === 'goals') {
            return appAdmin.firestore().collection(`chatComments/${projectId}/goals/${objectId}/comments`)
        } else if (objectType === 'skills') {
            return appAdmin.firestore().collection(`chatComments/${projectId}/skills/${objectId}/comments`)
        } else if (objectType === 'assistants') {
            return appAdmin.firestore().collection(`chatComments/${projectId}/assistants/${objectId}/comments`)
        } else if (objectType === 'contacts') {
            return appAdmin.firestore().collection(`chatComments/${projectId}/contacts/${objectId}/comments`)
        } else if (objectType === 'chats') {
            return appAdmin.firestore().collection(`chatComments/${projectId}/topics/${objectId}/comments`)
        } else if (objectType === 'users') {
            return appAdmin.firestore().collection(`chatComments/${projectId}/contacts/${objectId}/comments`)
        }
    }

    const getCommentsData = async (projectId, objectId, objectType) => {
        const commentDocs = await getCommentsPath(projectId, objectId, objectType)
            .orderBy('lastChangeDate', 'desc')
            .get()

        if (commentDocs.docs.length > 0) {
            const { commentText, commentType, creatorId } = commentDocs.docs[0].data()
            if (commentText.trim()) {
                if (objectType === 'chats') {
                    return {
                        lastComment: commentText,
                        lastCommentType: commentType || 2,
                        lastCommentOwnerId: creatorId || '',
                        amount: commentDocs.docs.length,
                    }
                }
                return {
                    lastComment: commentText,
                    lastCommentType: commentType || 2,
                    amount: commentDocs.docs.length,
                }
            }
        }
        return null
    }

    const updateCommentsData = async (projectId, objectId, objectType) => {
        const commentsData = await getCommentsData(projectId, objectId, objectType)
        await getObjectDocPath(projectId, objectId, objectType).update({ commentsData })
    }

    const updateChatCommentsData = async (projectId, objectId, objectType) => {
        const commentsData = await getCommentsData(projectId, objectId, objectType)
        await getObjectDocPath(projectId, objectId, objectType).update({
            commentsData,
            lastCommentText: admin.firestore.FieldValue.delete(),
            lastCommentOwnerId: admin.firestore.FieldValue.delete(),
        })
    }

    const updateUserCommentsData = async (projectId, objectId, objectType) => {
        const commentsData = await getCommentsData(projectId, objectId, objectType)
        await getObjectDocPath(projectId, objectId, objectType).update({
            [`commentsData.${projectId}`]: commentsData,
        })
    }

    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const objectDocs =
            objectType === 'users'
                ? (
                      await getObjectsCollectionPath(project.id, objectType)
                          .where('projectIds', 'array-contains', project.id)
                          .get()
                  ).docs
                : (await getObjectsCollectionPath(project.id, objectType).get()).docs
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const objects = []
        objectDocs.forEach(doc => {
            const object = { ...doc.data(), id: doc.id }
            objects.push(object)
        })

        for (let n = 0; n < objects.length; n++) {
            const object = objects[n]

            if (objectType === 'chats') {
                promises.push(updateChatCommentsData(project.id, object.id, objectType))
            } else if (objectType === 'users') {
                promises.push(updateUserCommentsData(project.id, object.id, objectType))
            } else {
                promises.push(updateCommentsData(project.id, object.id, objectType))
            }

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setCommentsDataInProjects(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const tasksDoc = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(project.name)

        const tasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id }
            tasks.push(task)
        })

        for (let n = 0; n < tasks.length; n++) {
            const task = tasks[n]
            const { done, parentDone, parentId } = task

            promises.push(
                appAdmin
                    .firestore()
                    .doc(`items/${project.id}/tasks/${task.id}`)
                    .update({ inDone: !!parentId ? parentDone : done })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

//////////LAST AFTER BIG UPDATE

async function setOpenTasksAmountInContacts(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    const updateContact = async (projectId, contactId) => {
        const taskDocs = (
            await appAdmin
                .firestore()
                .collection(`items/${projectId}/tasks`)
                .where('userId', '==', contactId)
                .where('inDone', '==', false)
                .get()
        ).docs

        await appAdmin
            .firestore()
            .doc(`projectsContacts/${projectId}/contacts/${contactId}`)
            .update({ openTasksAmount: taskDocs.length })
    }

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const contactDocs = (await appAdmin.firestore().collection(`projectsContacts/${project.id}/contacts`).get())
            .docs
        console.log(project.name)

        const contacts = []
        contactDocs.forEach(doc => {
            const contact = { ...doc.data(), id: doc.id }
            contacts.push(contact)
        })

        for (let n = 0; n < contacts.length; n++) {
            const contact = contacts[n]

            promises.push(updateContact(project.id, contact.id))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setLastUserInteractionDateInProjects(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const promises2 = []

        promises2.push(
            appAdmin
                .firestore()
                .collection(`projectsContacts/${project.id}/contacts`)
                .orderBy('lastEditionDate', 'desc')
                .limit(1)
                .get()
        )

        promises2.push(
            appAdmin
                .firestore()
                .collection(`users`)
                .where('projectIds', 'array-contains-any', [project.id])
                .orderBy('lastEditionDate', 'desc')
                .limit(1)
                .get()
        )
        const [contactDocs, userDocs] = await Promise.all(promises2)

        console.log(project.name)

        const user = contactDocs.docs.length > 0 ? contactDocs.docs[0].data() : null
        const contact = userDocs.docs.length > 0 ? userDocs.docs[0].data() : null

        const userLastEditionDate = user && user.lastEditionDate ? user.lastEditionDate : 0
        const contactLastEditionDate = contact && contact.lastEditionDate ? contact.lastEditionDate : 0

        const lastEditionDate =
            userLastEditionDate > contactLastEditionDate ? userLastEditionDate : contactLastEditionDate

        // DEPRECATED: lastUserInteractionDate field has been removed, replaced with lastActionDate
        // promises.push(
        //     appAdmin.firestore().doc(`projects/${project.id}`).update({ lastUserInteractionDate: lastEditionDate })
        // )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function resetAlgoliaInProjects(appAdmin) {
    const projects = await appAdmin.firestore().collection('projects').get()

    const projectsList = []
    projects.docs.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        promises.push(
            appAdmin
                .firestore()
                .doc(`projects/${project.id}`)
                .update({
                    activeFullSearch: null,
                    lastLoggedUserDate: moment().subtract(1, 'year').valueOf(),
                    active: false,
                })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function setModalInAssistants(appAdmin) {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const assistantDocs = (await appAdmin.firestore().collection(`assistants/${project.id}/items`).get()).docs
        console.log(project.name)

        const assistants = []
        assistantDocs.forEach(doc => {
            const assistant = { ...doc.data(), id: doc.id }
            assistants.push(assistant)
        })

        for (let n = 0; n < assistants.length; n++) {
            const assistant = assistants[n]
            const { model } = assistant

            const updateData = { model: 'MODEL_GPT4O' }

            if (model === 'MODEL_GTP3_5') {
                updateData.model = 'MODEL_GPT3_5'
            }

            promises.push(appAdmin.firestore().doc(`assistants/${project.id}/items/${assistant.id}`).update(updateData))

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function exportToJsonAndCsvFiles() {
    console.log('start')
    const JSONToFile = (obj, filename) => {
        //fs.writeFileSync(`${filename}.json`, JSON.stringify(obj, null, 2))

        const csvData = csvjson.toCSV(obj, {
            headers: 'key',
        })

        fs.writeFile(`${filename}.csv`, csvData, 'utf-8', () => {})
    }

    const userId = 'lejVqrT6FBcMRRCxnBbBhQwPgSg1'
    const projects = (
        await appAdmin.firestore().collection('projects').where('userIds', 'array-contains', userId).get()
    ).docs

    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log('')
    console.log(`${projectsList.length} projects`)

    const tasks = []
    const tasksByProject = {}

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`${project.name} ${i + 1}/${projectsList.length}`)

        const tasksDoc = (
            await appAdmin.firestore().collection(`items/${project.id}/tasks`).where('userId', '==', userId).get()
        ).docs

        const projectTasks = []
        tasksDoc.forEach(doc => {
            const task = { ...doc.data(), id: doc.id, projectId: project.id }
            tasks.push(task)
            projectTasks.push(task)
        })
        tasksByProject[`${project.name ? project.name.replace(/[^0-9a-z]/gi, '') : 'NoNameProject'}`] = projectTasks

        JSONToFile(
            { tasks: projectTasks },
            `${project.name ? project.name.replace(/[^0-9a-z]/gi, '') : 'No name project'} tasks`
        )
    }

    JSONToFile(tasksByProject, 'allTasksByProject')
    JSONToFile(tasks, 'allTasks')

    console.log('done')
}

async function setTypeAndLinkInAssistantTasks(appAdmin) {
    const updateTasks = async (projectId, assistantId) => {
        const taskDocs = (await appAdmin.firestore().collection(`assistantTasks/${projectId}/${assistantId}`).get())
            .docs
        const promises = []
        taskDocs.forEach(doc => {
            promises.push(
                appAdmin
                    .firestore()
                    .doc(`assistantTasks/${projectId}/${assistantId}/${doc.id}`)
                    .update({ type: 'prompt', link: '' })
            )
        })
        await Promise.all(promises)
    }

    const updateAssistantsTasks = async project => {
        const assistantDocs = (await appAdmin.firestore().collection(`assistants/${project.id}/items`).get()).docs
        const promises = []
        assistantDocs.forEach(doc => {
            promises.push(updateTasks(project.id, doc.id))
        })
        await Promise.all(promises)
    }

    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    projectsList.push({ id: 'globalProject', name: 'Global' })

    console.log(projectsList.length)

    const promises = []
    for (let i = 0; i < projectsList.length; i++) {
        promises.push(updateAssistantsTasks(projectsList[i]))
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function removeArchivedForUsersInProjects(appAdmin) {
    const projects = await appAdmin.firestore().collection('projects').get()

    const projectsList = []
    projects.docs.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        promises.push(
            appAdmin.firestore().doc(`projects/${project.id}`).update({
                archivedForUsers: admin.firestore.FieldValue.delete(),
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function addAssistantIdToProjects(appAdmin) {
    const projects = await appAdmin.firestore().collection('projects').get()

    const projectsList = []
    projects.docs.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })

    let promises = []
    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        promises.push(
            appAdmin.firestore().doc(`projects/${project.id}`).update({
                assistantId: '',
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

//MY DAY

async function setFirstLoginDateInDayInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    const date = moment()

    let promises = []
    console.log(userList.length)
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { uid } = user
        console.log(user.displayName)

        promises.push(
            appAdmin
                .firestore()
                .doc(`users/${uid}`)
                .update({
                    firstLoginDateInDay: 0,
                    activeTaskStartingDate: 0,
                    activeTaskInitialEndingDate: 0,
                    activeTaskLastCheckedDate: 0,
                    activeTaskId: '',
                    activeTaskProjectId: '',
                    workTimeInterval: {
                        start: date.startOf('day').format('HH:mm'),
                        end: date.endOf('day').format('HH:mm'),
                    },
                })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function setEstimationsByObserverIdsInTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const objectDocs = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const objects = []
        objectDocs.forEach(doc => {
            const object = { ...doc.data(), id: doc.id }
            objects.push(object)
        })

        for (let n = 0; n < objects.length; n++) {
            const object = objects[n]
            const { observersIds } = object

            const isObserved = observersIds && observersIds.length > 0
            if (isObserved) {
                const estimationsByObserverIds = {}
                observersIds.forEach(uid => {
                    estimationsByObserverIds[uid] = 0
                })
                promises.push(
                    appAdmin
                        .firestore()
                        .doc(`items/${project.id}/tasks/${object.id}`)
                        .update({ estimationsByObserverIds })
                )
            } else {
                promises.push(
                    appAdmin
                        .firestore()
                        .doc(`items/${project.id}/tasks/${object.id}`)
                        .update({ estimationsByObserverIds: {} })
                )
            }

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setAutoEstimationInProjectsAndTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const objectDocs = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const objects = []
        objectDocs.forEach(doc => {
            const object = { ...doc.data(), id: doc.id }
            objects.push(object)
        })

        promises.push(appAdmin.firestore().doc(`projects/${project.id}`).update({ autoEstimation: true }))

        for (let n = 0; n < objects.length; n++) {
            const object = objects[n]

            promises.push(
                appAdmin.firestore().doc(`items/${project.id}/tasks/${object.id}`).update({ autoEstimation: null })
            )

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function deleteActiveTaskLastCheckedDateFromUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    console.log(userList.length)
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { uid } = user
        console.log(user.displayName)

        promises.push(
            appAdmin.firestore().doc(`users/${uid}`).update({
                activeTaskLastCheckedDate: admin.firestore.FieldValue.delete(),
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

/// LAST UDATE

async function setSortIndexInProjects() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    let sortKey = 0
    const generateSortIndex = () => {
        let newSortKey = moment().valueOf()
        if (sortKey >= newSortKey) {
            newSortKey = sortKey + 1
        }
        sortKey = newSortKey
        return newSortKey
    }

    const sortedProjects = orderBy(
        projectsList,
        [
            project => {
                return project.name ? project.name.toLowerCase() : ''
            },
        ],
        ['asc']
    ).reverse()

    for (let i = 0; i < sortedProjects.length; i++) {
        const project = sortedProjects[i]
        console.log(`Project: ${project.name} ${i + 1}/${sortedProjects.length}`)

        const { userIds } = project

        if (userIds) {
            const sortIndexByUser = {}

            const sortIndex = generateSortIndex()
            userIds.forEach(userId => {
                sortIndexByUser[userId] = sortIndex
            })

            promises.push(appAdmin.firestore().doc(`projects/${project.id}`).update({ sortIndexByUser }))
        }

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

async function setShowAllProjectsByTimeInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    console.log(userList.length)
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { uid } = user
        console.log(user.displayName)

        promises.push(
            appAdmin.firestore().doc(`users/${uid}`).update({
                showAllProjectsByTime: false,
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

//////////HERE LAST FOR RESET WRONG COMPLETEDTIME

async function setCompletedTimeTasks() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    console.log(projectsList.length)
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        const objectDocs = (await appAdmin.firestore().collection(`items/${project.id}/tasks`).get()).docs
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const objects = []
        objectDocs.forEach(doc => {
            const object = { ...doc.data(), id: doc.id }
            objects.push(object)
        })

        for (let n = 0; n < objects.length; n++) {
            const object = objects[n]
            const { completedTime, inDone, userIds } = object

            if (userIds) {
                const inOpen = userIds.length === 1 && !inDone
                const resetTime = inOpen && !!completedTime

                if (resetTime) {
                    promises.push(
                        appAdmin
                            .firestore()
                            .doc(`items/${project.id}/tasks/${object.id}`)
                            .update({ completedTime: null })
                    )
                }
            }

            if (promises.length > 200) {
                await Promise.all(promises)
                console.log('UPDATE')
                promises = []
            }
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

///////LAST SCRIPTS

async function setLastAssistantCommentDataInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    console.log(userList.length)
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { uid, lastAssistantCommentData } = user
        console.log(user.displayName)

        const updateData = {}
        if (lastAssistantCommentData) {
            const { projectId, objectType, objectId } = lastAssistantCommentData
            updateData[projectId] = { objectType, objectId }
            updateData.allProjects = { projectId, objectType, objectId }
        }

        promises.push(
            appAdmin.firestore().doc(`users/${uid}`).update({
                lastAssistantCommentData: updateData,
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}

async function updateDataInChatNotifications(appAdmin) {
    const convertDocumentsToData = docs => {
        const data = []
        docs.forEach(doc => {
            data.push({ ...doc.data(), id: doc.id })
        })
        return data
    }

    const getCollectionData = async ref => {
        const docs = (await ref.get()).docs
        return convertDocumentsToData(docs)
    }

    const getCollectionRef = path => {
        return appAdmin.firestore().collection(path)
    }

    const updateNotificationData = async (projectId, userId, notificationId, type, comment) => {
        const { lastChangeDate, fromAssistant, creatorId } = comment
        await appAdmin
            .firestore()
            .doc(`chatNotifications/${projectId}/${userId}/${notificationId}`)
            .update({
                chatType: type,
                date:
                    lastChangeDate && lastChangeDate.secondss
                        ? lastChangeDate.seconds * 1000
                        : moment().subtract(1, 'year').valueOf(),
                creatorId: creatorId || userId,
                creatorType: fromAssistant && creatorId ? 'assistant' : 'user',
            })
    }

    const updateNotificationDataInType = async (projectId, userId, notificationId, chatId, type) => {
        const comments = await getCollectionData(
            getCollectionRef(`chatComments/${projectId}/${type}/${chatId}/comments`)
        )

        const commentOfNotification = comments.find(comment => comment.id === notificationId)
        if (commentOfNotification) {
            await updateNotificationData(projectId, userId, notificationId, type, commentOfNotification)
        }
    }

    const updateNotificationDataInAllTypes = async (projectId, userId, notificationId, chatId) => {
        const objectTypes = ['tasks', 'topics', 'notes', 'contacts', 'goals', 'skills', 'assistants']
        const promises = []
        for (let m = 0; m < objectTypes.length; m++) {
            const type = objectTypes[m]
            promises.push(updateNotificationDataInType(projectId, userId, notificationId, chatId, type))
        }
        await Promise.all(promises)
    }

    const deleteIncompleteNotification = async (projectId, userId, notificationId) => {
        await appAdmin.firestore().doc(`chatNotifications/${projectId}/${userId}/${notificationId}`).delete()
    }

    const checkIncompleteNotifications = false
    const deleteIncompleteNotifications = false
    const incompleteNotificationsData = []

    const updateNotificationsData = async (projectId, userId) => {
        const notifications = await getCollectionData(getCollectionRef(`chatNotifications/${projectId}/${userId}`))

        if (checkIncompleteNotifications) {
            const promises = []
            for (let j = 0; j < notifications.length; j++) {
                const notification = notifications[j]
                const { chatType, date, creatorId, creatorType } = notification
                if (!chatType || !date || !creatorId || !creatorType) {
                    if (deleteIncompleteNotifications) {
                        promises.push(deleteIncompleteNotification(projectId, userId, notification.id))
                    }
                    incompleteNotificationsData.push({ projectId, userId, notificationId: notification.id })
                }
            }
            await Promise.all(promises)
        } else {
            const promises = []
            for (let j = 0; j < notifications.length; j++) {
                const notification = notifications[j]
                promises.push(updateNotificationDataInAllTypes(projectId, userId, notification.id, notification.chatId))
            }
            await Promise.all(promises)
        }
    }

    const updateUserNotificatiosData = async projectId => {
        const users = await getCollectionData(
            getCollectionRef(`users`).where('projectIds', 'array-contains-any', [projectId])
        )

        const promises = []
        for (let n = 0; n < users.length; n++) {
            const user = users[n]
            promises.push(updateNotificationsData(projectId, user.id))
        }
        await Promise.all(promises)
    }

    let promises = []

    const projects = await getCollectionData(getCollectionRef('projects'))

    for (let i = 0; i < projects.length; i++) {
        const project = projects[i]

        console.log(i + 1 + '/' + projects.length)
        promises.push(updateUserNotificatiosData(project.id))

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }

    await Promise.all(promises)
    if (checkIncompleteNotifications) {
        console.log(incompleteNotificationsData)
        console.log(incompleteNotificationsData.length)
    }
    console.log('DONE')
}

async function fixAssistantIdInCommunites() {
    const projects = (await appAdmin.firestore().collection('projects').get()).docs
    const projectsList = []
    projects.forEach(projectDoc => {
        const projectId = projectDoc.id
        const project = projectDoc.data()
        project.id = projectId
        projectsList.push(project)
    })
    let promises = []

    for (let i = 0; i < projectsList.length; i++) {
        const project = projectsList[i]
        console.log(`Project: ${project.name} ${i + 1}/${projectsList.length}`)

        const { assistantId } = project

        if (project.id === assistantId) {
            console.log(project.id)
            promises.push(appAdmin.firestore().doc(`projects/${project.id}`).update({ assistantId: '' }))
        }

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATE')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('DONE')
}

///HERER

async function setLastAssistantCommentDataInUsers(appAdmin) {
    const users = (await appAdmin.firestore().collection('users').get()).docs
    const userList = []
    users.forEach(userDoc => {
        const userId = userDoc.id
        const user = userDoc.data()
        user.uid = userId
        userList.push(user)
    })

    let promises = []
    console.log(userList.length)
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i]
        const { uid } = user
        console.log(user.displayName)

        promises.push(
            appAdmin.firestore().doc(`users/${uid}`).update({
                lastAssistantCommentData: {},
            })
        )

        if (promises.length > 200) {
            await Promise.all(promises)
            console.log('UPDATED')
            promises = []
        }
    }
    await Promise.all(promises)
    console.log('done')
}
