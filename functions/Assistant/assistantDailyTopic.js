// ChatPromptTemplate removed - using plain message arrays
const {
    interactWithChatStream,
    storeBotAnswerStream,
    getAssistantForChat,
    addBaseInstructions,
    getCommonData, // For parallel fetching to reduce time-to-first-token
} = require('./assistantHelper')
const { FEED_PUBLIC_FOR_ALL, getFirstName, sortProjects } = require('../Utils/HelperFunctionsCloud')
const { getUserData } = require('../Users/usersFirestore')

const MAX_TASKS_TO_SUMMARIZE = 50
const MAX_CHARACTER_IN_TASKS = 100

async function getUserNameAndProjectsToSummarize(admin, userId) {
    const promises = []
    promises.push(getUserData(userId))
    promises.push(admin.firestore().doc(`roles/administrator`).get())
    promises.push(
        admin
            .firestore()
            .collection(`projects`)
            .where('userIds', 'array-contains', userId)
            .where('isTemplate', '==', false)
            .get()
    )
    const [user, adminData, projectDocs] = await Promise.all(promises)

    const userIsAdministrator = adminData.data()?.userId === userId

    const { archivedProjectIds, displayName, defaultProjectId } = user

    const projects = []
    projectDocs.forEach(doc => {
        const project = doc.data()
        project.id = doc.id
        projects.push(project)
    })

    const sortedProjects = sortProjects(projects, userId)

    const activeProjects = []
    const guideProjects = []
    const archiveProjects = []

    sortedProjects.forEach(project => {
        const { parentTemplateId, creatorId } = project
        if (parentTemplateId) {
            if (!userIsAdministrator && creatorId !== userId) guideProjects.push(project)
        } else if (archivedProjectIds.includes(project.id)) {
            archiveProjects.push(project)
        } else {
            activeProjects.push(project)
        }
    })

    return {
        projects: [...activeProjects, ...guideProjects, ...archiveProjects],
        userName: getFirstName(displayName),
        defaultProjectId,
    }
}

async function getUserDoneTasksInProject(admin, projectId, userId, startDate, endDate) {
    const tasksDocs = await admin
        .firestore()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', userId)
        .where('done', '==', true)
        .where('parentId', '==', null)
        .where('genericData', '==', null)
        .where('gmailData', '==', null)
        .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, userId])
        .where('completed', '>=', startDate)
        .where('completed', '<=', endDate)
        .orderBy('completed', 'desc')
        .get()

    const tasks = []
    tasksDocs.forEach(doc => {
        const task = doc.data()
        task.id = doc.id
        task.name = task.name.substring(0, MAX_CHARACTER_IN_TASKS)
        tasks.push(task)
    })
    return tasks
}

async function getUserDoneTasksInProjects(admin, projects, userId, startDate, endDate) {
    const promises = []
    projects.forEach(project => {
        promises.push(getUserDoneTasksInProject(admin, project.id, userId, startDate, endDate))
    })
    const results = await Promise.all(promises)
    return results
}

function extractTasksToSummarizeByProject(projects, tasksByProjects) {
    const tasksByProjectsData = []
    let tasksSpace = MAX_TASKS_TO_SUMMARIZE
    for (let i = 0; i < projects.length; i++) {
        const projectId = projects[i].id
        const projectName = projects[i].name
        const tasksAmount = tasksByProjects[i].length
        const tasks = tasksByProjects[i].slice(0, tasksSpace)

        tasksSpace -= tasks.length
        if (tasks.length > 0) tasksByProjectsData.push({ projectId, projectName, tasks, tasksAmount })
        if (tasksSpace === 0) break
    }
    return tasksByProjectsData
}

function getTotalTasks(tasksByProjects) {
    let totalTasks = 0
    tasksByProjects.forEach(tasks => {
        totalTasks += tasks.length
    })
    return totalTasks
}

function generateDailySummaryContent(tasksByProjectsData, totalTasks, todayDate, lastSessionDate, userName) {
    let content = ''
    if (tasksByProjectsData.length === 0) {
        content = `The user's name is "${userName}". Introduce yourself and tell the user that you are a personal assistant happy to help with any question the user may have. Please tell me a fun historical fact based on what happened on the ${todayDate} at some point in history.`
    } else {
        content = `Act as an experienced & helpful coach encouraging the user while being on point and not talking too much.\n\nOn the ${lastSessionDate} the user has completed ${totalTasks} tasks.`
        tasksByProjectsData.forEach(data => {
            const { projectName, tasks, tasksAmount } = data
            content += `\n\nIn the project ${projectName} the user completed ${tasksAmount} tasks and those tasks were:`
            tasks.forEach(task => {
                content += `\n- ${task.name}`
            })
        })
        content += `\n\nAnswer in the following format:\nFirst a sentence about the new day and mention how many tasks have been done on the ${lastSessionDate}.\nThen summarize in max 3 bullet points per project what was done on the ${lastSessionDate} and tell for each project how many tasks the user did in this specific project. It is really important to use maximum 3 bullet points per project to summarize what was done.\nIn the end ask the user if there is anything you can do for him or her.`
    }
    return content
}

async function generateBotDailyTopicFirstComment(
    admin,
    userId,
    startDate,
    endDate,
    todayDate,
    lastSessionDate,
    objectId,
    userIdsToNotify,
    language,
    assistantId
) {
    const { projects, userName, defaultProjectId } = await getUserNameAndProjectsToSummarize(admin, userId)
    if (!defaultProjectId) return

    const promises = []
    promises.push(getAssistantForChat(defaultProjectId, assistantId))
    promises.push(getUserDoneTasksInProjects(admin, projects, userId, startDate, endDate))
    promises.push(getUserData(userId))
    const [assistant, tasksByProjects, user] = await Promise.all(promises)

    const { model, temperature, instructions, displayName, allowedTools } = assistant

    // Extract user's timezone offset (in minutes) from user data
    let userTimezoneOffset = null
    if (typeof user.timezone === 'number') {
        userTimezoneOffset = user.timezone
    } else if (typeof user.timezoneOffset === 'number') {
        userTimezoneOffset = user.timezoneOffset
    } else if (typeof user.timezoneMinutes === 'number') {
        userTimezoneOffset = user.timezoneMinutes
    } else if (typeof user.preferredTimezone === 'number') {
        userTimezoneOffset = user.preferredTimezone
    }

    const tasksByProjectsData = extractTasksToSummarizeByProject(projects, tasksByProjects)
    const totalTasks = getTotalTasks(tasksByProjects)

    const template = generateDailySummaryContent(tasksByProjectsData, totalTasks, todayDate, lastSessionDate, userName)

    const messages = []
    addBaseInstructions(messages, displayName, language, instructions, allowedTools, userTimezoneOffset)
    messages.push(['system', template])

    // Fetch common data in parallel with API call to reduce time-to-first-token
    const [stream, commonData] = await Promise.all([
        interactWithChatStream(messages, model, temperature, allowedTools),
        getCommonData(defaultProjectId, 'topics', objectId),
    ])

    console.log('KW Special storeBotAnswerStream parameters:', {
        projectId: defaultProjectId,
        objectType: 'topics',
        objectId,
        hasStream: !!stream,
        userIdsToNotify,
        isPublicFor: [FEED_PUBLIC_FOR_ALL],
        parser: null,
        assistantId: assistant.uid,
        followerIds: [userId],
        displayName,
        hasPreFetchedCommonData: !!commonData,
    })
    await storeBotAnswerStream(
        defaultProjectId,
        'topics',
        objectId,
        stream,
        userIdsToNotify,
        [FEED_PUBLIC_FOR_ALL],
        null,
        assistant.uid,
        [userId],
        displayName,
        null, // requestUserId - not available in this flow
        null, // userContext - not available in this flow
        messages, // conversationHistory
        model, // modelKey
        temperature, // temperatureKey
        allowedTools,
        commonData // Pass pre-fetched common data
    )
}

module.exports = {
    generateBotDailyTopicFirstComment,
}
