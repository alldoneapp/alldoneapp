import { FOLLOWER_TASKS_TYPE } from '../../../components/Followers/FollowerConstants'
import TasksHelper, { OPEN_STEP } from '../../../components/TaskListView/Utils/TasksHelper'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import store from '../../../redux/store'
import { addFollower, getDb, tryAddFollower } from '../firestore'
import { createTaskAssigneeEstimationChangedFeed, createTaskCreatedFeed } from './taskUpdates'

export async function creatFollowUpTaskFeedChain(projectId, oldTask, newEstimation, followUpTask, followUpTaskId) {
    const { loggedUser } = store.getState()

    const feedBatch = new BatchWrapper(getDb())

    const feedChainFollowersIds = [loggedUser.uid]
    feedBatch.feedChainFollowersIds = { [oldTask.id]: feedChainFollowersIds }
    feedBatch.feedChainFollowersIds = { [followUpTaskId]: feedChainFollowersIds }

    if (oldTask.estimations[OPEN_STEP] !== newEstimation) {
        await createTaskAssigneeEstimationChangedFeed(
            projectId,
            oldTask.id,
            oldTask.estimations[OPEN_STEP],
            newEstimation,
            feedBatch
        )
    }

    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: oldTask.id,
        followObject: oldTask,
        feedCreator: loggedUser,
    }
    await tryAddFollower(projectId, followTaskData, feedBatch)

    const followTaskCreatorData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: followUpTaskId,
        followObject: followUpTask,
        feedCreator: loggedUser,
    }
    await createTaskCreatedFeed(projectId, followUpTask, followUpTaskId, feedBatch, loggedUser)
    await addFollower(projectId, followTaskCreatorData, feedBatch)
    if (loggedUser.uid !== followUpTask.userId) {
        const followTaskAssigneeData = {
            followObjectsType: FOLLOWER_TASKS_TYPE,
            followObjectId: followUpTaskId,
            followObject: followUpTask,
            feedCreator: TasksHelper.getUserInProject(projectId, followUpTask.userId) || loggedUser,
        }
        await addFollower(projectId, followTaskAssigneeData, feedBatch)
    }

    const followUpMentions = TasksHelper.getMentionUsersFromTitle(projectId, followUpTask.extendedName)
    const followUpMentionFollowerData = { ...followTaskCreatorData }

    for (let i = 0; i < followUpMentions.length; i++) {
        const user = followUpMentions[i]
        if (user.uid !== loggedUser.uid) {
            followUpMentionFollowerData.loggedUser = user
            await tryAddFollower(projectId, followUpMentionFollowerData, feedBatch)
        }
    }

    feedBatch.commit()
}
