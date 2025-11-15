const moment = require('moment')
const {
    FEED_PUBLIC_FOR_ALL,
    DEFAULT_WORKSTREAM_ID,
    CAPACITY_NONE,
    BACKLOG_DATE_NUMERIC,
    CURRENT_DAY_VERSION_ID,
    RECURRENCE_NEVER,
    OPEN_STEP,
    ESTIMATION_0_MIN,
    ALL_USERS,
    getTaskNameWithoutMeta,
    DYNAMIC_PERCENT,
    TASK_ASSIGNEE_USER_TYPE,
    PROJECT_COLOR_DEFAULT,
    ESTIMATION_TYPE_TIME,
    PROJECT_PUBLIC,
    generateNegativeSortIndex,
} = require('./HelperFunctionsCloud')

function mapContactData(contactId, contact) {
    return {
        uid: contactId,
        displayName: contact.displayName ? contact.displayName : '',
        photoURL: contact.photoURL ? contact.photoURL : '',
        photoURL50: contact.photoURL50 ? contact.photoURL50 : '',
        photoURL300: contact.photoURL300 ? contact.photoURL300 : '',
        company: contact.company ? contact.company : '',
        role: contact.role ? contact.role : '',
        description: contact.description ? contact.description : '',
        extendedDescription: contact.extendedDescription
            ? contact.extendedDescription
            : contact.description
            ? contact.description
            : '',
        hasStar: contact.hasStar ? contact.hasStar : '#FFFFFF',
        isPrivate: contact.isPrivate ? contact.isPrivate : false,
        isPublicFor: contact.isPublicFor ? contact.isPublicFor : [FEED_PUBLIC_FOR_ALL, contact.recorderUserId],
        recorderUserId: contact.recorderUserId ? contact.recorderUserId : '',
        email: contact.email ? contact.email : '',
        phone: contact.phone ? contact.phone : '',
        lastEditorId: contact.lastEditorId ? contact.lastEditorId : '',
        lastEditionDate: contact.lastEditionDate ? contact.lastEditionDate : Date.now(),
        noteId: contact.noteId ? contact.noteId : null,
        isPremium: contact.isPremium ? contact.isPremium : false,
        assistantId: contact.assistantId ? contact.assistantId : '',
        commentsData: contact.commentsData ? contact.commentsData : '',
        openTasksAmount: contact.openTasksAmount ? contact.openTasksAmount : 0,
    }
}

function mapGoalData(goalId, goal) {
    const extendedName = goal.extendedName ? goal.extendedName : goal.name ? goal.name : ''
    return {
        id: goal.id ? goal.id : goalId,
        name: getTaskNameWithoutMeta(extendedName),
        extendedName,
        created: goal.created ? goal.created : Date.now(),
        creatorId: goal.creatorId ? goal.creatorId : '',
        progress: goal.progress >= 0 ? goal.progress : DYNAMIC_PERCENT,
        assigneesIds: goal.assigneesIds ? goal.assigneesIds : [DEFAULT_WORKSTREAM_ID],
        assigneesCapacity: goal.assigneesCapacity ? goal.assigneesCapacity : { [DEFAULT_WORKSTREAM_ID]: CAPACITY_NONE },
        assigneesReminderDate: goal.assigneesReminderDate
            ? goal.assigneesReminderDate
            : { [DEFAULT_WORKSTREAM_ID]: Date.now() },
        lastEditionDate: goal.lastEditionDate ? goal.lastEditionDate : Date.now(),
        lastEditorId: goal.lastEditorId ? goal.lastEditorId : '',
        hasStar: goal.hasStar ? goal.hasStar : '#FFFFFF',
        description: goal.description ? goal.description : '',
        startingMilestoneDate: goal.startingMilestoneDate ? goal.startingMilestoneDate : BACKLOG_DATE_NUMERIC,
        completionMilestoneDate: goal.completionMilestoneDate ? goal.completionMilestoneDate : BACKLOG_DATE_NUMERIC,
        parentDoneMilestoneIds: goal.parentDoneMilestoneIds ? goal.parentDoneMilestoneIds : [],
        progressByDoneMilestone: goal.progressByDoneMilestone ? goal.progressByDoneMilestone : {},
        isPublicFor: goal.isPublicFor ? goal.isPublicFor : [FEED_PUBLIC_FOR_ALL],
        dateByDoneMilestone: goal.dateByDoneMilestone ? goal.dateByDoneMilestone : {},
        sortIndexByMilestone: goal.sortIndexByMilestone ? goal.sortIndexByMilestone : {},
        noteId: goal.noteId ? goal.noteId : null,
        dynamicProgress: goal.dynamicProgress ? goal.dynamicProgress : 0,
        ownerId: goal.ownerId ? goal.ownerId : ALL_USERS,
        isPremium: goal.isPremium ? goal.isPremium : false,
        lockKey: goal.lockKey ? goal.lockKey : '',
        assistantId: goal.assistantId ? goal.assistantId : '',
        commentsData: goal.commentsData ? goal.commentsData : '',
    }
}

function mapNoteData(noteId, note) {
    const extendedTitle = note.extendedTitle ? note.extendedTitle : note.title ? note.title : ''
    const hasStar = !note.hasStar ? '#FFFFFF' : note.hasStar === true ? '#C7E3FF' : note.hasStar

    return {
        id: note.id ? note.id : noteId,
        title: getTaskNameWithoutMeta(extendedTitle),
        extendedTitle,
        preview: note.preview ? note.preview : '',
        created: note.created ? note.created : Date.now(),
        lastEditorId: note.lastEditorId ? note.lastEditorId : '',
        lastEditionDate: note.lastEditionDate ? note.lastEditionDate : Date.now(),
        views: note.views ? note.views : 0,
        creatorId: note.creatorId ? note.creatorId : '',
        hasStar: hasStar,
        isPrivate: note.isPrivate ? note.isPrivate : false,
        isPublicFor: note.isPublicFor ? note.isPublicFor : [FEED_PUBLIC_FOR_ALL, note.userId],
        userId: note.userId ? note.userId : '',
        stickyData: note.stickyData ? note.stickyData : { stickyEndDate: 0, days: 0 },
        linkedParentNotesIds: note.linkedParentNotesIds ? note.linkedParentNotesIds : [],
        linkedParentTasksIds: note.linkedParentTasksIds ? note.linkedParentTasksIds : [],
        linkedParentContactsIds: note.linkedParentContactsIds ? note.linkedParentContactsIds : [],
        linkedParentProjectsIds: note.linkedParentProjectsIds ? note.linkedParentProjectsIds : [],
        linkedParentGoalsIds: note.linkedParentGoalsIds ? note.linkedParentGoalsIds : [],
        linkedParentSkillsIds: note.linkedParentSkillsIds ? note.linkedParentSkillsIds : [],
        linkedParentAssistantIds: note.linkedParentAssistantIds ? note.linkedParentAssistantIds : [],
        linkedParentsInContentIds: note.linkedParentsInContentIds ? note.linkedParentsInContentIds : {},
        linkedParentsInTitleIds: note.linkedParentsInTitleIds ? note.linkedParentsInTitleIds : {},
        versionId: note.versionId ? note.versionId : CURRENT_DAY_VERSION_ID,
        isVisibleInFollowedFor: note.isVisibleInFollowedFor ? note.isVisibleInFollowedFor : [],
        followersIds: note.followersIds ? note.followersIds : [],
        parentObject: note.parentObject ? note.parentObject : null,
        isPremium: note.isPremium ? note.isPremium : false,
        linkedToTemplate: note.linkedToTemplate ? note.linkedToTemplate : false,
        assistantId: note.assistantId ? note.assistantId : '',
        commentsData: note.commentsData ? note.commentsData : '',
    }
}

function mapMilestoneData(milestoneId, milestone) {
    return {
        id: milestone.id ? milestone.id : milestoneId,
        extendedName: milestone.extendedName ? milestone.extendedName : '',
        created: milestone.created ? milestone.created : Date.now(),
        date: milestone.date ? milestone.date : Date.now(),
        done: milestone.done ? milestone.done : false,
        assigneesCapacityDates: milestone.assigneesCapacityDates ? milestone.assigneesCapacityDates : {},
        doneDate: milestone.doneDate ? milestone.doneDate : Date.now(),
        hasStar: milestone.hasStar ? milestone.hasStar : '#FFFFFF',
        ownerId: milestone.ownerId ? milestone.ownerId : ALL_USERS,
    }
}

function mapTaskData(taskId, task) {
    const extendedName = task.extendedName ? task.extendedName : task.name ? task.name : ''
    const hasStar = !task.hasStar ? '#FFFFFF' : task.hasStar === true ? '#C7E3FF' : task.hasStar

    return {
        id: task.id ? task.id : taskId,
        done: task.done ? task.done : false,
        inDone: task.inDone ? task.inDone : false,
        name: getTaskNameWithoutMeta(extendedName),
        extendedName,
        description: task.description ? task.description : '',
        userId: task.userId ? task.userId : '',
        userIds: task.userIds ? task.userIds : [task.userId],
        currentReviewerId: task.currentReviewerId ? task.currentReviewerId : task.userId,
        observersIds: task.observersIds ? task.observersIds : [],
        dueDateByObserversIds: task.dueDateByObserversIds ? task.dueDateByObserversIds : {},
        estimationsByObserverIds: task.estimationsByObserverIds ? task.estimationsByObserverIds : {},
        stepHistory: task.stepHistory ? task.stepHistory : [],
        hasStar: hasStar,
        created: task.created ? task.created : Date.now(),
        creatorId: task.creatorId ? task.creatorId : '',
        dueDate: task.dueDate ? task.dueDate : Date.now(),
        completed: task.completed ? task.completed : null,
        isPrivate: task.isPrivate ? task.isPrivate : false,
        isPublicFor: task.isPublicFor ? task.isPublicFor : [FEED_PUBLIC_FOR_ALL, task.userId],
        parentId: task.parentId ? task.parentId : null,
        isSubtask: task.isSubtask ? task.isSubtask : false,
        subtaskIds: task.subtaskIds ? task.subtaskIds : [],
        subtaskNames: task.subtaskNames ? task.subtaskNames : [],
        recurrence: task.recurrence ? task.recurrence : RECURRENCE_NEVER,
        lastEditorId: task.lastEditorId ? task.lastEditorId : '',
        lastEditionDate: task.lastEditionDate ? task.lastEditionDate : Date.now(),
        linkBack: task.linkBack ? task.linkBack : '',
        estimations: task.estimations ? task.estimations : { [OPEN_STEP]: ESTIMATION_0_MIN },
        comments: task.comments ? task.comments : [],
        genericData: task.genericData ? task.genericData : null,
        sortIndex: task.sortIndex ? task.sortIndex : generateNegativeSortIndex(),
        linkedParentNotesIds: task.linkedParentNotesIds ? task.linkedParentNotesIds : [],
        linkedParentTasksIds: task.linkedParentTasksIds ? task.linkedParentTasksIds : [],
        linkedParentContactsIds: task.linkedParentContactsIds ? task.linkedParentContactsIds : [],
        linkedParentProjectsIds: task.linkedParentProjectsIds ? task.linkedParentProjectsIds : [],
        linkedParentGoalsIds: task.linkedParentGoalsIds ? task.linkedParentGoalsIds : [],
        linkedParentSkillsIds: task.linkedParentSkillsIds ? task.linkedParentSkillsIds : [],
        linkedParentAssistantIds: task.linkedParentAssistantIds ? task.linkedParentAssistantIds : [],
        parentDone: task.parentDone ? task.parentDone : false,
        suggestedBy: task.suggestedBy ? task.suggestedBy : null,
        parentGoalId: task.parentGoalId ? task.parentGoalId : null,
        parentGoalIsPublicFor: task.parentGoalIsPublicFor ? task.parentGoalIsPublicFor : null,
        noteId: task.noteId ? task.noteId : null,
        containerNotesIds: task.containerNotesIds ? task.containerNotesIds : [],
        calendarData: task.calendarData ? task.calendarData : null,
        gmailData: task.gmailData ? task.gmailData : null,
        timesPostponed: task.timesPostponed ? task.timesPostponed : 0,
        timesFollowed: task.timesFollowed ? task.timesFollowed : 0,
        timesDoneInExpectedDay: task.timesDoneInExpectedDay ? task.timesDoneInExpectedDay : 0,
        timesDone: task.timesDone ? task.timesDone : 0,
        isPremium: task.isPremium ? task.isPremium : false,
        lockKey: task.lockKey ? task.lockKey : '',
        assigneeType: task.assigneeType ? task.assigneeType : TASK_ASSIGNEE_USER_TYPE,
        assistantId: task.assistantId ? task.assistantId : '',
        commentsData: task.commentsData ? task.commentsData : null,
        autoEstimation: task.autoEstimation === false || task.autoEstimation === true ? task.autoEstimation : null,
        completedTime: task.completedTime ? task.completedTime : null,
    }
}

function mapProjectData(projectId, project, customData) {
    return {
        id: projectId,
        color: project.color ? project.color : PROJECT_COLOR_DEFAULT,
        created: project.created ? project.created : null,
        creatorId: project.creatorId ? project.creatorId : '',
        name: project.name ? project.name : '',
        description: project.description ? project.description : '',
        assistantId: project.assistantId ? project.assistantId : '',
        projectStartDate: project.projectStartDate ? project.projectStartDate : null,
        userIds: project.userIds ? project.userIds : [],
        isPrivate: project.isPrivate ? project.isPrivate : false,
        isShared: project.isShared ? project.isShared : PROJECT_PUBLIC,
        estimationType: project.estimationType ? project.estimationType : ESTIMATION_TYPE_TIME,
        lastActionDate: project.lastActionDate ? project.lastActionDate : moment().valueOf(),
        monthlyXp: project.monthlyXp ? project.monthlyXp : 0,
        monthlyTraffic: project.monthlyTraffic ? project.monthlyTraffic : 0,
        isTemplate: project.isTemplate || false,
        templateCreatorId: project.templateCreatorId ? project.templateCreatorId : '',
        guideProjectIds: project.guideProjectIds ? project.guideProjectIds : [],
        parentTemplateId: project.parentTemplateId ? project.parentTemplateId : '',
        activeFullSearch: project.activeFullSearch ? project.activeFullSearch : null,
        hourlyRatesData: project.hourlyRatesData ? project.hourlyRatesData : { currency: 'EUR', hourlyRates: {} },
        lastChatActionDate: project.lastChatActionDate
            ? project.lastChatActionDate
            : moment().subtract(30, 'year').valueOf(),
        usersData: project.usersData ? project.usersData : {},
        workstreamIds: project.workstreamIds ? project.workstreamIds : [],
        globalAssistantIds: project.globalAssistantIds ? project.globalAssistantIds : [],
        lastLoggedUserDate: project.lastLoggedUserDate
            ? project.lastLoggedUserDate
            : moment().subtract(1, 'year').valueOf(),
        active: project.active ? project.active : false,
        lastActionDate: project.lastActionDate ? project.lastActionDate : Date.now(),
        autoEstimation: project.autoEstimation === false ? false : true,
        sortIndexByUser: project.sortIndexByUser ? project.sortIndexByUser : {},
        ...customData,
    }
}

module.exports = { mapContactData, mapGoalData, mapNoteData, mapMilestoneData, mapTaskData, mapProjectData }
