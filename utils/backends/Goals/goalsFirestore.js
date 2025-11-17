import { firebase } from '@firebase/app'
import { forEach, intersection, isEqual, sortBy, uniq } from 'lodash'
import moment from 'moment'

import {
    getDb,
    mapGoalData,
    mapMilestoneData,
    mapTaskData,
    createGoalUpdatesChain,
    deleteGoalFeedsChain,
    updateGoalUpdatesChain,
    updateGoalProgressFeedsChain,
    updateGoalNameFeedsChain,
    updateGoalHighlightFeedsChain,
    updateGoalAssigneesCapacitiesFeedsChain,
    updateGoalAssigneesFeedsChain,
    updateGoalDescriptionFeedsChain,
    updateGoalProjectFeedsChain,
    createGenericTaskWhenMentionInTitleEdition,
    getId,
    generateSortIndex,
    globalWatcherUnsub,
    logEvent,
    getObjectFollowersIds,
    updateGoalPrivacyFeedsChain,
    generateNegativeSortIndex,
    getMentionedUsersIdsWhenEditText,
} from '../firestore'
import TasksHelper, {
    BACKLOG_DATE_NUMERIC,
    GENERIC_GOAL_TYPE,
    OPEN_STEP,
} from '../../../components/TaskListView/Utils/TasksHelper'
import store from '../../../redux/store'
import {
    getNewDefaultGoalMilestone,
    getPositiveDaysDifference,
    ONE_DAY_MILLISECONDS,
    BACKLOG_MILESTONE_ID,
    CAPACITY_NONE,
    DYNAMIC_PERCENT,
    ALL_USERS,
} from '../../../components/GoalsView/GoalsHelper'
import { DEFAULT_WORKSTREAM_ID } from '../../../components/Workstreams/WorkstreamHelper'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { getAllOwnerIds } from '../../../components/UIComponents/FloatModals/PrivacyModal/PrivacyModal'
import { updateXpByChangeGoalProgress } from '../../Levels'
import {
    setDoneMilestonesInProject,
    setGoalsInProject,
    setOpenMilestonesInProject,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    stopLoadingData,
    switchProject,
} from '../../../redux/actions'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import { tryToGenerateTopicAdvaice } from '../../assistantHelper'
import { createGoalAssistantChangedFeed } from './goalUpdates'
import { createGenericTaskWhenMention } from '../Tasks/tasksFirestore'
import { updateNotePrivacy, updateNoteTitleWithoutFeed } from '../Notes/notesFirestore'
import {
    updateChatAssistantWithoutFeeds,
    updateChatPrivacy,
    updateChatTitleWithoutFeeds,
} from '../Chats/chatsFirestore'
import NavigationService from '../../NavigationService'
import { DV_TAB_GOAL_PROPERTIES, DV_TAB_ROOT_GOALS } from '../../TabNavigationConstants'

//ACCESS FUNCTIONS

export async function getGoalData(projectId, goalId) {
    const goal = (await getDb().doc(`/goals/${projectId}/items/${goalId}`).get()).data()
    return goal ? mapGoalData(goalId, goal) : null
}

export function watchGoal(projectId, goalId, watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = getDb()
        .doc(`goals/${projectId}/items/${goalId}`)
        .onSnapshot(goalDoc => {
            const goalData = goalDoc.data()
            const goal = goalData ? mapGoalData(goalId, goalData) : null
            callback(goal)
        })
}

export function watchGoalsInDateRange(projectId, date1, date2, watcherKey, callback, ownerId) {
    const { uid: loggedUserId, isAnonymous } = store.getState().loggedUser
    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`goals/${projectId}/items`)
        .where('completionMilestoneDate', '>=', date1)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .where('ownerId', '==', ownerId)
        .onSnapshot(goalsDocs => {
            const goals = []
            goalsDocs.forEach(doc => {
                const goal = mapGoalData(doc.id, doc.data())
                if (goal.startingMilestoneDate <= date2) goals.push(goal)
            })
            callback(goals)
        })
}

export function watchAllGoals(projectId, watcherKey, ownerId) {
    const { uid: loggedUserId, isAnonymous } = store.getState().loggedUser
    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]
    const query = getDb()
        .collection(`goals/${projectId}/items`)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .where('ownerId', '==', ownerId)

    globalWatcherUnsub[watcherKey] = query.onSnapshot(
        goalsData => {
            try {
                const goals = []
                goalsData.forEach(doc => {
                    const goal = mapGoalData(doc.id, doc.data())
                    goals.push(goal)
                })
                store.dispatch([setGoalsInProject(projectId, goals), stopLoadingData()])
            } catch (err) {
                console.error('watchAllGoals: snapshot handler error', { projectId, ownerId, watcherKey, err })
                // Ensure spinner decrements on unexpected handler errors
                store.dispatch(stopLoadingData())
            }
        },
        err => {
            console.error('watchAllGoals: onSnapshot error', { projectId, ownerId, watcherKey, err })
            // Ensure spinner decrements on snapshot errors
            store.dispatch(stopLoadingData())
        }
    )
}

async function getGoalsInDoneMilestone(projectId, milestoneId, idsOfGoalsToExclude) {
    const goalsDocs = (
        await getDb()
            .collection(`goals/${projectId}/items`)
            .where('parentDoneMilestoneIds', 'array-contains-any', [milestoneId])
            .get()
    ).docs
    const goals = []
    goalsDocs.forEach(doc => {
        const goal = mapGoalData(doc.id, doc.data())
        if (!idsOfGoalsToExclude.includes(goal.id)) {
            goals.push(goal)
        }
    })
    return goals
}

async function getGoalsInOpenMilestone(
    projectId,
    milestoneDate,
    idsOfGoalsToExclude,
    getOnlyIncompleteGoalsInBacklog,
    ownerId
) {
    const goalsDocs = (
        await getDb()
            .collection(`goals/${projectId}/items`)
            .where('completionMilestoneDate', '>=', milestoneDate)
            .where('ownerId', '==', ownerId)
            .get()
    ).docs
    const goals = []
    goalsDocs.forEach(doc => {
        const goal = mapGoalData(doc.id, doc.data())
        if (
            goal.startingMilestoneDate <= milestoneDate &&
            !idsOfGoalsToExclude.includes(goal.id) &&
            (milestoneDate !== BACKLOG_DATE_NUMERIC || !getOnlyIncompleteGoalsInBacklog || goal.progress !== 100)
        ) {
            goals.push(goal)
        }
    })
    return goals
}

async function getBaseGoalsInOpenMilestone(projectId, milestoneDate, idsOfGoalsToExclude, ownerId) {
    const goalsDocs = (
        await getDb()
            .collection(`goals/${projectId}/items`)
            .where('completionMilestoneDate', '==', milestoneDate)
            .where('ownerId', '==', ownerId)
            .get()
    ).docs
    const goals = []
    goalsDocs.forEach(doc => {
        const goal = mapGoalData(doc.id, doc.data())
        if (!idsOfGoalsToExclude.includes(goal.id)) {
            goals.push(goal)
        }
    })
    return goals
}

async function getGoalsWithoutParentsOpenMilestonesWhenMoveToOpen(projectId, goals) {
    const goalsOutOfBacklog = goals.filter(
        goal =>
            goal.startingMilestoneDate !== BACKLOG_DATE_NUMERIC && goal.completionMilestoneDate !== BACKLOG_DATE_NUMERIC
    )
    const promises = []
    goalsOutOfBacklog.forEach(goal => {
        promises.push(getOpenMilestonesFromGoal(projectId, goal))
    })
    const milestonesResult = await Promise.all(promises)
    const goalsWithoutParentsOpenMilestones = []
    for (let i = 0; i < milestonesResult.length; i++) {
        const milestones = milestonesResult[i]
        if (milestones.length === 0) goalsWithoutParentsOpenMilestones.push(goalsOutOfBacklog[i])
    }
    return goalsWithoutParentsOpenMilestones
}

export async function watchBaseGoalsAmountInOpenMilestone(projectId, milestoneDate, callback, watcherKey, ownerId) {
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`goals/${projectId}/items`)
        .where('completionMilestoneDate', '==', milestoneDate)
        .where('ownerId', '==', ownerId)
        .onSnapshot(goalsDocs => {
            callback(goalsDocs.docs.length)
        })
}

export const getPreviousMilestone = async (projectId, ownerId, date) => {
    const milestonesDocs = (
        await getDb()
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('date', '<', date)
            .where('done', '==', false)
            .where('ownerId', '==', ownerId)
            .orderBy('date', 'desc')
            .limit(1)
            .get()
    ).docs

    const milestone =
        milestonesDocs.length > 0 ? mapMilestoneData(milestonesDocs[0].id, milestonesDocs[0].data()) : null

    return milestone
}

async function getOpenMilestonesFromGoal(projectId, goal) {
    const { startingMilestoneDate, completionMilestoneDate, ownerId } = goal
    const milestones = await getOpenMilestonesInDateRange(
        projectId,
        startingMilestoneDate,
        completionMilestoneDate,
        ownerId
    )
    return milestones
}

export function watchAllMilestones(projectId, watcherKey, ownerId) {
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`goalsMilestones/${projectId}/milestonesItems`)
        .where('ownerId', '==', ownerId)
        .orderBy('date', 'asc')
        .onSnapshot(
            milestonesData => {
                try {
                    const milestones = []
                    const openMilestones = []
                    let doneMilestone = []
                    milestonesData.forEach(doc => {
                        const milestone = mapMilestoneData(doc.id, doc.data())
                        milestones.push(milestone)
                        milestone.done ? doneMilestone.push(milestone) : openMilestones.push(milestone)
                    })

                    doneMilestone = sortBy(doneMilestone, [item => item.doneDate])
                    doneMilestone.reverse()

                    store.dispatch([
                        setOpenMilestonesInProject(projectId, openMilestones),
                        setDoneMilestonesInProject(projectId, doneMilestone),
                        stopLoadingData(),
                    ])
                } catch (err) {
                    console.error('watchAllMilestones: snapshot handler error', { projectId, ownerId, watcherKey, err })
                    store.dispatch(stopLoadingData())
                }
            },
            err => {
                console.error('watchAllMilestones: onSnapshot error', { projectId, ownerId, watcherKey, err })
                store.dispatch(stopLoadingData())
            }
        )
}

export function watchMilestones(projectId, callback, milestonesInDone, watcherKey, ownerId) {
    let query = getDb()
        .collection(`goalsMilestones/${projectId}/milestonesItems`)
        .where('done', '==', milestonesInDone)
        .where('ownerId', '==', ownerId)
    query = milestonesInDone ? query.orderBy('doneDate', 'desc') : query.orderBy('date', 'asc')

    globalWatcherUnsub[watcherKey] = query.onSnapshot(milestonesData => {
        const milestones = []
        milestonesData.forEach(doc => {
            const milestone = mapMilestoneData(doc.id, doc.data())
            milestones.push(milestone)
        })
        callback(projectId, milestones)
    })
}

export function watchMilestoneTasksStatistics(
    projectId,
    milestoneInitalDate,
    milestoneEndDate,
    inDone,
    watcherKey,
    callback
) {
    const loggedUserId = store.getState().loggedUser.uid

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('dueDate', '>', milestoneInitalDate)
        .where('dueDate', '<=', milestoneEndDate)
        .where('done', '==', inDone)
        .where('parentId', '==', null)
        .onSnapshot(tasksData => {
            let amountOfTasks = 0
            let amountOfPoints = 0
            tasksData.forEach(doc => {
                const task = mapTaskData(doc.id, doc.data())
                const { isPublicFor, estimations } = task
                const loggedUserHaveAccess =
                    !isPublicFor ||
                    isPublicFor.length === 0 ||
                    isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ||
                    isPublicFor.includes(loggedUserId)
                if (loggedUserHaveAccess) {
                    amountOfTasks++
                    if (estimations && estimations[OPEN_STEP]) {
                        amountOfPoints += estimations[OPEN_STEP]
                    }
                }
            })
            callback(amountOfTasks, amountOfPoints)
        })
}

async function getNextMilestoneAfterDate(projectId, milestoneDate, ownerId) {
    const milestoneDoc = (
        await getDb()
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('done', '==', false)
            .where('date', '>', milestoneDate)
            .where('ownerId', '==', ownerId)
            .orderBy('date', 'asc')
            .limit(1)
            .get()
    ).docs[0]
    return milestoneDoc ? mapMilestoneData(milestoneDoc.id, milestoneDoc.data()) : null
}

export async function getMilestoneData(projectId, milestoneId) {
    const milestone = (await getDb().doc(`/goalsMilestones/${projectId}/milestonesItems/${milestoneId}`).get()).data()
    return milestone ? mapMilestoneData(milestoneId, milestone) : null
}

async function getOpenMilestonesInDateRange(projectId, date1, date2, ownerId) {
    const milestonesDocs = (
        await getDb()
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('date', '>=', date1)
            .where('date', '<=', date2)
            .where('done', '==', false)
            .where('ownerId', '==', ownerId)
            .orderBy('date', 'asc')
            .get()
    ).docs

    const milestones = []
    milestonesDocs.forEach(doc => {
        milestones.push(mapMilestoneData(doc.id, doc.data()))
    })
    return milestones
}

export async function getNextMilestones(projectId, ownerId, amountOfNextMilestones) {
    const milestoneDocs = await getDb()
        .collection(`goalsMilestones/${projectId}/milestonesItems`)
        .where('done', '==', false)
        .where('ownerId', '==', ownerId)
        .orderBy('date', 'asc')
        .limit(amountOfNextMilestones)
        .get()

    const milestones = []
    milestoneDocs.forEach(doc => {
        milestones.push(mapMilestoneData(doc.id, doc.data()))
    })
    return milestones
}

export async function getActiveMilestone(projectId, ownerId) {
    const milestones = await getNextMilestones(projectId, ownerId, 1)
    return milestones[0]
}

export function watchActiveMilestone(projectId, watcherKey, callback, ownerId) {
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`goalsMilestones/${projectId}/milestonesItems`)
        .where('done', '==', false)
        .where('ownerId', '==', ownerId)
        .orderBy('date', 'asc')
        .limit(1)
        .onSnapshot(milestoneDocs => {
            const milestoneDoc = milestoneDocs.docs[0]
            const milestone = milestoneDoc ? mapMilestoneData(milestoneDoc.id, milestoneDoc.data()) : null
            callback(milestone)
        })
}

export async function getMilestoneUsingDate(projectId, date, searchInDoneMilestones, ownerId) {
    const milestoneDoc = (
        await getDb()
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('date', '==', date)
            .where('done', '==', searchInDoneMilestones)
            .where('ownerId', '==', ownerId)
            .limit(1)
            .get()
    ).docs[0]
    return milestoneDoc ? mapMilestoneData(milestoneDoc.id, milestoneDoc.data()) : null
}

export function watchOpenMilestonesInDateRange(projectId, date1, date2, watcherKey, callback, ownerId) {
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`goalsMilestones/${projectId}/milestonesItems`)
        .where('date', '>=', date1)
        .where('date', '<=', date2)
        .where('done', '==', false)
        .where('ownerId', '==', ownerId)
        .orderBy('date', 'asc')
        .onSnapshot(milestoneDocs => {
            const milestones = []
            milestoneDocs.forEach(doc => {
                const milestone = mapMilestoneData(doc.id, doc.data())
                milestones.push(milestone)
            })
            callback(milestones)
        })
}

//EDTION AND ADITION FUNCTIONS

export const updateGoalEditionData = async (projectId, goalId, editorId) => {
    await getDb().runTransaction(async transaction => {
        const ref = getDb().doc(`goals/${projectId}/items/${goalId}`)
        const doc = await transaction.get(ref)
        if (doc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
    })
}

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

async function updateGoalData(projectId, goalId, data, batch) {
    updateEditionData(data)
    const ref = getDb().doc(`goals/${projectId}/items/${goalId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

export async function uploadNewGoal(projectId, goal, baseDate, tryToGenerateBotAdvaice, movingGoalToOtherProject) {
    const { loggedUser } = store.getState()

    updateEditionData(goal)

    goal.extendedName = goal.extendedName.trim()
    const cleanedTitle = TasksHelper.getTaskNameWithoutMeta(goal.extendedName)

    goal.name = cleanedTitle.toLowerCase()
    goal.created = Date.now()

    const project = ProjectHelper.getProjectById(projectId)
    const ownerId = project.parentTemplateId ? goal.assigneesIds[0] : ALL_USERS
    goal.ownerId = ownerId

    if (!goal.id) goal.id = getId()

    const fullText = goal.extendedName + ' ' + goal.description
    const mentionedUserIds = intersection(project.userIds, getMentionedUsersIdsWhenEditText(fullText, ''))

    createGenericTaskWhenMention(projectId, goal.id, mentionedUserIds, GENERIC_GOAL_TYPE, 'goals', goal.assistantId)

    if (baseDate && goal.startingMilestoneDate !== goal.completionMilestoneDate) {
        baseDate === goal.completionMilestoneDate
            ? (goal.completionMilestoneDate = goal.startingMilestoneDate)
            : (goal.startingMilestoneDate = goal.completionMilestoneDate)
    }

    uploadOpenNewMilestoneIfNotExistMilestoneInSameDate(projectId, goal.completionMilestoneDate, ownerId)

    goal.assigneesReminderDate = await generateAssigneesReminderDate(
        movingGoalToOtherProject ? goal.assigneesReminderDate : {},
        goal.assigneesIds,
        projectId,
        goal.ownerId,
        goal.completionMilestoneDate
    )

    const goalToStore = { ...goal }
    delete goalToStore.id
    getDb().doc(`goals/${projectId}/items/${goal.id}`).set(goalToStore, { merge: true })

    if (tryToGenerateBotAdvaice) {
        const followerIds = uniq([...mentionedUserIds, ...goalToStore.assigneesIds, goalToStore.creatorId])
        tryToGenerateTopicAdvaice(
            projectId,
            goal.id,
            'goals',
            goal.isPublicFor,
            goal.extendedName,
            followerIds,
            goal.assistantId,
            goal.creatorId
        )
    }

    const useNegativeSortIndex = loggedUser.templateProjectIds.includes(projectId)
    updateAllOpenGoalSortIndexs(projectId, goal, useNegativeSortIndex)

    createGoalUpdatesChain(projectId, goal)

    logEvent('new_goal', {
        id: goal.id,
        name: goal.name,
    })

    return goal
}

export async function deleteAllGoalsInMilestone(projectId, goals) {
    goals.forEach(goal => {
        deleteGoal(projectId, goal, '')
    })
}

export async function deleteGoal(projectId, goal, movingToOtherProjectId) {
    if (movingToOtherProjectId)
        await getDb().doc(`goals/${projectId}/items/${goal.id}`).update({ movingToOtherProjectId })
    await getDb().doc(`goals/${projectId}/items/${goal.id}`).delete()
    deleteGoalFeedsChain(projectId, goal)
}

export async function updateGoal(projectId, oldGoal, updatedGoal, avoidFollow) {
    const { loggedUser } = store.getState()

    if (oldGoal.extendedName !== updatedGoal.extendedName) {
        updatedGoal.extendedName = updatedGoal.extendedName.trim()
        const cleanedTitle = TasksHelper.getTaskNameWithoutMeta(updatedGoal.extendedName)
        updatedGoal.name = cleanedTitle.toLowerCase()

        createGenericTaskWhenMentionInTitleEdition(
            projectId,
            updatedGoal.id,
            updatedGoal.extendedName,
            oldGoal.extendedName,
            GENERIC_GOAL_TYPE,
            'goals',
            updatedGoal.assistantId
        )
    }

    if (oldGoal.description !== updatedGoal.description) {
        createGenericTaskWhenMentionInTitleEdition(
            projectId,
            updatedGoal.id,
            updatedGoal.description,
            oldGoal.description,
            GENERIC_GOAL_TYPE,
            'goals',
            updatedGoal.assistantId
        )
    }

    if (oldGoal.progress !== updatedGoal.progress) {
        updateXpByChangeGoalProgress(loggedUser.uid, firebase, getDb(), projectId)
    }

    let newIsPublicFor = updatedGoal.isPublicFor
    if (!isEqual(oldGoal.assigneesIds, updatedGoal.assigneesIds)) {
        newIsPublicFor = getNewIsPublicForWhenAssigneesChanges(
            projectId,
            updatedGoal.isPublicFor,
            updatedGoal.assigneesIds
        )
    }

    const promisesToProcess = []

    if (oldGoal.startingMilestoneDate !== updatedGoal.startingMilestoneDate) {
        const newDate = updatedGoal.startingMilestoneDate

        const { toBacklog, fromBacklog, moveFullGoalWhenUpdateStartingDate } = getGoalDirectionWhenChangesDate(
            newDate,
            oldGoal,
            'startingMilestoneDate'
        )

        if (toBacklog || fromBacklog || moveFullGoalWhenUpdateStartingDate) {
            updatedGoal.completionMilestoneDate = newDate
        }

        promisesToProcess.push(
            updateGoalDateRange(
                projectId,
                {
                    ...updatedGoal,
                    startingMilestoneDate: oldGoal.startingMilestoneDate,
                    completionMilestoneDate: oldGoal.completionMilestoneDate,
                },
                newDate,
                'startingMilestoneDate',
                false
            )
        )
    } else if (oldGoal.completionMilestoneDate !== updatedGoal.completionMilestoneDate) {
        const newDate = updatedGoal.completionMilestoneDate

        const { toBacklog, fromBacklog, moveFullGoalWhenUpdateCompletionDate } = getGoalDirectionWhenChangesDate(
            newDate,
            oldGoal,
            'completionMilestoneDate'
        )

        if (toBacklog || fromBacklog || moveFullGoalWhenUpdateCompletionDate) {
            updatedGoal.startingMilestoneDate = newDate
        }

        promisesToProcess.push(
            updateGoalDateRange(
                projectId,
                {
                    ...updatedGoal,
                    startingMilestoneDate: oldGoal.startingMilestoneDate,
                    completionMilestoneDate: oldGoal.completionMilestoneDate,
                },
                newDate,
                'completionMilestoneDate',
                false
            )
        )
    }

    if (oldGoal.completionMilestoneDate === updatedGoal.completionMilestoneDate) {
        updatedGoal.assigneesReminderDate = await generateAssigneesReminderDate(
            updatedGoal.assigneesReminderDate,
            updatedGoal.assigneesIds,
            projectId,
            updatedGoal.ownerId,
            updatedGoal.completionMilestoneDate
        )
    } else {
        updatedGoal.assigneesReminderDate = updateAssigneesReminderDate(
            updatedGoal.assigneesIds,
            updatedGoal.completionMilestoneDate
        )
    }

    if (!isEqual(oldGoal.isPublicFor, newIsPublicFor)) {
        updatePrivacyInChildrenTasks(projectId, updatedGoal.id, newIsPublicFor)
        updateChatPrivacy(projectId, updatedGoal.id, 'goals', newIsPublicFor)
        if (updatedGoal.noteId) {
            const followersIds = await getObjectFollowersIds(projectId, 'goals', updatedGoal.id)
            updateNotePrivacy(
                projectId,
                updatedGoal.noteId,
                !newIsPublicFor.includes(FEED_PUBLIC_FOR_ALL),
                newIsPublicFor,
                followersIds,
                false,
                null
            )
        }
    }

    const goalToStore = { ...updatedGoal, isPublicFor: newIsPublicFor }
    delete goalToStore.id

    promisesToProcess.push(updateGoalData(projectId, updatedGoal.id, goalToStore, null))

    Promise.all(promisesToProcess)

    updateGoalUpdatesChain(projectId, oldGoal, updatedGoal, avoidFollow)
}

export async function updateGoalDateRange(projectId, goal, newDate, rangeEdgePropertyName, needToUpdateGoal) {
    if (newDate === goal[rangeEdgePropertyName]) return

    const {
        toBacklog,
        fromBacklog,
        moveFullGoalWhenUpdateCompletionDate,
        moveFullGoalWhenUpdateStartingDate,
    } = getGoalDirectionWhenChangesDate(newDate, goal, rangeEdgePropertyName)

    if (toBacklog || fromBacklog || moveFullGoalWhenUpdateCompletionDate || moveFullGoalWhenUpdateStartingDate) {
        updateGoalDates(
            projectId,
            goal,
            newDate,
            {
                startingMilestoneDate: newDate,
                completionMilestoneDate: newDate,
            },
            needToUpdateGoal,
            true
        )
    } else if (rangeEdgePropertyName === 'startingMilestoneDate') {
        updateGoalDates(
            projectId,
            goal,
            newDate,
            {
                startingMilestoneDate: newDate,
            },
            needToUpdateGoal,
            false
        )
    } else {
        updateGoalDates(projectId, goal, newDate, { completionMilestoneDate: newDate }, needToUpdateGoal, true)
    }
}

async function updateGoalDates(projectId, goal, newDate, datesData, needToUpdateGoal, needToHandleMilestoneExistence) {
    const promises = []
    if (needToUpdateGoal) {
        promises.push(
            updateGoalData(
                projectId,
                goal.id,
                {
                    ...datesData,
                    assigneesReminderDate:
                        datesData.completionMilestoneDate &&
                        datesData.completionMilestoneDate !== goal.completionMilestoneDate
                            ? updateAssigneesReminderDate(goal.assigneesIds, datesData.completionMilestoneDate)
                            : goal.assigneesReminderDate,
                },
                null
            )
        )
    }
    if (needToHandleMilestoneExistence)
        promises.push(handleMilestonesExistenceWhenAGoalDateRangeChanges(projectId, goal, newDate))
    promises.push(updateAllOpenGoalSortIndexs(projectId, { ...goal, ...datesData }, false))
    await Promise.all(promises)
}

export async function updateGoalNote(projectId, goalId, noteId) {
    await updateGoalData(projectId, goalId, { noteId }, null)
}

export function updateGoalHighlight(projectId, hasStar, goal) {
    updateGoalData(projectId, goal.id, { hasStar }, null)
    updateGoalHighlightFeedsChain(projectId, hasStar, goal)
}

export async function updateGoalPrivacy(projectId, isPublicFor, goal) {
    const goalId = goal.id
    updatePrivacyInChildrenTasks(projectId, goal.id, isPublicFor)
    await updateGoalData(projectId, goal.id, { isPublicFor }, null)
    updateChatPrivacy(projectId, goalId, 'goals', isPublicFor)
    if (goal.noteId) {
        const followersIds = await getObjectFollowersIds(projectId, 'goals', goalId)
        updateNotePrivacy(
            projectId,
            goal.noteId,
            !isPublicFor.includes(FEED_PUBLIC_FOR_ALL),
            isPublicFor,
            followersIds,
            false,
            null
        )
    }
    await updateGoalPrivacyFeedsChain(projectId, isPublicFor, goalId, goal, null)
}

export function updateGoalName(projectId, goalId, oldName, newName, goal) {
    const cleanedTitle = TasksHelper.getTaskNameWithoutMeta(newName)

    updateGoalData(projectId, goalId, { name: cleanedTitle.toLowerCase(), extendedName: newName }, null)

    updateChatTitleWithoutFeeds(projectId, goal.id, newName)

    if (goal.noteId) updateNoteTitleWithoutFeed(projectId, goal.noteId, newName)

    createGenericTaskWhenMentionInTitleEdition(
        projectId,
        goalId,
        newName,
        oldName,
        GENERIC_GOAL_TYPE,
        'goals',
        goal.assistantId
    )

    updateGoalNameFeedsChain(projectId, goalId, oldName, newName, goal)
}

export const setGoalAssistant = async (projectId, goalId, assistantId, needGenerateUpdate) => {
    const batch = new BatchWrapper(getDb())
    updateGoalData(projectId, goalId, { assistantId }, batch)
    await updateChatAssistantWithoutFeeds(projectId, goalId, assistantId, batch)
    batch.commit()
    if (needGenerateUpdate) createGoalAssistantChangedFeed(projectId, assistantId, goalId, null, null)
}

export async function updateGoalAssigneesIds(
    projectId,
    goalId,
    oldAssigneesIds,
    newAssigneesIds,
    goal,
    oldAssigneesCapacity,
    newAssigneesCapacity
) {
    const assigneesReminderDate = await generateAssigneesReminderDate(
        goal.assigneesReminderDate,
        newAssigneesIds,
        projectId,
        goal.ownerId,
        goal.completionMilestoneDate
    )

    const newIsPublicFor = getNewIsPublicForWhenAssigneesChanges(projectId, goal.isPublicFor, newAssigneesIds)
    updateGoalPrivacy(projectId, newIsPublicFor, goal)

    updateGoalData(
        projectId,
        goalId,
        {
            assigneesIds: newAssigneesIds,
            assigneesCapacity: newAssigneesCapacity,
            assigneesReminderDate,
        },
        null
    )

    updateGoalAssigneesFeedsChain(
        projectId,
        oldAssigneesIds,
        newAssigneesIds,
        goal,
        oldAssigneesCapacity,
        newAssigneesCapacity
    )
}

export async function updateGoalAssigneeCapacity(projectId, goal, oldCapacity, newCapacity, assigneeId) {
    updateGoalData(projectId, goal.id, { [`assigneesCapacity.${assigneeId}`]: newCapacity }, null)
    updateGoalAssigneesCapacitiesFeedsChain(projectId, goal, oldCapacity, newCapacity, assigneeId)
}

export function updateGoalAssigneeReminderDate(projectId, goalId, userId, date) {
    updateGoalData(projectId, goalId, { [`assigneesReminderDate.${userId}`]: date }, null)
}

export const updateGoalLastCommentData = async (projectId, goalId, lastComment, lastCommentType) => {
    getDb()
        .doc(`goals/${projectId}/items/${goalId}`)
        .update({
            [`commentsData.lastComment`]: lastComment,
            [`commentsData.lastCommentType`]: lastCommentType,
            [`commentsData.amount`]: firebase.firestore.FieldValue.increment(1),
        })
}

export async function updateGoalProgress(projectId, progress, goal) {
    const { loggedUser } = store.getState()
    updateGoalData(projectId, goal.id, { progress }, null)
    updateGoalProgressFeedsChain(projectId, progress, goal)
    updateXpByChangeGoalProgress(loggedUser.uid, firebase, getDb(), projectId)
}

export async function setGoalDescription(projectId, goalId, description, goal, oldDescription) {
    updateGoalData(projectId, goal.id, { description }, null)

    createGenericTaskWhenMentionInTitleEdition(
        projectId,
        goalId,
        description,
        oldDescription,
        GENERIC_GOAL_TYPE,
        'goals',
        goal.assistantId
    )

    updateGoalDescriptionFeedsChain(projectId, goalId, description, goal, oldDescription)
}

export async function updateGoalProject(oldProject, newProject, goal) {
    const oldProjectId = oldProject.id
    const newProjectId = newProject.id

    const { projectUsers, loggedUser, route } = store.getState()
    const newProjectUsers = projectUsers[newProjectId]

    const assignees = newProjectUsers.filter(user => goal.assigneesIds.includes(user.uid))

    const assigneesIds = assignees.map(assignee => assignee.uid)
    if (assigneesIds.length === 0 || goal.assigneesIds.includes(DEFAULT_WORKSTREAM_ID))
        assigneesIds.push(DEFAULT_WORKSTREAM_ID)

    const assigneesCapacity = {}
    assigneesIds.forEach(id => {
        assigneesCapacity[id] = goal.assigneesCapacity[id] ? goal.assigneesCapacity[id] : CAPACITY_NONE
    })

    const assigneesReminderDate = await generateAssigneesReminderDate(
        goal.assigneesReminderDate,
        assigneesIds,
        newProject.id,
        goal.ownerId,
        goal.completionMilestoneDate
    )

    let isPublicFor
    if (goal.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
        isPublicFor = [FEED_PUBLIC_FOR_ALL]
    } else if (goal.isPublicFor.includes(DEFAULT_WORKSTREAM_ID)) {
        isPublicFor = [DEFAULT_WORKSTREAM_ID, ...newProjectUsers.map(user => user.uid)]
    } else {
        const usersWithAccess = newProjectUsers.filter(user => goal.isPublicFor.includes(user.uid))
        isPublicFor = usersWithAccess.map(user => user.uid)
    }

    await uploadNewGoal(
        newProjectId,
        {
            ...goal,
            assigneesIds,
            assigneesCapacity,
            assigneesReminderDate,
            parentDoneMilestoneIds: [],
            progressByDoneMilestone: {},
            isPublicFor,
            dateByDoneMilestone: {},
            sortIndexByMilestone: {},
            creatorId: newProjectUsers.map(user => user.uid).includes(goal.creatorId) ? goal.creatorId : loggedUser.uid,
        },
        null,
        false,
        true
    )
    deleteGoal(oldProjectId, goal, newProjectId)

    if (route === 'GoalDetailedView') {
        NavigationService.navigate('GoalDetailedView', {
            goalId: goal.id,
            projectId: newProject.id,
        })

        const projectType = ProjectHelper.getTypeOfProject(loggedUser, newProject.id)
        store.dispatch([
            setSelectedSidebarTab(DV_TAB_ROOT_GOALS),
            switchProject(newProject.index),
            setSelectedTypeOfProject(projectType),
            setSelectedNavItem(DV_TAB_GOAL_PROPERTIES),
        ])
    }

    updateGoalProjectFeedsChain(oldProject, newProject, goal, assigneesIds)
}

export async function moveCompletedGoalInBacklogToDone(projectId, goal) {
    if (goal.progress !== 100) updateGoalProgress(projectId, 100, goal)
    const todayDate = moment().startOf('day').hour(12).minute(0).valueOf()
    let milestone = await getMilestoneUsingDate(projectId, todayDate, true, goal.ownerId)

    if (!milestone) {
        milestone = getNewDefaultGoalMilestone()
        milestone.date = todayDate
        milestone.done = true
        milestone.ownerId = goal.ownerId

        const milestoneId = getId()
        getDb().collection(`goalsMilestones/${projectId}/milestonesItems`).doc(milestoneId).set(milestone)
        milestone.id = milestoneId
    }

    addGoalsToDoneMilestone(
        projectId,
        milestone.id,
        milestone.date,
        milestone.doneDate,
        [{ ...goal, progress: 100 }],
        null
    )
    updateGoalSortIndexes(projectId, goal.id, milestone.id)
}

async function handleMilestonesExistenceWhenAGoalDateRangeChanges(projectId, goal, newDate) {
    const promises = []
    if (newDate !== BACKLOG_DATE_NUMERIC)
        promises.push(uploadOpenNewMilestoneIfNotExistMilestoneInSameDate(projectId, newDate, goal.ownerId))
    promises.push(deleteOpenMilestoneIfIsEmpty(projectId, goal.completionMilestoneDate, [goal.id], goal.ownerId))
    await Promise.all(promises)
}

async function updateGoalsWhenChangeMilestoneDate(projectId, oldDate, newDate, ownerId) {
    const goalsDocs = await getDb()
        .collection(`goals/${projectId}/items`)
        .where('completionMilestoneDate', '==', oldDate)
        .where('ownerId', '==', ownerId)
        .get()

    const batch = new BatchWrapper(getDb())

    goalsDocs.docs.forEach(doc => {
        const goal = mapGoalData(doc.id, doc.data())

        const toBacklog = newDate === BACKLOG_DATE_NUMERIC
        const moveFullGoalWhenUpdateCompletionDate =
            goal.startingMilestoneDate === goal.completionMilestoneDate || newDate < goal.startingMilestoneDate

        const moveFullGoal = toBacklog || moveFullGoalWhenUpdateCompletionDate

        const updateData = moveFullGoal
            ? {
                  startingMilestoneDate: newDate,
                  completionMilestoneDate: newDate,
                  assigneesReminderDate: updateAssigneesReminderDate(goal.assigneesIds, newDate),
              }
            : {
                  completionMilestoneDate: newDate,
                  assigneesReminderDate: updateAssigneesReminderDate(goal.assigneesIds, newDate),
              }
        updateGoalData(projectId, doc.id, updateData, batch)
    })
    await batch.commit()
}

function addGoalsToDoneMilestone(projectId, milestoneId, milestoneDate, doneDate, goals, externalBatch) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    goals.forEach(goal => {
        updateGoalData(
            projectId,
            goal.id,
            {
                parentDoneMilestoneIds: firebase.firestore.FieldValue.arrayUnion(milestoneId),
                [`progressByDoneMilestone.${milestoneId}`]: {
                    progress: goal.progress === DYNAMIC_PERCENT ? goal.dynamicProgress : goal.progress,
                    doneDate,
                },
                [`dateByDoneMilestone.${milestoneId}`]: milestoneDate,
            },
            batch
        )
    })
    if (!externalBatch) batch.commit()
}

function removeGoalsFromDoneMilestone(projectId, milestoneId, goals, externalBatch) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    goals.forEach(goal => {
        updateGoalData(
            projectId,
            goal.id,
            {
                parentDoneMilestoneIds: firebase.firestore.FieldValue.arrayRemove(milestoneId),
                [`progressByDoneMilestone.${milestoneId}`]: firebase.firestore.FieldValue.delete(),
                [`dateByDoneMilestone.${milestoneId}`]: firebase.firestore.FieldValue.delete(),
            },
            batch
        )
    })
    if (!externalBatch) batch.commit()
}

export async function updateFutureOpenMilestonesDateToBacklog(projectId, milestone) {
    const inDoneMilestone = milestone.done
    const milestoneDocs = (
        await getDb()
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('date', '>', milestone.date)
            .where('done', '==', inDoneMilestone)
            .where('ownerId', '==', milestone.ownerId)
            .orderBy('date', 'desc')
            .get()
    ).docs

    const milestones = []
    milestoneDocs.forEach(doc => {
        const futureMilestone = mapMilestoneData(doc.id, doc.data())
        milestones.push(futureMilestone)
    })

    milestones.push(milestone)

    //NOT USE PROMISES HERE, BECAUSE WE NEED TO PROCESS THIS ONE BY ONE, BECAUSE THE RESULT OF THE FIRST AFFECT THE NEXTS
    for (let i = 0; i < milestones.length; i++) {
        await updateMilestoneDateToBacklog(projectId, milestones[i])
    }
}

export async function updateFutureOpenMilestonesDate(projectId, milestone, newDate) {
    const inDoneMilestone = milestone.done
    const moveMilestoneToTheFuture = milestone.date < newDate
    let timeDifference = ONE_DAY_MILLISECONDS * getPositiveDaysDifference(newDate, milestone.date)
    timeDifference = moveMilestoneToTheFuture ? timeDifference : timeDifference * -1

    const milestoneDocs = (
        await getDb()
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('date', '>', milestone.date)
            .where('done', '==', inDoneMilestone)
            .where('ownerId', '==', milestone.ownerId)
            .orderBy('date', 'desc')
            .get()
    ).docs

    const milestones = []
    milestoneDocs.forEach(doc => {
        const futureMilestone = mapMilestoneData(doc.id, doc.data())
        milestones.push(futureMilestone)
    })

    milestones.push(milestone)

    if (!moveMilestoneToTheFuture) milestones.reverse()

    //NOT USE PROMISES HERE, BECAUSE WE NEED TO PROCESS THIS ONE BY ONE, BECAUSE THE RESULT OF THE FIRST AFFECT THE NEXTS
    for (let i = 0; i < milestones.length; i++) {
        const futureMilestone = milestones[i]
        const futureMilestoneNewDate = futureMilestone.date + timeDifference
        await updateMilestoneDate(projectId, futureMilestone, futureMilestoneNewDate)
    }
}

export async function updateMilestoneDateToBacklog(projectId, milestone) {
    const inDoneMilestone = milestone.done

    if (inDoneMilestone) {
        const goals = await getGoalsInDoneMilestone(projectId, milestone.id, [])
        const goalsToMove = goals.filter(goal => goal.progress !== DYNAMIC_PERCENT || goal.dynamicProgress !== 100)

        if (goals.length === goalsToMove.length) deleteMilestone(projectId, milestone.id)
        const backlogId = `${BACKLOG_MILESTONE_ID}${projectId}`
        goalsToMove.forEach(goal => {
            const batch = new BatchWrapper(getDb())
            const updateData = {
                completionMilestoneDate: BACKLOG_DATE_NUMERIC,
                startingMilestoneDate: BACKLOG_DATE_NUMERIC,
                parentDoneMilestoneIds: firebase.firestore.FieldValue.arrayRemove(milestone.id),
                [`progressByDoneMilestone.${milestone.id}`]: firebase.firestore.FieldValue.delete(),
                [`dateByDoneMilestone.${milestone.id}`]: firebase.firestore.FieldValue.delete(),
                progress: goal.progress === 100 ? 80 : goal.progress,
                assigneesReminderDate: updateAssigneesReminderDate(goal.assigneesIds, BACKLOG_DATE_NUMERIC),
            }
            updateGoalData(projectId, goal.id, updateData, batch)
            updateGoalSortIndexes(projectId, goal.id, backlogId)
            batch.commit()
        })
    } else {
        await updateGoalsWhenChangeMilestoneDate(projectId, milestone.date, BACKLOG_DATE_NUMERIC, milestone.ownerId)
        await deleteMilestone(projectId, milestone.id)
        await addOpenMilestoneSortIndexToGoalsInRange(
            projectId,
            milestone.date,
            BACKLOG_DATE_NUMERIC,
            milestone.ownerId
        )
    }
}

export async function updateMilestoneDate(projectId, milestone, newDate) {
    const inDoneMilestone = milestone.done
    if (inDoneMilestone) {
        const promises = []
        promises.push(getGoalsInDoneMilestone(projectId, milestone.id, []))
        promises.push(getMilestoneUsingDate(projectId, newDate, inDoneMilestone, milestone.ownerId))
        const promiseResults = await Promise.all(promises)
        const goals = promiseResults[0]
        const milestoneInSameDate = promiseResults[1]

        if (milestoneInSameDate) {
            await deleteMilestone(projectId, milestone.id)
            const batch = new BatchWrapper(getDb())
            removeGoalsFromDoneMilestone(projectId, milestone.id, goals, batch)
            addGoalsToDoneMilestone(
                projectId,
                milestoneInSameDate.id,
                milestoneInSameDate.date,
                milestoneInSameDate.doneDate,
                goals,
                batch
            )
            batch.commit()
            addOpenMilestoneSortIndexToGoals(projectId, milestoneInSameDate.id, null, goals, milestone.ownerId)
        } else {
            await updateMilestone(projectId, { ...milestone, date: newDate })
            const batch = new BatchWrapper(getDb())
            goals.forEach(goal => {
                updateGoalData(projectId, goal.id, { [`dateByDoneMilestone.${milestone.id}`]: newDate }, batch)
            })
            batch.commit()
        }
    } else {
        await updateGoalsWhenChangeMilestoneDate(projectId, milestone.date, newDate, milestone.ownerId)
        await updateOrDeleteMilestoneWhenChangesDate(projectId, milestone, newDate, inDoneMilestone)

        const date1 = milestone.date < newDate ? milestone.date : newDate
        const date2 = milestone.date > newDate ? milestone.date : newDate
        await addOpenMilestoneSortIndexToGoalsInRange(projectId, date1, date2, milestone.ownerId)
    }
}

async function updateOrDeleteMilestoneWhenChangesDate(projectId, milestone, newDate, searchInDoneMilestones) {
    const milestoneInSameDate = await getMilestoneUsingDate(
        projectId,
        newDate,
        searchInDoneMilestones,
        milestone.ownerId
    )
    milestoneInSameDate
        ? await deleteMilestone(projectId, milestone.id)
        : await updateMilestone(projectId, { ...milestone, date: newDate })
}

async function uploadOpenNewMilestoneIfNotExistMilestoneInSameDate(projectId, date, ownerId) {
    if (date !== BACKLOG_DATE_NUMERIC) {
        const milestoneInSameDate = await getMilestoneUsingDate(projectId, date, false, ownerId)
        if (!milestoneInSameDate) {
            const milestone = getNewDefaultGoalMilestone()
            milestone.date = date
            milestone.ownerId = ownerId
            const milestoneId = getId()
            const promises = []
            promises.push(
                getDb().collection(`goalsMilestones/${projectId}/milestonesItems`).doc(milestoneId).set(milestone)
            )
            promises.push(addOpenMilestoneSortIndexToGoals(projectId, milestoneId, milestone.date, null, ownerId))
            await Promise.all(promises)
        }
    }
}

async function deleteOpenMilestoneIfIsEmpty(projectId, milestoneDate, idsOfGoalsToExclude, ownerId) {
    if (milestoneDate === BACKLOG_DATE_NUMERIC) return
    const isEmpty =
        (await getBaseGoalsInOpenMilestone(projectId, milestoneDate, idsOfGoalsToExclude, ownerId)).length === 0
    if (isEmpty) {
        const milestone = await getMilestoneUsingDate(projectId, milestoneDate, false, ownerId)
        if (milestone) await deleteMilestone(projectId, milestone.id)
    }
}

export async function updateMilestone(projectId, updatedMilestone) {
    const milestoneId = updatedMilestone.id
    delete updatedMilestone.id
    await getDb().doc(`goalsMilestones/${projectId}/milestonesItems/${milestoneId}`).update(updatedMilestone)
}

async function deleteMilestone(projectId, milestoneId) {
    await getDb().doc(`goalsMilestones/${projectId}/milestonesItems/${milestoneId}`).delete()
}

async function updateMilestoneProperty(projectId, milestoneId, updateData) {
    await getDb().doc(`goalsMilestones/${projectId}/milestonesItems/${milestoneId}`).update(updateData)
}

export async function updateGoalMilestoneAssigneesCapacity(projectId, milestoneId, newCapacity, assigneeId) {
    getDb()
        .doc(`goalsMilestones/${projectId}/milestonesItems/${milestoneId}`)
        .update({
            [`assigneesCapacityDates.${assigneeId}`]: newCapacity,
        })
}

export async function updateMilestoneDoneState(projectId, milestone) {
    const toDone = !milestone.done

    let promises = []
    promises.push(getMilestoneUsingDate(projectId, milestone.date, toDone, milestone.ownerId))
    promises.push(getBaseGoalsInOpenMilestone(projectId, milestone.date, [], milestone.ownerId))
    if (!toDone) promises.push(getGoalsInDoneMilestone(projectId, milestone.id, []))

    const results = await Promise.all(promises)
    const milestoneInSameDate = results[0]
    const goalsInOpen = results[1]
    const goalsInDone = results[2]

    const batch = new BatchWrapper(getDb())

    if (toDone) {
        const newDoneDate = Date.now()
        if (milestoneInSameDate) {
            const goalsFromMilestoneInSameDate = await getGoalsInDoneMilestone(projectId, milestoneInSameDate.id, [])
            removeGoalsFromDoneMilestone(projectId, milestoneInSameDate.id, goalsFromMilestoneInSameDate, batch)
            addGoalsToDoneMilestone(
                projectId,
                milestone.id,
                milestone.date,
                newDoneDate,
                goalsFromMilestoneInSameDate,
                batch
            )
            deleteMilestone(projectId, milestoneInSameDate.id)
            addOpenMilestoneSortIndexToGoals(
                projectId,
                milestone.id,
                null,
                goalsFromMilestoneInSameDate,
                milestone.ownerId
            )
        }
        addGoalsToDoneMilestone(projectId, milestone.id, milestone.date, newDoneDate, goalsInOpen, batch)
        updateMilestoneProperty(projectId, milestone.id, { doneDate: newDoneDate, done: toDone })
        moveIncompleteGoalsToNextMilestoneWhenMoveACompletionMilestoneToDone(
            projectId,
            goalsInOpen,
            milestone.date,
            milestone.ownerId
        )
    } else {
        const goalsInDoneToMove = goalsInDone.filter(
            goal =>
                goal.completionMilestoneDate !== BACKLOG_DATE_NUMERIC ||
                goal.progress !== DYNAMIC_PERCENT ||
                goal.dynamicProgress !== 100
        )
        const goalsWithoutMilestones = await getGoalsWithoutParentsOpenMilestonesWhenMoveToOpen(
            projectId,
            goalsInDoneToMove
        )

        goalsInDoneToMove.forEach(goal => {
            if (goal.progress === 100) updateGoalProgress(projectId, 80, goal)
        })
        removeGoalsFromDoneMilestone(projectId, milestone.id, goalsInDoneToMove, batch)

        const updateDate = (milestone, goal) => {
            const date = milestone.date
            updateGoalData(
                projectId,
                goal.id,
                {
                    startingMilestoneDate: date,
                    completionMilestoneDate: date,
                    assigneesReminderDate: updateAssigneesReminderDate(goal.assigneesIds, date),
                },
                null
            )
        }

        const updateSortIndex = (milestoneId, goals) => {
            addOpenMilestoneSortIndexToGoals(projectId, milestoneId, null, goals, milestone.ownerId)
        }

        if (milestoneInSameDate) {
            if (goalsInDone.length === goalsInDoneToMove.length) deleteMilestone(projectId, milestone.id)
            if (goalsWithoutMilestones.length > 0) {
                goalsWithoutMilestones.forEach(goal => {
                    updateDate(milestoneInSameDate, goal)
                })
                updateSortIndex(milestoneInSameDate.id, goalsWithoutMilestones)
            }
        } else {
            if (goalsInOpen.length === 0 && goalsWithoutMilestones.length === 0) {
                if (goalsInDone.length === goalsInDoneToMove.length) deleteMilestone(projectId, milestone.id)
            } else {
                if (goalsInOpen.length > 0) {
                    updateSortIndex(milestone.id, goalsInOpen)
                }
                if (goalsWithoutMilestones.length > 0) {
                    goalsWithoutMilestones.forEach(goal => {
                        updateDate(milestone, goal)
                    })
                    updateSortIndex(milestone.id, goalsWithoutMilestones)
                }
                goalsInDone.length === goalsInDoneToMove.length
                    ? updateMilestoneProperty(projectId, milestone.id, { done: toDone })
                    : uploadOpenNewMilestoneIfNotExistMilestoneInSameDate(projectId, milestone.date, milestone.ownerId)
            }
        }
    }

    batch.commit()
}

async function moveIncompleteGoalsToNextMilestoneWhenMoveACompletionMilestoneToDone(
    projectId,
    goals,
    milestoneDate,
    ownerId
) {
    const goalsToUpdateCompletionDate = goals.filter(goal => {
        const { completionMilestoneDate, progress, dynamicProgress } = goal
        return (
            completionMilestoneDate === milestoneDate &&
            progress !== 100 &&
            (progress !== DYNAMIC_PERCENT || dynamicProgress !== 100)
        )
    })
    if (goalsToUpdateCompletionDate.length > 0) {
        const nextMilestone = await getNextMilestoneAfterDate(projectId, milestoneDate, ownerId)
        const newDate = nextMilestone ? nextMilestone.date : BACKLOG_DATE_NUMERIC
        goalsToUpdateCompletionDate.forEach(goal => {
            updateGoalDateRange(projectId, goal, newDate, 'completionMilestoneDate', true)
        })
    }
}

const updatePrivacyInChildrenTasks = (projectId, goalId, isPublicFor) => {
    getDb()
        .collection(`/items/${projectId}/tasks`)
        .where('parentGoalId', '==', goalId)
        .get()
        .then(docs => {
            docs.forEach(doc => {
                getDb().doc(`items/${projectId}/tasks/${doc.id}`).update({ parentGoalIsPublicFor: isPublicFor })
            })
        })
}

//OTHERS FUNCTIONS

const updateAssigneesReminderDate = (assigneesIds, date) => {
    const assigneesReminderDate = {}
    assigneesIds.forEach(assigneeId => {
        assigneesReminderDate[assigneeId] = date
    })
    return assigneesReminderDate
}

const generateAssigneesReminderDate = async (
    assigneesReminderDate,
    newAssigneesIds,
    projectId,
    ownerId,
    completionMilestoneDate
) => {
    const previousMilestone = await getPreviousMilestone(projectId, ownerId, completionMilestoneDate)
    const newAssigneesReminderDate = {}
    newAssigneesIds.forEach(assigneeId => {
        newAssigneesReminderDate[assigneeId] = assigneesReminderDate[assigneeId]
            ? assigneesReminderDate[assigneeId]
            : previousMilestone
            ? moment(previousMilestone.date).add(1, 'days').valueOf()
            : Date.now()
    })

    return newAssigneesReminderDate
}

function getGoalDirectionWhenChangesDate(newDate, goal, rangeEdgePropertyName) {
    const toBacklog = newDate === BACKLOG_DATE_NUMERIC
    const fromBacklog = goal.completionMilestoneDate === BACKLOG_DATE_NUMERIC
    const moveFullGoalWhenUpdateCompletionDate =
        rangeEdgePropertyName === 'completionMilestoneDate' &&
        (goal.startingMilestoneDate === goal.completionMilestoneDate || newDate < goal.startingMilestoneDate)
    const moveFullGoalWhenUpdateStartingDate =
        rangeEdgePropertyName === 'startingMilestoneDate' && newDate > goal.completionMilestoneDate
    return { toBacklog, fromBacklog, moveFullGoalWhenUpdateCompletionDate, moveFullGoalWhenUpdateStartingDate }
}

const getNewIsPublicForWhenAssigneesChanges = (projectId, isPublicFor, newAssigneesIds) => {
    if (isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
        return [FEED_PUBLIC_FOR_ALL]
    } else {
        const userWithPermanentAccessIds = getAllOwnerIds(projectId, newAssigneesIds)
        return [...isPublicFor, ...userWithPermanentAccessIds.filter(id => !isPublicFor.includes(id))]
    }
}

export function sortGoalsAlphabetically(projectId, milestoneId, goals) {
    const sortedGoals = sortBy(goals, [goal => goal.extendedName])

    const batch = getDb().batch()
    sortedGoals.forEach((goal, index) => {
        batch.update(getDb().doc(`goals/${projectId}/items/${goal.id}`), {
            [`sortIndexByMilestone.${milestoneId}`]: sortedGoals.length - index,
        })
    })
    batch.commit()
}

//SORT INDEX FUNCTIONS

export function updateGoalSortIndexWithBatch(projectId, goalId, milestoneId, batch) {
    const sortIndex = generateSortIndex()
    batch.set(
        getDb().doc(`goals/${projectId}/items/${goalId}`),
        {
            sortIndexByMilestone: { [milestoneId]: sortIndex },
        },
        { merge: true }
    )
    return sortIndex
}

async function updateGoalSortIndexes(projectId, goalId, milestoneId) {
    const sortIndexData = { [milestoneId]: generateSortIndex() }
    await getDb()
        .doc(`goals/${projectId}/items/${goalId}`)
        .set({ sortIndexByMilestone: sortIndexData }, { merge: true })
}

async function updateAllOpenGoalSortIndexs(projectId, goal, useNegativeSortIndex) {
    const { completionMilestoneDate } = goal

    let newSortIndexByMilestone = {}

    const backlogId = `${BACKLOG_MILESTONE_ID}${projectId}`
    const milestones =
        completionMilestoneDate === BACKLOG_DATE_NUMERIC
            ? [{ id: backlogId }]
            : await getOpenMilestonesFromGoal(projectId, goal)

    milestones.forEach(milestone => {
        fillEmptyMilestoneGoalSortIndex(milestone.id, goal, newSortIndexByMilestone, useNegativeSortIndex)
    })

    const finalMilestonesIds = Object.keys(newSortIndexByMilestone)
    if (finalMilestonesIds.length > 0) {
        await getDb()
            .doc(`goals/${projectId}/items/${goal.id}`)
            .set({ sortIndexByMilestone: newSortIndexByMilestone }, { merge: true })
    }
}

async function fillEmptyMilestoneGoalSortIndex(milestoneId, goal, newSortIndexByMilestone, useNegativeSortIndex) {
    const { sortIndexByMilestone } = goal
    if (sortIndexByMilestone[milestoneId]) {
        newSortIndexByMilestone[milestoneId] = sortIndexByMilestone[milestoneId]
    } else {
        newSortIndexByMilestone[milestoneId] = useNegativeSortIndex ? generateNegativeSortIndex() : generateSortIndex()
    }
}

async function addOpenMilestoneSortIndexToGoals(projectId, milestoneId, milestoneDate, milestoneGoals, ownerId) {
    const goals = milestoneGoals
        ? milestoneGoals
        : await getGoalsInOpenMilestone(projectId, milestoneDate, [], true, ownerId)
    const promises = []
    goals.forEach(goal => {
        promises.push(updateGoalSortIndexes(projectId, goal.id, milestoneId))
    })
    await Promise.all(promises)
}

async function addOpenMilestoneSortIndexToGoalsInRange(projectId, date1, date2, ownerId) {
    const milestones = await getOpenMilestonesInDateRange(projectId, date1, date2, ownerId)
    const promises = []
    milestones.forEach(milestone => {
        promises.push(addOpenMilestoneSortIndexToGoals(projectId, milestone.id, milestone.date, null, ownerId))
    })
    if (date2 === BACKLOG_DATE_NUMERIC) promises.push(addBacklogSortIndexToGoalsInBacklog(projectId, ownerId))
    await Promise.all(promises)
}

async function addBacklogSortIndexToGoalsInBacklog(projectId, ownerId) {
    const backlogId = `${BACKLOG_MILESTONE_ID}${projectId}`
    const goals = await getGoalsInOpenMilestone(projectId, BACKLOG_DATE_NUMERIC, [], true, ownerId)
    const promises = []
    goals.forEach(goal => {
        promises.push(updateGoalSortIndexes(projectId, goal.id, backlogId))
    })
    await Promise.all(promises)
}
