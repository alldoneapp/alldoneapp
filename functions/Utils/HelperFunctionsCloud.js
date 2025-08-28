const moment = require('moment')
const admin = require('firebase-admin')
const { defineString } = require('firebase-functions/params')

const { getUserData } = require('../Users/usersFirestore')
const { orderBy } = require('lodash')
const { getEnvFunctions } = require('../envFunctionsHelper')

const TASK_ASSIGNEE_USER_TYPE = 'USER'

const FORDWARD_COMMENT = 0
const BACKWARD_COMMENT = 1
const STAYWARD_COMMENT = 2

const PROJECT_COLOR_DEFAULT = '#47A3FF'
const OPEN_STEP = -1
const DONE_STEP = -2
const FEED_PUBLIC_FOR_ALL = 0
const MENTION_SPACE_CODE = 'M2mVOSjAVPPKweL'
const DEFAULT_WORKSTREAM_ID = 'ws@default'
const CAPACITY_NONE = 'CAPACITY_NONE'
const BACKLOG_DATE_NUMERIC = Number.MAX_SAFE_INTEGER
const CURRENT_DAY_VERSION_ID = '-1'
const REGEX_URL = /^https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9\u00a1-\uffff?@:%][a-zA-Z0-9-\u00a1-\uffff?@:%]+[a-zA-Z0-9\u00a1-\uffff?@:%]\.[^\s]{2,}|^www\.[a-zA-Z0-9\u00a1-\uffff?@:%][a-zA-Z0-9-\u00a1-\uffff?@:%]+[a-zA-Z0-9\u00a1-\uffff?@:%]\.[^\s]{2,}|^https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9\u00a1-\uffff?@:%]+\.[^\s]{2,}|^www\.[a-zA-Z0-9\u00a1-\uffff?@:%]+\.[^\s]{2,}|^http:\/\/localhost:[0-9]+\/[^\s]{2,}$/i
const REGEX_MENTION = /^(@[\S]+)$/i
const BACKLOG_MILESTONE_ID = 'BACKLOG'
const WORKSTREAM_ID_PREFIX = 'ws@'
const DATE_FORMAT_EUROPE = 'DD.MM.YYYY'
const ESTIMATION_TYPE_TIME = 'TIME'
const ESTIMATION_TYPE_POINTS = 'POINTS'
const DYNAMIC_PERCENT = 'DYNAMIC_PERCENT'
const ALL_USERS = 'ALL_USERS'

const PROJECT_PUBLIC = 0
const PROJECT_RESTRICTED = 1
const PROJECT_PRIVATE = 2

const TIME_TEXT_DEFAULT = 'TEXT_DEFAULT'
const TIME_TEXT_DEFAULT_SHORT = 'TEXT_DEFAULT_SHORT'
const TIME_MINI = 'MINI'
const TIME_MINI_SHORT = 'MINI_SHORT'
const TIME_TEXT_DEFAULT_MINI = 'TEXT_DEFAULT_MINI'
const TIME_HOURS = 'HOURS'
const TIME_HOURS_MINI = 'HOURS_MINI'

const ESTIMATION_0_MIN = 0
const ESTIMATION_15_MIN = 15
const ESTIMATION_30_MIN = 30
const ESTIMATION_1_HOUR = 60
const ESTIMATION_2_HOURS = 120
const ESTIMATION_4_HOURS = 240
const ESTIMATION_8_HOURS = 480
const ESTIMATION_16_HOURS = 960

const ESTIMATION_OPTIONS = [
    ESTIMATION_0_MIN,
    ESTIMATION_15_MIN,
    ESTIMATION_30_MIN,
    ESTIMATION_1_HOUR,
    ESTIMATION_2_HOURS,
    ESTIMATION_4_HOURS,
    ESTIMATION_8_HOURS,
    ESTIMATION_16_HOURS,
]

const ESTIMATION_POINTS_VALUES = {
    [ESTIMATION_0_MIN]: 0,
    [ESTIMATION_15_MIN]: 1,
    [ESTIMATION_30_MIN]: 2,
    [ESTIMATION_1_HOUR]: 3,
    [ESTIMATION_2_HOURS]: 5,
    [ESTIMATION_4_HOURS]: 8,
    [ESTIMATION_8_HOURS]: 13,
    [ESTIMATION_16_HOURS]: 21,
}

const RECURRENCE_NEVER = 'never'
const RECURRENCE_DAILY = 'daily'
const RECURRENCE_EVERY_WORKDAY = 'everyWorkday'
const RECURRENCE_WEEKLY = 'weekly'
const RECURRENCE_EVERY_2_WEEKS = 'every2Weeks'
const RECURRENCE_EVERY_3_WEEKS = 'every3Weeks'
const RECURRENCE_MONTHLY = 'monthly'
const RECURRENCE_EVERY_3_MONTHS = 'every3Months'
const RECURRENCE_EVERY_6_MONTHS = 'every6Months'
const RECURRENCE_ANNUALLY = 'annually'

const RECURRENCE_MAP = {
    [RECURRENCE_NEVER]: { short: '', large: 'Never', shortcut: '0' },
    [RECURRENCE_DAILY]: { short: 'D', large: 'Daily', shortcut: '1' },
    [RECURRENCE_EVERY_WORKDAY]: { short: 'Mo-Fr', large: 'Every workday (Mo-Fr)', shortcut: '2' },
    [RECURRENCE_WEEKLY]: { short: 'W', large: 'Weekly', shortcut: '3' },
    [RECURRENCE_EVERY_2_WEEKS]: { short: '2 W', large: 'Every 2 weeks', shortcut: '4' },
    [RECURRENCE_EVERY_3_WEEKS]: { short: '3 W', large: 'Every 3 weeks', shortcut: '5' },
    [RECURRENCE_MONTHLY]: { short: 'M', large: 'Monthly', shortcut: '6' },
    [RECURRENCE_EVERY_3_MONTHS]: { short: '3 M', large: 'Every 3 months', shortcut: '7' },
    [RECURRENCE_EVERY_6_MONTHS]: { short: '6 M', large: 'Every 6 months', shortcut: '8' },
    [RECURRENCE_ANNUALLY]: { short: 'A', large: 'Annually', shortcut: '9' },
}

const ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY = 'allProjects'

let sortKey = 0

function generateSortIndex() {
    let newSortKey = moment().valueOf()
    if (sortKey >= newSortKey) {
        newSortKey = sortKey + 1
    }
    sortKey = newSortKey
    return newSortKey
}

function generateNegativeSortIndex() {
    let newSortKey = moment().valueOf()
    if (sortKey >= newSortKey) {
        newSortKey = sortKey + 1
    }
    sortKey = newSortKey
    return -newSortKey
}

const getTaskNameWithoutMeta = (taskName, removeLineBreaks) => {
    const linealText = removeLineBreaks ? taskName.replace(/(\r\n|\n|\r)/gm, ' ') : taskName
    const words = (linealText == null ? '' : linealText).split(' ')
    for (let i = 0; i < words.length; i++) {
        if (words[i].startsWith('@')) {
            const parts = words[i].split('#')
            const regex = new RegExp(`${MENTION_SPACE_CODE}`, 'g')
            if (parts.length === 2 && parts[1].trim().length >= 0) {
                words[i] = parts[0].replace(regex, ' ')
            } else {
                words[i] = words[i].replace(regex, ' ')
            }
        }
    }
    return words.join(' ')
}

const recursiveDeleteHelper = async (firebase_tools, projectEnv, path) => {
    const { GOOGLE_FIREBASE_DEPLOY_TOKEN } = getEnvFunctions()

    await firebase_tools.firestore.delete(path, {
        project: projectEnv,
        recursive: true,
        yes: true,
        token: GOOGLE_FIREBASE_DEPLOY_TOKEN,
        force: true,
    })
}

const getFirstName = fullName => {
    return fullName ? fullName.replace('#', '').trim().split(' ')[0] : ''
}

const checkIfObjectIsLockedForUser = (projectId, lockKey, user) => {
    if (lockKey) {
        const { unlockedKeysByGuides } = user
        return (
            !unlockedKeysByGuides ||
            !unlockedKeysByGuides[projectId] ||
            !unlockedKeysByGuides[projectId].includes(lockKey)
        )
    }
    return false
}

const checkIfObjectIsLocked = async (projectId, lockKey, userId) => {
    if (lockKey) {
        const user = await getUserData(userId)
        if (user) {
            const { unlockedKeysByGuides } = user
            return (
                !unlockedKeysByGuides ||
                !unlockedKeysByGuides[projectId] ||
                !unlockedKeysByGuides[projectId].includes(lockKey)
            )
        }
    }
    return false
}

function divideArrayIntoSubgroups(array, subgroupSize) {
    const subgroups = []
    for (let i = 0; i < array.length; i += subgroupSize) {
        subgroups.push(array.slice(i, i + subgroupSize))
    }
    return subgroups
}

const isWorkstream = id => {
    return id.startsWith(WORKSTREAM_ID_PREFIX)
}

const sortProjects = (projects, userId) => {
    return orderBy(
        projects,
        [project => project.sortIndexByUser[userId], project => project.name.toLowerCase()],
        ['desc', 'asc']
    )
}

const inProductionEnvironment = () => {
    const currentEnvironment = defineString('CURRENT_ENVIORNMENT').value()
    return currentEnvironment === 'Production'
}

module.exports = {
    OPEN_STEP,
    DONE_STEP,
    FEED_PUBLIC_FOR_ALL,
    MENTION_SPACE_CODE,
    DEFAULT_WORKSTREAM_ID,
    CAPACITY_NONE,
    BACKLOG_DATE_NUMERIC,
    DYNAMIC_PERCENT,
    ALL_USERS,
    CURRENT_DAY_VERSION_ID,
    RECURRENCE_NEVER,
    REGEX_URL,
    REGEX_MENTION,
    BACKLOG_MILESTONE_ID,
    WORKSTREAM_ID_PREFIX,
    DATE_FORMAT_EUROPE,
    RECURRENCE_MAP,
    ESTIMATION_TYPE_TIME,
    TIME_TEXT_DEFAULT_MINI,
    ESTIMATION_TYPE_POINTS,
    TIME_TEXT_DEFAULT,
    TIME_TEXT_DEFAULT_SHORT,
    TIME_MINI,
    TIME_MINI_SHORT,
    TIME_HOURS,
    TIME_HOURS_MINI,
    ESTIMATION_OPTIONS,
    ESTIMATION_POINTS_VALUES,
    ESTIMATION_0_MIN,
    ESTIMATION_15_MIN,
    ESTIMATION_30_MIN,
    ESTIMATION_1_HOUR,
    ESTIMATION_2_HOURS,
    ESTIMATION_4_HOURS,
    ESTIMATION_8_HOURS,
    ESTIMATION_16_HOURS,
    PROJECT_COLOR_DEFAULT,
    TASK_ASSIGNEE_USER_TYPE,
    PROJECT_PUBLIC,
    PROJECT_RESTRICTED,
    PROJECT_PRIVATE,
    STAYWARD_COMMENT,
    ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY,
    generateSortIndex,
    generateNegativeSortIndex,
    getTaskNameWithoutMeta,
    getFirstName,
    recursiveDeleteHelper,
    checkIfObjectIsLocked,
    checkIfObjectIsLockedForUser,
    divideArrayIntoSubgroups,
    isWorkstream,
    sortProjects,
    inProductionEnvironment,
}
