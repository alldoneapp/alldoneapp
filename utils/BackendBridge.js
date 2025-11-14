import * as bridge from './backends/firestore'
import * as goalsBridge from './backends/Goals/goalsFirestore'
import * as skillsBridge from './backends/Skills/skillsFirestore'

export default class Backend {
    static getDb() {
        return bridge.getDb()
    }

    static async inviteUserToProject(userEmail, projectId, inviterUserId) {
        return await bridge.inviteUserToProject(userEmail, projectId, inviterUserId)
    }

    static cancelInvitedUserFromProject(userEmail, projectId) {
        bridge.cancelInvitedUserFromProject(userEmail, projectId)
    }

    static async removeInvitedUserFromProject(user, projectId) {
        return await bridge.removeInvitedUserFromProject(user, projectId)
    }

    static async getUserDataByUidOrEmail(uidOrEmail) {
        return await bridge.getUserDataByUidOrEmail(uidOrEmail)
    }

    static async declineProjectInvitation(user, project) {
        bridge.declineProjectInvitation(user, project)
    }

    static async getUserOrContactBy(projectId, userId) {
        return await bridge.getUserOrContactBy(projectId, userId)
    }

    static async getProjects() {
        return await bridge.getProjects()
    }

    static async getProjectBy(projectId) {
        return await bridge.getProjectBy(projectId)
    }

    static async getProjectData(projectId) {
        return await bridge.getProjectData(projectId)
    }

    static setTaskParentGoalMultiple(tasks, goal) {
        bridge.setTaskParentGoalMultiple(tasks, goal)
    }

    static async setTaskDueDateMultiple(tasks, newDueDate) {
        bridge.setTaskDueDateMultiple(tasks, newDueDate)
    }

    static async setTaskToBacklogMultiple(tasks) {
        bridge.setTaskToBacklogMultiple(tasks)
    }

    static watchNoteInnerTasks(projectId, noteId, watcherKey, callback) {
        bridge.watchNoteInnerTasks(projectId, noteId, watcherKey, callback)
    }

    static setTaskContainerNotesIds(projectId, taskId, noteId, action, checkTaskExitenceWhenRemove) {
        bridge.setTaskContainerNotesIds(projectId, taskId, noteId, action, checkTaskExitenceWhenRemove)
    }

    static async getSubTasksListDirectly(projectId, taskId) {
        return bridge.getSubTasksListDirectly(projectId, taskId)
    }

    static async watchSubtasksList(projectId, taskId, callback) {
        return bridge.watchSubtasksList(projectId, taskId, callback)
    }

    static watchGoalLinkedTasks(projectId, goalId, callback, watcherKey) {
        return bridge.watchGoalLinkedTasks(projectId, goalId, callback, watcherKey)
    }

    static async unwatchSubtasksList(taskId) {
        return bridge.unwatchSubtasksList(taskId)
    }

    static async onSingleTaskChange(projectId, taskId, callback) {
        bridge.onSingleTaskChange(projectId, taskId, callback)
    }

    static async offOnSingleTaskChange() {
        bridge.offOnSingleTaskChange()
    }

    static async getTaskData(projectId, taskId) {
        return await bridge.getTaskData(projectId, taskId)
    }

    static async getNote(projectId, noteId) {
        return await bridge.getNote(projectId, noteId)
    }

    static async getGoalData(projectId, goalId) {
        return await goalsBridge.getGoalData(projectId, goalId)
    }

    static async getMilestoneData(projectId, milestoneId) {
        return await goalsBridge.getMilestoneData(projectId, milestoneId)
    }

    static async onUserWorkflowChange(uid, callback) {
        bridge.onUserWorkflowChange(uid, callback)
    }

    static async offOnUserWorkflowChange() {
        bridge.offOnUserWorkflowChange()
    }

    static async offOnUserChange() {
        bridge.offOnUserChange()
    }

    static async rejectTaskInWorkflow(projectId, task) {
        bridge.rejectTaskInWorkflow(projectId, task)
    }

    static async processFollowersWhenEditTexts(
        projectId,
        followObjectsType,
        followObjectId,
        followObject,
        followersUsersIds,
        needFollowCreator,
        batch
    ) {
        return await bridge.processFollowersWhenEditTexts(
            projectId,
            followObjectsType,
            followObjectId,
            followObject,
            followersUsersIds,
            needFollowCreator,
            batch
        )
    }

    static async convertToArchiveProject(user, project) {
        return bridge.convertToArchiveProject(user, project)
    }

    static async convertToActiveProject(user, project) {
        return bridge.convertToActiveProject(user, project)
    }

    static async uploadAttachments(commentId, attachments) {
        bridge.uploadAttachments(commentId, attachments)
    }

    static watchBacklinksCount(projectId, linkedParentObject, callback, watcherKey) {
        bridge.watchBacklinksCount(projectId, linkedParentObject, callback, watcherKey)
    }

    static unwatchBacklinksCount(objectId, watcherKey) {
        bridge.unwatchBacklinksCount(objectId, watcherKey)
    }

    static watchLinkedTasks(projectId, linkedParentObject, callback) {
        bridge.watchLinkedTasks(projectId, linkedParentObject, callback)
    }

    static unwatchLinkedTasks() {
        bridge.unwatchLinkedTasks()
    }

    static async setProjectDescription(projectId, newDescription, project, oldDescription) {
        bridge.setProjectDescription(projectId, newDescription, project, oldDescription)
    }

    static async removeProject(projectId) {
        return bridge.removeProject(projectId)
    }

    static async getTasksByProject(projectId) {
        return bridge.getTasksByProject(projectId)
    }

    static async getAttachments(commentId) {
        return bridge.getAttachments(commentId)
    }

    static getStepWorkflowDirection(targetStepId, task, workflow) {
        return bridge.getStepWorkflowDirection(targetStepId, task, workflow)
    }

    static async unwatchObjectComments(projectId, objectType, objectId) {
        return await bridge.unwatchObjectComments(projectId, objectType, objectId)
    }

    static addUniqueInstanceTypeToArray(array, element) {
        return bridge.addUniqueInstanceTypeToArray(array, element)
    }

    static findTask(taskId, projectsTasks) {
        return bridge.findTask(taskId, projectsTasks)
    }

    static loginWithGoogle() {
        return bridge.loginWithGoogleWeb()
    }

    static logout(onComplete) {
        bridge.logoutWeb(onComplete)
    }

    static async initGAPI() {
        bridge.initGAPIWeb()
    }

    static initFirebase(onComplete) {
        bridge.initFirebase(onComplete)
    }

    static getNewId() {
        return bridge.getNewId()
    }

    static getId() {
        return bridge.getId()
    }

    static async deleteTask(task, projectId) {
        bridge.deleteTask(task, projectId)
    }

    static async deleteTaskMultiple(tasks) {
        bridge.deleteTaskMultiple(tasks)
    }

    static async watchFollowedUsers(projectId, userId, callback) {
        return bridge.watchFollowedUsers(projectId, userId, callback)
    }

    static async watchFollowedContacts(projectId, userId, callback) {
        return bridge.watchFollowedContacts(projectId, userId, callback)
    }

    static async unwatchFollowedContacts(projectId, userId) {
        bridge.unwatchFollowedContacts(projectId, userId)
    }

    static async unwatchFollowedUsers(projectId, userId) {
        bridge.unwatchFollowedUsers(projectId, userId)
    }

    static async createTaskFeed(projectId, newTask) {
        bridge.createTaskFeed(projectId, newTask)
    }

    static async offOnFeedChange() {
        bridge.offOnFeedChange()
    }

    static async offOnTaskFeedChange(projectId, taskId, callback) {
        bridge.offOnTaskFeedChange(projectId, taskId, callback)
    }

    static watchUserStatistics(projectId, estimationType, userId, timestamp1, timestamp2, watcherKey, callback) {
        bridge.watchUserStatistics(projectId, estimationType, userId, timestamp1, timestamp2, watcherKey, callback)
    }

    static getUserStatistics(projectId, userId, date, callback, callbackOffline) {
        bridge.getUserStatistics(projectId, userId, date, callback, callbackOffline)
    }

    static watchAllUserStatisticsByRange(
        projectId,
        estimationType,
        userId,
        timestamp1,
        timestamp2,
        watcherKey,
        callback
    ) {
        bridge.watchAllUserStatisticsByRange(
            projectId,
            estimationType,
            userId,
            timestamp1,
            timestamp2,
            watcherKey,
            callback
        )
    }

    static async storeAttachment(projectId, attachment, inNotes) {
        return await bridge.storeAttachment(projectId, attachment, inNotes)
    }

    static async storeConvertedVideos(projectId, attachment) {
        return await bridge.storeConvertedVideos(projectId, attachment)
    }

    static mapTaskData(taskId, task) {
        return bridge.mapTaskData(taskId, task)
    }

    static mapGoalData(goalId, goal) {
        return bridge.mapGoalData(goalId, goal)
    }

    static mapNoteData(noteId, note) {
        return bridge.mapNoteData(noteId, note)
    }

    static getFirebaseTimestamp() {
        return bridge.getFirebaseTimestamp()
    }

    static onKarmaChange(uid, callback) {
        return bridge.onKarmaChange(uid, callback)
    }

    static offKarmaChange() {
        return bridge.offKarmaChange()
    }

    static offXpChange() {
        return bridge.offXpChange()
    }

    static watchAllDoneVersion(updateVersion) {
        return bridge.watchAllDoneVersion(updateVersion)
    }

    static getAllDoneVersion() {
        return bridge.getAllDoneVersion()
    }

    static mapUserData(userId, user) {
        return bridge.mapUserData(userId, user)
    }

    static mapContactData(userId, user) {
        return bridge.mapContactData(userId, user)
    }

    static mapProjectData(projectId, project, customData) {
        return bridge.mapProjectData(projectId, project, customData)
    }

    static mapWorkstreamData(wstreamId, workstreamData) {
        return bridge.mapWorkstreamData(wstreamId, workstreamData)
    }

    static generateId() {
        return bridge.getId()
    }

    static generateSortIndex() {
        return bridge.generateSortIndex()
    }

    static async getNotesByProject(projectId) {
        return await bridge.getNotesByProject(projectId)
    }

    static watchFollowedTabNotes(projectId, maxNotesToRender, callback) {
        bridge.watchFollowedTabNotes(projectId, maxNotesToRender, callback)
    }

    static watchFollowedTabNotesExpanded(projectId, callback) {
        bridge.watchFollowedTabNotesExpanded(projectId, callback)
    }

    static watchFollowedTabNotesInAllProjects(projectId, maxNotesToRender, callback) {
        bridge.watchFollowedTabNotesInAllProjects(projectId, maxNotesToRender, callback)
    }

    static watchFollowedTabNotesExpandedInAllProjects(projectId, callback) {
        bridge.watchFollowedTabNotesExpandedInAllProjects(projectId, callback)
    }

    static watchFollowedTabStickyNotes(projectId, callback) {
        bridge.watchFollowedTabStickyNotes(projectId, callback)
    }

    static watchAllTabNotes(projectId, maxNotesToRender, callback) {
        bridge.watchAllTabNotes(projectId, maxNotesToRender, callback)
    }

    static watchAllTabNotesExpanded(projectId, callback) {
        bridge.watchAllTabNotesExpanded(projectId, callback)
    }

    static watchAllTabNotesInAllProjects(projectId, maxNotesToRender, callback) {
        bridge.watchAllTabNotesInAllProjects(projectId, maxNotesToRender, callback)
    }

    static watchAllTabNotesExpandedInAllProjects(projectId, callback) {
        bridge.watchAllTabNotesExpandedInAllProjects(projectId, callback)
    }

    static watchAllTabStickyNotes(projectId, callback) {
        bridge.watchAllTabStickyNotes(projectId, callback)
    }

    static watchFollowedTabNotesNeedShowMore(projectId, notesToLoad, callback) {
        bridge.watchFollowedTabNotesNeedShowMore(projectId, notesToLoad, callback)
    }

    static watchFollowedTabNotesNeedShowMoreInAllProjects(projectId, notesToLoad, callback) {
        bridge.watchFollowedTabNotesNeedShowMoreInAllProjects(projectId, notesToLoad, callback)
    }

    static watchAllTabNotesNeedShowMore(projectId, notesToLoad, callback) {
        bridge.watchAllTabNotesNeedShowMore(projectId, notesToLoad, callback)
    }

    static watchAllTabNotesNeedShowMoreInAllProjects(projectId, notesToLoad, callback) {
        bridge.watchAllTabNotesNeedShowMoreInAllProjects(projectId, notesToLoad, callback)
    }

    static unwatchNotesNeedShowMore(projectId) {
        bridge.unwatchNotesNeedShowMore(projectId)
    }

    static unwatchNotes2(projectId) {
        bridge.unwatchNotes2(projectId)
    }

    static unwatchStickyNotes(projectId) {
        bridge.unwatchStickyNotes(projectId)
    }

    static watchNotes(projectId, uid, callback) {
        bridge.watchNotes(projectId, uid, callback)
    }

    static unwatchNotes(projectId, uid) {
        bridge.unwatchNotes(projectId, uid)
    }

    static watchNote(projectId, noteId, callback) {
        bridge.watchNote(projectId, noteId, callback)
    }

    static unwatchNote(projectId, noteId) {
        bridge.unwatchNote(projectId, noteId)
    }

    static watchObjectLTag(objectType, path, watchId, callback) {
        bridge.watchObjectLTag(objectType, path, watchId, callback)
    }

    static unwatchObjectLTag(objectType, path, watchId) {
        bridge.unwatchObjectLTag(objectType, path, watchId)
    }

    static watchLinkedNotes(projectId, uid, linkedParentObject, callback) {
        bridge.watchLinkedNotes(projectId, uid, linkedParentObject, callback)
    }

    static unwatchLinkedNotes(projectId, uid) {
        bridge.unwatchLinkedNotes(projectId, uid)
    }

    static watchFeedObjectLastState(watchId, projectId, objectType, objectId, callback) {
        bridge.watchFeedObjectLastState(watchId, projectId, objectType, objectId, callback)
    }

    static unwatchFeedObjectLastState(watchId) {
        bridge.unwatchFeedObjectLastState(watchId)
    }

    static async getNoteData(projectId, noteId) {
        return bridge.getNoteData(projectId, noteId)
    }

    static async getNoteMeta(projectId, noteId) {
        return bridge.getNoteMeta(projectId, noteId)
    }

    static setLinkedParentObjects(projectId, linkedParents, linkedObject, initialLinks) {
        bridge.setLinkedParentObjects(projectId, linkedParents, linkedObject, initialLinks)
    }

    static watchNotesCollab(noteId, callback) {
        bridge.watchNotesCollab(noteId, callback)
    }

    static addNoteEditor(noteId, editor) {
        bridge.addNoteEditor(noteId, editor)
    }

    static removeNoteEditor(noteId, editor) {
        bridge.removeNoteEditor(noteId, editor)
    }

    static createGenericTasksForMentionsInNoteContent(projectId, noteId, mentionedUserIds, assistantId) {
        bridge.createGenericTasksForMentionsInNoteContent(projectId, noteId, mentionedUserIds, assistantId)
    }

    static generateNTSToken() {
        return bridge.generateNTSToken()
    }

    static async getPaymentOnce(userId) {
        return await bridge.getPaymentOnce(userId)
    }

    static tryAddFollower(projectId, followData, externalBatch) {
        return bridge.tryAddFollower(projectId, followData, externalBatch)
    }

    static addFollower(projectId, followData) {
        return bridge.addFollower(projectId, followData)
    }

    static removeFollower(projectId, followData) {
        return bridge.removeFollower(projectId, followData)
    }

    static watchFollowers(projectId, followObjectsType, followObjectId, callback, watchId) {
        return bridge.watchFollowers(projectId, followObjectsType, followObjectId, callback, watchId)
    }

    static unsubsWatchFollowers(projectId, followObjectsType, followObjectId, watchId) {
        return bridge.unsubsWatchFollowers(projectId, followObjectsType, followObjectId, watchId)
    }

    static unsubStoreFeedsTab(projectId) {
        return bridge.unsubStoreFeedsTab(projectId)
    }

    static watchNewFeedsAllTabsRedux(projectId, userId) {
        return bridge.watchNewFeedsAllTabsRedux(projectId, userId)
    }

    static async getFeedObject(projectId, dateFormated, objectId, feedType, lastChangeDate) {
        return await bridge.getFeedObject(projectId, dateFormated, objectId, feedType, lastChangeDate)
    }

    static async getLastObjectFeed(projectId, objectTypes, feedObjectId, nLast = 1, callback) {
        return await bridge.getLastObjectFeed(projectId, objectTypes, feedObjectId, nLast, callback)
    }

    static watchDetailedViewFeeds(projectId, objectTypes, feedObjectId, callback) {
        return bridge.watchDetailedViewFeeds(projectId, objectTypes, feedObjectId, callback)
    }

    static unsubDetailedViewFeeds() {
        return bridge.unsubDetailedViewFeeds()
    }

    static unsubNewFeedsTab(projectId, tab) {
        return bridge.unsubNewFeedsTab(projectId, tab)
    }

    static watchAllNewFeedsAllTabs(projects, userId, followedCallback, allCallback) {
        return bridge.watchAllNewFeedsAllTabs(projects, userId, followedCallback, allCallback)
    }

    static watchNewFeedsAllTabs(projectId, userId, followingCallback, allCallback) {
        return bridge.watchNewFeedsAllTabs(projectId, userId, followingCallback, allCallback)
    }

    static resetAllNewFeeds(projectId, feedActiveTab) {
        return bridge.resetAllNewFeeds(projectId, feedActiveTab)
    }

    static async getFeedObjectLastState(projectId, objectType, objectId) {
        return await bridge.getFeedObjectLastState(projectId, objectType, objectId)
    }

    static async getFeedObjectsLastStateList(projectId, objectType) {
        return await bridge.getFeedObjectsLastStateList(projectId, objectType)
    }

    static getMeetings(projectId, setMeetings, setZero) {
        return bridge.getMeetings(projectId, setMeetings, setZero)
    }

    static acceptJoinEvent(projectId, roomId, userEmail) {
        return bridge.acceptJoinEvent(projectId, roomId, userEmail)
    }

    static rejectJoinEvent(projectId, roomId, userEmail, reasons, callback) {
        return bridge.rejectJoinEvent(projectId, roomId, userEmail, reasons, callback)
    }

    static deleteEvent(projectId, roomId) {
        return bridge.deleteEvent(projectId, roomId)
    }

    static getObjectFromUrl(objectType, url, callback) {
        return bridge.getObjectFromUrl(objectType, url, callback)
    }

    static logEvent(name, params) {
        bridge.logEvent(name, params)
    }

    static watchSubtasks(projectId, taskId, watcherKey, callback) {
        return bridge.watchSubtasks(projectId, taskId, watcherKey, callback)
    }

    //////GOALS MILESTONES /////////

    static watchMilestones(projectId, callback, milestonesInDone, watcherKey, ownerId) {
        return goalsBridge.watchMilestones(projectId, callback, milestonesInDone, watcherKey, ownerId)
    }

    static watchActiveMilestone(projectId, watcherKey, callback, ownerId) {
        return goalsBridge.watchActiveMilestone(projectId, watcherKey, callback, ownerId)
    }

    static watchMilestoneTasksStatistics(
        projectId,
        milestoneInitalDate,
        milestoneEndDate,
        inDone,
        watcherKey,
        callback
    ) {
        return goalsBridge.watchMilestoneTasksStatistics(
            projectId,
            milestoneInitalDate,
            milestoneEndDate,
            inDone,
            watcherKey,
            callback
        )
    }

    static updateGoalMilestoneAssigneesCapacity(projectId, milestoneId, newCapacity, assigneeId) {
        return goalsBridge.updateGoalMilestoneAssigneesCapacity(projectId, milestoneId, newCapacity, assigneeId)
    }

    static updateMilestone(projectId, updatedMilestone) {
        return goalsBridge.updateMilestone(projectId, updatedMilestone)
    }

    static updateMilestoneDateToBacklog(projectId, milestone) {
        return goalsBridge.updateMilestoneDateToBacklog(projectId, milestone)
    }

    static updateMilestoneDate(projectId, milestone, newDate) {
        return goalsBridge.updateMilestoneDate(projectId, milestone, newDate)
    }

    static updateFutureOpenMilestonesDateToBacklog(projectId, milestone) {
        return goalsBridge.updateFutureOpenMilestonesDateToBacklog(projectId, milestone)
    }

    static updateFutureOpenMilestonesDate(projectId, milestone, newDate) {
        return goalsBridge.updateFutureOpenMilestonesDate(projectId, milestone, newDate)
    }

    static updateGoalDateRange(projectId, goal, newDate, rangeEdgePropertyName, needToUpdateGoal) {
        return goalsBridge.updateGoalDateRange(projectId, goal, newDate, rangeEdgePropertyName, needToUpdateGoal)
    }

    static updateMilestoneDoneState(projectId, milestone) {
        return goalsBridge.updateMilestoneDoneState(projectId, milestone)
    }

    //GOALS////

    static unwatch(watcherKey) {
        return bridge.unwatch(watcherKey)
    }

    static watchGoalsInDateRange(projectId, date1, date2, watcherKey, callback, ownerId) {
        return goalsBridge.watchGoalsInDateRange(projectId, date1, date2, watcherKey, callback, ownerId)
    }

    static watchGoal(projectId, goalId, watcherKey, callback) {
        return goalsBridge.watchGoal(projectId, goalId, watcherKey, callback)
    }

    static watchOpenGoalsAmounts(
        projectId,
        inAllTeams,
        assigneesIdsToShow,
        showMoreExpanded,
        numberGoalsAllTeams,
        milestoneWatcherKey,
        goalWatcherKey,
        callback
    ) {
        return goalsBridge.watchOpenGoalsAmounts(
            projectId,
            inAllTeams,
            assigneesIdsToShow,
            showMoreExpanded,
            numberGoalsAllTeams,
            milestoneWatcherKey,
            goalWatcherKey,
            callback
        )
    }

    static watchDoneGoalsAmounts(
        projectId,
        inAllTeams,
        assigneesIdsToShow,
        numberGoalsAllTeams,
        milestoneWatcherKey,
        goalWatcherKey,
        callback
    ) {
        return goalsBridge.watchDoneGoalsAmounts(
            projectId,
            inAllTeams,
            assigneesIdsToShow,
            numberGoalsAllTeams,
            milestoneWatcherKey,
            goalWatcherKey,
            callback
        )
    }

    static watchAllDoneGoalsAmounts(projectId, assigneesIdsToShow, goalWatcherKey, callback) {
        return goalsBridge.watchAllDoneGoalsAmounts(projectId, assigneesIdsToShow, goalWatcherKey, callback)
    }

    static async uploadNewGoal(projectId, goal, baseDate, tryToGenerateBotAdvaice, movingGoalToOtherProject) {
        return await goalsBridge.uploadNewGoal(
            projectId,
            goal,
            baseDate,
            tryToGenerateBotAdvaice,
            movingGoalToOtherProject
        )
    }

    static deleteGoal(projectId, goal, movingToOtherProjectId) {
        return goalsBridge.deleteGoal(projectId, goal, movingToOtherProjectId)
    }

    static deleteAllGoalsInMilestone(projectId, goals) {
        return goalsBridge.deleteAllGoalsInMilestone(projectId, goals)
    }

    static updateGoalAssigneeReminderDate(projectId, goalId, userId, date) {
        return goalsBridge.updateGoalAssigneeReminderDate(projectId, goalId, userId, date)
    }

    static async updateGoal(projectId, oldGoal, updatedGoal, avoidFollow) {
        return await goalsBridge.updateGoal(projectId, oldGoal, updatedGoal, avoidFollow)
    }

    static updateGoalHighlight(projectId, hasStar, goal) {
        return goalsBridge.updateGoalHighlight(projectId, hasStar, goal)
    }

    static updateGoalPrivacy(projectId, isPublicFor, goal) {
        return goalsBridge.updateGoalPrivacy(projectId, isPublicFor, goal)
    }

    static updateGoalProgress(projectId, progress, goal) {
        return goalsBridge.updateGoalProgress(projectId, progress, goal)
    }

    static async getActiveMilestone(projectId, ownerId) {
        return await goalsBridge.getActiveMilestone(projectId, ownerId)
    }

    static async updateGoalAssigneesIds(
        projectId,
        goalId,
        oldAssigneesIds,
        newAssigneesIds,
        goal,
        oldAssigneesCapacity,
        newAssigneesCapacity
    ) {
        return await goalsBridge.updateGoalAssigneesIds(
            projectId,
            goalId,
            oldAssigneesIds,
            newAssigneesIds,
            goal,
            oldAssigneesCapacity,
            newAssigneesCapacity
        )
    }

    static updateGoalAssigneeCapacity(projectId, goal, oldCapacity, newCapacity, assigneeId) {
        return goalsBridge.updateGoalAssigneeCapacity(projectId, goal, oldCapacity, newCapacity, assigneeId)
    }

    static setGoalDescription(projectId, goalId, description, goal, oldDescription) {
        return goalsBridge.setGoalDescription(projectId, goalId, description, goal, oldDescription)
    }

    static updateGoalName(projectId, goalId, oldName, newName, goal) {
        return goalsBridge.updateGoalName(projectId, goalId, oldName, newName, goal)
    }

    static async updateGoalProject(oldProject, newProject, goal) {
        return await goalsBridge.updateGoalProject(oldProject, newProject, goal)
    }

    static updateGoalSortIndexWithBatch(projectId, goalId, milestoneId, batch) {
        return goalsBridge.updateGoalSortIndexWithBatch(projectId, goalId, milestoneId, batch)
    }

    static watchOpenMilestonesInDateRange(projectId, date1, date2, watcherKey, callback, ownerId) {
        return goalsBridge.watchOpenMilestonesInDateRange(projectId, date1, date2, watcherKey, callback, ownerId)
    }

    //GOALS UPDATES

    static async getFirebaseTimestampDirectly() {
        return await bridge.getFirebaseTimestampDirectly()
    }

    static updateHastagsColors(projectId, text, colors, updateColors) {
        return bridge.updateHastagsColors(projectId, text, colors, updateColors)
    }

    static watchHastagsColors(projectId, hashtagId, text, callback) {
        return bridge.watchHastagsColors(projectId, hashtagId, text, callback)
    }

    static unwatchHastagsColors(hashtagId) {
        return bridge.unwatchHastagsColors(hashtagId)
    }

    static getAlgoliaSearchOnlyKeys() {
        return bridge.getAlgoliaSearchOnlyKeys()
    }

    static watchNoteRevisionHistoryCopies(projectId, noteId, callback) {
        return bridge.watchNoteRevisionHistoryCopies(projectId, noteId, callback)
    }

    static unwatchNoteRevisionHistoryCopies() {
        return bridge.unwatchNoteRevisionHistoryCopies()
    }

    static async createDailyNoteCopy(projectId, noteId, note, paths) {
        return await bridge.createDailyNoteCopy(projectId, noteId, note, paths)
    }

    static async restoreNoteCopy(projectId, noteId, restoredNoteVersion, paths) {
        return await bridge.restoreNoteCopy(projectId, noteId, restoredNoteVersion, paths)
    }

    static async restoreDailyNoteCopy(projectId, noteId, paths) {
        return await bridge.restoreDailyNoteCopy(projectId, noteId, paths)
    }

    static async saveNoteCopy(projectId, note, versionName, paths) {
        return await bridge.saveNoteCopy(projectId, note, versionName, paths)
    }

    static async registerError(error) {
        return bridge.registerError(error)
    }

    static uploadNewSkill(projectId, skill, isUpdatingProject, oldProject, callback, tryToGenerateBotAdvaice) {
        return skillsBridge.uploadNewSkill(
            projectId,
            skill,
            isUpdatingProject,
            oldProject,
            callback,
            tryToGenerateBotAdvaice
        )
    }

    static updateSkill(projectId, oldSkill, updatedSkill, avoidFollow) {
        return skillsBridge.updateSkill(projectId, oldSkill, updatedSkill, avoidFollow)
    }

    static watchSkills(projectId, userId, watcherKey) {
        return skillsBridge.watchSkills(projectId, userId, watcherKey)
    }

    static updateSkillPoints(projectId, skill, pointsToAdd) {
        return skillsBridge.updateSkillPoints(projectId, skill, pointsToAdd)
    }

    static updateSkillPrivacy(projectId, skill, isPublicFor) {
        return skillsBridge.updateSkillPrivacy(projectId, skill, isPublicFor)
    }

    static updateSkillDescription(projectId, skill, description) {
        return skillsBridge.updateSkillDescription(projectId, skill, description)
    }

    static updateSkillProject(oldProject, newProject, skill, callback) {
        return skillsBridge.updateSkillProject(oldProject, newProject, skill, callback)
    }

    static deleteSkill(projectId, skill, movingToOtherProjectId, newProject) {
        return skillsBridge.deleteSkill(projectId, skill, movingToOtherProjectId, newProject)
    }

    static resetSkills(projectId) {
        return skillsBridge.resetSkills(projectId)
    }

    static updateSkillSortIndex(projectId, skillId, batch) {
        return skillsBridge.updateSkillSortIndex(projectId, skillId, batch)
    }

    static watchSkill(projectId, skillId, watcherKey, callback) {
        return skillsBridge.watchSkill(projectId, skillId, watcherKey, callback)
    }

    static updateSkillName(projectId, newName, skill) {
        return skillsBridge.updateSkillName(projectId, newName, skill)
    }

    static updateSkillHighlight(projectId, hasStar, skill) {
        return skillsBridge.updateSkillHighlight(projectId, hasStar, skill)
    }
}
