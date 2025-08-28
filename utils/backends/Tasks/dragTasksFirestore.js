import { firebase } from '@firebase/app'

import { getDb } from '../firestore'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import { unfocusTaskInUsers, updateTaskData } from './tasksFirestore'

const getUserIdsToUnfocusTask = (projectId, tasksData) => {
    const unfocusDataMap = {}
    tasksData.forEach(data => {
        const assignee = TasksHelper.getUserInProject(projectId, data.userId)
        if (assignee && assignee.inFocusTaskId === data.id) {
            unfocusDataMap[assignee.uid] = { taskId: data.id, userId: assignee.uid, sortIndex: data.sortIndex }
        }
    })
    return Object.values(unfocusDataMap)
}

export function updateSubtasksDataWhenSortPromoteSubtask(
    projectId,
    subtaskId,
    sortIndex,
    sourceParent,
    tasksData,
    taskDataToCheckIfAreFocused
) {
    const batch = new BatchWrapper(getDb())

    updateTaskData(projectId, subtaskId, { sortIndex, parentId: null, isSubtask: false }, batch)

    updateListTasksSortIndex(projectId, tasksData, taskDataToCheckIfAreFocused, batch)

    updateTaskData(
        projectId,
        sourceParent.id,
        { subtaskIds: firebase.firestore.FieldValue.arrayRemove(subtaskId) },
        batch
    )

    batch.commit()
}

export function updateSubtasksDataWhenSortBetweenSubtasksLists(
    projectId,
    subtaskId,
    sortIndex,
    sourceParent,
    destinationParent,
    tasksData
) {
    const batch = new BatchWrapper(getDb())

    batch.set(
        getDb().doc(`items/${projectId}/tasks/${subtaskId}`),
        {
            sortIndex,
            parentId: destinationParent.id,
            completed: destinationParent.completed,
            dueDate: destinationParent.dueDate,
            parentDone: destinationParent.done,
            inDone: destinationParent.inDone,
            userId: destinationParent.userId,
            userIds: destinationParent.userIds,
            currentReviewerId: destinationParent.currentReviewerId,
            stepHistory: destinationParent.stepHistory,
            observersIds: destinationParent.observersIds,
            dueDateByObserversIds: destinationParent.dueDateByObserversIds,
            estimationsByObserverIds: destinationParent.estimationsByObserverIds,
            parentGoalId: destinationParent.parentGoalId,
            parentGoalIsPublicFor: destinationParent.parentGoalIsPublicFor,
            lockKey: destinationParent.lockKey,
        },
        { merge: true }
    )

    updateListTasksSortIndex(projectId, tasksData, [], batch)

    batch.set(
        getDb().doc(`items/${projectId}/tasks/${sourceParent.id}`),
        { subtaskIds: firebase.firestore.FieldValue.arrayRemove(subtaskId) },
        { merge: true }
    )

    batch.set(
        getDb().doc(`items/${projectId}/tasks/${destinationParent.id}`),
        { subtaskIds: firebase.firestore.FieldValue.arrayUnion(subtaskId) },
        { merge: true }
    )

    batch.commit()
}

export function updateSubtasksDataWhenSortDegradeTask(
    projectId,
    movedTask,
    destinationParent,
    tasksData,
    movedSubtasksList
) {
    const batch = new BatchWrapper(getDb())

    updateTaskData(
        projectId,
        movedTask.id,
        {
            sortIndex: movedTask.sortIndex,
            parentId: destinationParent.id,
            isSubtask: true,
            completed: destinationParent.completed,
            dueDate: destinationParent.dueDate,
            parentDone: destinationParent.done,
            inDone: destinationParent.inDone,
            userId: destinationParent.userId,
            userIds: destinationParent.userIds,
            currentReviewerId: destinationParent.currentReviewerId,
            stepHistory: destinationParent.stepHistory,
            observersIds: destinationParent.observersIds,
            dueDateByObserversIds: destinationParent.dueDateByObserversIds,
            estimationsByObserverIds: destinationParent.estimationsByObserverIds,
            parentGoalId: destinationParent.parentGoalId,
            parentGoalIsPublicFor: destinationParent.parentGoalIsPublicFor,
            lockKey: destinationParent.lockKey,
            subtaskIds: [],
            timesDoneInExpectedDay: 0,
            timesDone: 0,
        },
        batch
    )

    movedSubtasksList.forEach(subtask => {
        updateTaskData(
            projectId,
            subtask.id,
            {
                sortIndex: subtask.sortIndex,
                parentId: destinationParent.id,
                completed: destinationParent.completed,
                dueDate: destinationParent.dueDate,
                parentDone: destinationParent.done,
                inDone: destinationParent.inDone,
                userId: destinationParent.userId,
                userIds: destinationParent.userIds,
                currentReviewerId: destinationParent.currentReviewerId,
                stepHistory: destinationParent.stepHistory,
                observersIds: destinationParent.observersIds,
                dueDateByObserversIds: destinationParent.dueDateByObserversIds,
                estimationsByObserverIds: destinationParent.estimationsByObserverIds,
                parentGoalId: destinationParent.parentGoalId,
                parentGoalIsPublicFor: destinationParent.parentGoalIsPublicFor,
            },
            batch
        )
    })

    updateListTasksSortIndex(projectId, tasksData, [movedTask], batch)

    updateTaskData(
        projectId,
        destinationParent.id,
        { subtaskIds: [...destinationParent.subtaskIds, movedTask.id, ...movedTask.subtaskIds] },
        batch
    )

    batch.commit()
}

export function updateSortTaskIndex(projectId, movedTask, taskDataToCheckIfAreFocused, externalBatch) {
    const batch = externalBatch || new BatchWrapper(getDb())

    batch.update(getDb().doc(`items/${projectId}/tasks/${movedTask.id}`), {
        sortIndex: movedTask.sortIndex,
    })

    const unfocusData = getUserIdsToUnfocusTask(projectId, [movedTask, ...taskDataToCheckIfAreFocused])
    unfocusTaskInUsers(projectId, unfocusData, batch)

    if (!externalBatch) batch.commit()
}

export function updateListTasksSortIndex(projectId, tasksData, taskDataToCheckIfAreFocused, externalBatch) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    tasksData.forEach(task => {
        const { id, sortIndex } = task
        batch.set(getDb().doc(`items/${projectId}/tasks/${id}`), { sortIndex }, { merge: true })
    })

    const unfocusData = getUserIdsToUnfocusTask(projectId, taskDataToCheckIfAreFocused)
    unfocusTaskInUsers(projectId, unfocusData, batch)

    if (!externalBatch) {
        batch.commit()
    }
}
