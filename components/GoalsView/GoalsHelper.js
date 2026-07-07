import moment from 'moment'

import { colors } from '../styles/global'
import store from '../../redux/store'
import { DEFAULT_WORKSTREAM_ID, isWorkstream, WORKSTREAM_ID_PREFIX } from '../Workstreams/WorkstreamHelper'
import TasksHelper, { BACKLOG_DATE_NUMERIC } from '../TaskListView/Utils/TasksHelper'
import { FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import { sortBy } from 'lodash'
import { ALL_GOALS_ID } from '../AllSections/allSectionHelper'
import {
    setBoardGoalsByMilestoneInProject,
    setBoardMilestonesInProject,
    setBoardNeedShowMoreInProject,
    setDoneGoalsAmount,
    setOpenGoalsAmount,
} from '../../redux/actions'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import {
    GOAL_MILESTONES_MODE_LINEAR,
    GOAL_SCHEDULE_MODE_DYNAMIC,
    GOAL_SCHEDULE_MODE_FIXED,
    MILESTONE_TYPE_LINEAR,
    MILESTONE_TYPE_FIXED,
    getLinearMilestonePeriods,
    normalizeGoalMilestonesConfig,
    normalizeGoalScheduleMode,
    normalizeMilestoneType,
} from '../../utils/GoalMilestonesHelper'
import { shouldShowMilestoneWithoutGoals } from './GoalsBoardMilestonesHelper'

export {
    GOAL_MILESTONES_MODE_MANUAL,
    GOAL_MILESTONES_MODE_LINEAR,
    GOAL_MILESTONES_CADENCE_WEEKLY,
    GOAL_MILESTONES_CADENCE_BIWEEKLY,
    GOAL_MILESTONES_CADENCE_MONTHLY,
    GOAL_MILESTONES_CADENCE_QUARTERLY,
    GOAL_SCHEDULE_MODE_FIXED,
    GOAL_SCHEDULE_MODE_DYNAMIC,
    MILESTONE_TYPE_FIXED,
    MILESTONE_TYPE_LINEAR,
    DEFAULT_FUTURE_LINEAR_MILESTONES_TO_CREATE,
    normalizeGoalMilestonesConfig,
    normalizeGoalScheduleMode,
    normalizeMilestoneType,
    isLinearGoalMilestonesConfig,
    getCurrentTimezone,
    getLinearMilestonePeriod,
    getLinearMilestonePeriods,
    getLinearMilestoneTitle,
} from '../../utils/GoalMilestonesHelper'

export const BACKLOG_MILESTONE_ID = 'BACKLOG'
export const GOALS_OPEN_TAB_INDEX = 0
export const GOALS_DONE_TAB_INDEX = 1
export const DROPPABLE_SEPARATOR = '#SPACE#'
export const ONE_DAY_MILLISECONDS = 86400000
export const DYNAMIC_PERCENT = 'DYNAMIC_PERCENT'
export const ALL_USERS = 'ALL_USERS'

export const GOAL_OPEN_TASKS_EXPANDED_FIRST_DAY = 'GOAL_OPEN_TASKS_EXPANDED_FIRST_DAY'
export const GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS = 'GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS'
export const GOAL_OPEN_TASKS_EXPANDED_SOMEDAY = 'GOAL_OPEN_TASKS_EXPANDED_SOMEDAY'
export const BASE_NUMBER_OF_MILESTONES_TO_SHOW_ALL_PROJECTS = 1
export const BASE_NUMBER_OF_MILESTONES_TO_SHOW_SELECTED_PROJECT = 3

export const dynamicData = {
    circleBorderColor: colors.UtilityViolet300,
    circleBackgroundColor: colors.UtilityViolet200,
    text: 'Dynamically based on tasks',
    percent: DYNAMIC_PERCENT,
    barColor: colors.UtilityViolet125,
    progressBorderColor: colors.UtilityViolet150,
    progressTextColor: colors.UtilityViolet300,
    shortcutKey: 'D',
    progressBorderColorInMentionModal: colors.UtilityViolet150,
    progressTextColorInMentionModal: colors.UtilityViolet200,
}

export const progressData = [
    {
        circleBorderColor: colors.Gray500,
        circleBackgroundColor: colors.Grey400,
        text: '0% Not started yet',
        percent: 0,
        barColor: 'transparent',
        progressBorderColor: colors.Grey400,
        progressTextColor: colors.Text03,
        shortcutKey: '0',
        progressBorderColorInMentionModal: colors.Text03,
        progressTextColorInMentionModal: colors.Text03,
    },
    {
        circleBorderColor: colors.UtilityBlue300,
        circleBackgroundColor: colors.UtilityBlue200,
        text: '~20% Getting started',
        percent: 20,
        barColor: '#ECC2FF',
        progressBorderColor: colors.UtilityBlue150,
        progressTextColor: colors.UtilityBlue300,
        shortcutKey: '1',
        progressBorderColorInMentionModal: colors.UtilityBlue150,
        progressTextColorInMentionModal: colors.UtilityBlue200,
    },
    {
        circleBorderColor: colors.UtilityBlue300,
        circleBackgroundColor: colors.UtilityBlue200,
        text: '~40% Some good progress',
        percent: 40,
        barColor: '#D4C2FF',
        progressBorderColor: colors.UtilityBlue150,
        progressTextColor: colors.UtilityBlue300,
        shortcutKey: '2',
        progressBorderColorInMentionModal: colors.UtilityBlue150,
        progressTextColorInMentionModal: colors.UtilityBlue200,
    },
    {
        circleBorderColor: colors.UtilityBlue300,
        circleBackgroundColor: colors.UtilityBlue200,
        text: '~60% Getting there',
        percent: 60,
        barColor: '#C2C8FF',
        progressBorderColor: colors.UtilityBlue150,
        progressTextColor: colors.UtilityBlue300,
        shortcutKey: '3',
        progressBorderColorInMentionModal: colors.UtilityBlue150,
        progressTextColorInMentionModal: colors.UtilityBlue200,
    },
    {
        circleBorderColor: colors.UtilityBlue300,
        circleBackgroundColor: colors.UtilityBlue200,
        text: '~80% Almost there',
        percent: 80,
        barColor: colors.UtilityBlue125,
        progressBorderColor: colors.UtilityBlue150,
        progressTextColor: colors.UtilityBlue300,
        shortcutKey: '4',
        progressBorderColorInMentionModal: colors.UtilityBlue150,
        progressTextColorInMentionModal: colors.UtilityBlue200,
    },
    {
        circleBorderColor: colors.Green300,
        circleBackgroundColor: colors.UtilityGreen200,
        text: '100% All done',
        percent: 100,
        barColor: colors.Green125,
        progressBorderColor: colors.UtilityGreen150,
        progressTextColor: colors.Green300,
        shortcutKey: '5',
        progressBorderColorInMentionModal: colors.UtilityGreen150,
        progressTextColorInMentionModal: colors.Green300,
    },
]

export const progressMap = {
    0: progressData[0],
    20: progressData[1],
    40: progressData[2],
    60: progressData[3],
    80: progressData[4],
    100: progressData[5],
    [DYNAMIC_PERCENT]: dynamicData,
}

export const CAPACITY_AUTOMATIC = 'CAPACITY_AUTOMATIC'
export const CAPACITY_NONE = 'CAPACITY_NONE'

const CAPACITY_XXS = 'XXS'
const CAPACITY_XS = 'XS'
const CAPACITY_S = 'S'
const CAPACITY_M = 'M'
const CAPACITY_L = 'L'
const CAPACITY_XL = 'XL'
const CAPACITY_XXL = 'XXL'

export const capacityData = [
    {
        key: CAPACITY_AUTOMATIC,
        description: 'Automatic',
        optionText: 'Automatic',
        capacityValue: '',
        shortcutKey: 'A',
        days: 0,
    },
    {
        key: CAPACITY_NONE,
        description: 'No estimation',
        optionText: 'N/A',
        capacityValue: '0',
        shortcutKey: '0',
        days: 0,
    },
    {
        key: CAPACITY_XXS,
        description: '<1 Day',
        optionText: 'XXS',
        capacityValue: 'XXS',
        shortcutKey: '1',
        days: 1,
    },
    {
        key: CAPACITY_XS,
        description: '<2 Days',
        optionText: 'XS',
        capacityValue: 'XS',
        shortcutKey: '2',
        days: 2,
    },
    {
        key: CAPACITY_S,
        description: '~3-4 Days',
        optionText: 'S',
        capacityValue: 'S',
        shortcutKey: '3',
        days: 3.5,
    },
    {
        key: CAPACITY_M,
        description: '~1 Week',
        optionText: 'M',
        capacityValue: 'M',
        shortcutKey: '4',
        days: 7,
    },
    {
        key: CAPACITY_L,
        description: '~2 Weeks',
        optionText: 'L',
        capacityValue: 'L',
        shortcutKey: '5',
        days: 14,
    },
    {
        key: CAPACITY_XL,
        description: '~1 Month',
        optionText: 'XL',
        capacityValue: 'XL',
        shortcutKey: '6',
        days: 30,
    },
    {
        key: CAPACITY_XXL,
        description: '~3 Months',
        optionText: 'XXL',
        capacityValue: 'XXL',
        shortcutKey: '7',
        days: 90,
    },
]

export const capacityDataMap = {
    [CAPACITY_AUTOMATIC]: capacityData[0],
    [CAPACITY_NONE]: capacityData[1],
    [CAPACITY_XXS]: capacityData[2],
    [CAPACITY_XS]: capacityData[3],
    [CAPACITY_S]: capacityData[4],
    [CAPACITY_M]: capacityData[5],
    [CAPACITY_L]: capacityData[6],
    [CAPACITY_XL]: capacityData[7],
    [CAPACITY_XXL]: capacityData[8],
}

export const getNewDefaultGoal = milestoneDate => {
    const { loggedUser, currentUser } = store.getState()
    const assigeeId = currentUser.uid === ALL_GOALS_ID ? loggedUser.uid : currentUser.uid
    const goal = {
        name: '',
        extendedName: '',
        created: Date.now(),
        creatorId: loggedUser.uid,
        progress: DYNAMIC_PERCENT,
        assigneesIds: [assigeeId],
        assigneesCapacity: { [assigeeId]: CAPACITY_NONE },
        assigneesReminderDate: { [assigeeId]: Date.now() },
        lastEditionDate: Date.now(),
        lastEditorId: loggedUser.uid,
        hasStar: '#FFFFFF',
        description: '',
        startingMilestoneDate: milestoneDate,
        completionMilestoneDate: milestoneDate,
        parentDoneMilestoneIds: [],
        progressByDoneMilestone: {},
        isPublicFor: [FEED_PUBLIC_FOR_ALL],
        dateByDoneMilestone: {},
        sortIndexByMilestone: {},
        noteId: null,
        dynamicProgress: 0,
        ownerId: ALL_USERS,
        isPremium: false,
        lockKey: '',
        assistantId: '',
        commentsData: null,
        scheduleMode: GOAL_SCHEDULE_MODE_FIXED,
    }
    return goal
}

// When a project runs on automatic (linear) milestones, new goals created from the quick
// "add task line" inline creator and the add-goal popup should default to a *dynamic* goal
// anchored to the active linear milestone — mirroring the goals board "add into milestone"
// flow. A dynamic goal parked at the backlog date would not match any milestone bucket (the
// backlog bucket only surfaces fixed goals), so we anchor it to the current linear period.
export const getNewGoalScheduleDefaults = projectId => {
    const project = ProjectHelper.getProjectById(projectId)
    const config = normalizeGoalMilestonesConfig(project?.goalMilestonesConfig)
    if (config.mode !== GOAL_MILESTONES_MODE_LINEAR) {
        return { isDynamic: false, scheduleMode: GOAL_SCHEDULE_MODE_FIXED, milestoneDate: null }
    }
    const [activePeriod] = getLinearMilestonePeriods(config, Date.now(), 1)
    return {
        isDynamic: true,
        scheduleMode: GOAL_SCHEDULE_MODE_DYNAMIC,
        milestoneDate: activePeriod ? activePeriod.date : BACKLOG_DATE_NUMERIC,
    }
}

export const getNewDefaultGoalMilestone = () => {
    const milestone = {
        extendedName: '',
        created: Date.now(),
        date: moment().startOf('day').hour(12).minute(0).valueOf(),
        done: false,
        assigneesCapacityDates: {},
        doneDate: Date.now(),
        hasStar: '#FFFFFF',
        ownerId: ALL_USERS,
        milestoneType: MILESTONE_TYPE_FIXED,
        periodStartDate: null,
        periodEndDate: null,
        periodKey: '',
        cadence: '',
    }
    return milestone
}

export const getPositiveDaysDifference = (firstTimestamp, secondTimestamp) => {
    const firstDate = moment(firstTimestamp).startOf('day')
    const secondDate = moment(secondTimestamp).startOf('day')
    const dateMillisecondsDifference =
        firstTimestamp > secondTimestamp ? firstDate.diff(secondDate) : secondDate.diff(firstDate)
    const daysDifference = Math.floor(dateMillisecondsDifference / ONE_DAY_MILLISECONDS)
    return daysDifference
}

export const getCustomRoundRemainder = daysRemainderPercent => {
    if (daysRemainderPercent === 0) {
        return 0
    }

    const negativeNumber = daysRemainderPercent < 0
    const neutralRemainderPercent = negativeNumber ? -1 * daysRemainderPercent : daysRemainderPercent
    let daysRemainderRoundedPercent
    if (neutralRemainderPercent <= 0.25) {
        daysRemainderRoundedPercent = 0.25
    } else if (neutralRemainderPercent <= 0.5) {
        daysRemainderRoundedPercent = 0.5
    } else if (neutralRemainderPercent <= 0.75) {
        daysRemainderRoundedPercent = 0.75
    } else {
        daysRemainderRoundedPercent = 1
    }
    return negativeNumber ? -1 * daysRemainderRoundedPercent : daysRemainderRoundedPercent
}

export const getRelativeDateBy12Hours = (timestamp, raw = false) => {
    let mntDate = moment(timestamp).add(12, 'hour')
    return raw ? mntDate.valueOf() : mntDate
}

export const calculateAutomaticCapacity = timestamp => {
    const todayDate = getRelativeDateBy12Hours(Date.now())
    const todayTimestampStartOfDay = todayDate.valueOf()
    const isPositiveCapacity = timestamp > todayTimestampStartOfDay

    if (isPositiveCapacity) {
        const millisecondsDifference = timestamp - todayTimestampStartOfDay
        const daysDifference = Math.floor(millisecondsDifference / ONE_DAY_MILLISECONDS)
        const daysRemainder = millisecondsDifference % ONE_DAY_MILLISECONDS
        const daysRemainderPercent = daysRemainder / ONE_DAY_MILLISECONDS
        const daysRemainderRoundedPercent = getCustomRoundRemainder(daysRemainderPercent)
        const automaticCapacity = daysDifference + daysRemainderRoundedPercent
        return automaticCapacity
    }

    return 0
}

export const getGoalsAndAssigneesId = (goals, isOpenMilestone) => {
    const goalsByAssigneeId = {}
    goals.forEach(goal => {
        const { assigneesIds } = goal
        if (isOpenMilestone) {
            assigneesIds.forEach(assigneeId => {
                goalsByAssigneeId[assigneeId]
                    ? goalsByAssigneeId[assigneeId].push(goal)
                    : (goalsByAssigneeId[assigneeId] = [goal])
            })
        }
    })

    return goalsByAssigneeId
}

export const checkIfAnyGoalsInMilestoneHasCapacity = (goalsByAssigneeId, assigneeId) => {
    const assigneeGoals = goalsByAssigneeId[assigneeId] ? goalsByAssigneeId[assigneeId] : []
    let thereIsCapacity = false
    assigneeGoals.forEach(goal => {
        const { assigneesCapacity } = goal
        const capacities = Object.values(assigneesCapacity)
        capacities.forEach(capacity => {
            if (capacity !== CAPACITY_AUTOMATIC && capacity !== CAPACITY_NONE) thereIsCapacity = true
        })
    })
    return thereIsCapacity
}

export const getMilestoneAssigneeCapacityDays = (
    goalsByAssigneeId,
    assigneesCapacityDates,
    automaticCapacity,
    assigneeId
) => {
    const assigneeGoals = goalsByAssigneeId[assigneeId] ? goalsByAssigneeId[assigneeId] : []
    let leftGlobalCapacity = 0
    assigneeGoals.forEach(goal => {
        const { progress, assigneesCapacity } = goal
        const assigneeCapacityKey = assigneesCapacity[assigneeId]
        const assigneeCapacityInDays = capacityDataMap[assigneeCapacityKey].days
        leftGlobalCapacity += ((100 - progress) / 100) * assigneeCapacityInDays
    })

    const assigneeCapacityDays = assigneesCapacityDates[assigneeId]

    let capacityValue =
        !assigneeCapacityDays || assigneeCapacityDays === CAPACITY_AUTOMATIC
            ? automaticCapacity
            : (assigneeCapacityDays - Date.now()) / ONE_DAY_MILLISECONDS
    capacityValue = capacityValue < 0 ? 0 : capacityValue

    const leftMilestoneAssigneeCapacityDays = capacityValue - leftGlobalCapacity
    const integerPart =
        leftMilestoneAssigneeCapacityDays > 0
            ? Math.floor(leftMilestoneAssigneeCapacityDays)
            : Math.ceil(leftMilestoneAssigneeCapacityDays)
    const decimalPart =
        integerPart === 0 ? leftMilestoneAssigneeCapacityDays : leftMilestoneAssigneeCapacityDays % integerPart
    const milestoneAssigneeCapacityDays = integerPart + getCustomRoundRemainder(decimalPart)
    return milestoneAssigneeCapacityDays
}

export const updateMilestoneDotColor = (projectId, goals, milestone, automaticCapacity) => {
    const { assigneesCapacityDates } = milestone
    const goalsByAssigneeId = getGoalsAndAssigneesId(goals, !milestone.done)

    let atLeasteOneAssigneWith05OrLess = false
    let atLeasteOneAssigneWithLessThan0 = false

    const users = TasksHelper.getUsersInProject(projectId)

    users.forEach(assignee => {
        if (assignee) {
            const milestoneAssigneeCapacityDays = getMilestoneAssigneeCapacityDays(
                goalsByAssigneeId,
                assigneesCapacityDates,
                automaticCapacity,
                assignee.uid
            )

            if (milestoneAssigneeCapacityDays < 0) {
                atLeasteOneAssigneWithLessThan0 = true
            } else if (milestoneAssigneeCapacityDays <= 0.5) {
                atLeasteOneAssigneWith05OrLess = true
            }
        }
    })

    let capacityButtonBackgroundColor = '#09D693'
    if (atLeasteOneAssigneWithLessThan0) {
        capacityButtonBackgroundColor = colors.Red200
    } else if (atLeasteOneAssigneWith05OrLess) {
        capacityButtonBackgroundColor = colors.UtilityYellow200
    }

    return capacityButtonBackgroundColor
}

export const filterGoalsByAssignee = (goals, currentUserId, milestoneId, assigneesIdsToShow) => {
    const goalsByAssignee = {}
    const goalsAssignedToCurrentUser = []
    let goalsByAssigneeArray

    if (currentUserId === ALL_GOALS_ID) {
        goalsByAssignee[currentUserId] = goals
        goalsByAssigneeArray = Object.entries(goalsByAssignee)
    } else {
        for (let i = 0; i < goals.length; i++) {
            const goal = goals[i]
            const { assigneesIds } = goal

            for (let n = 0; n < assigneesIds.length; n++) {
                const assigneeId = assigneesIds[n]
                if (assigneeId === currentUserId) {
                    goalsAssignedToCurrentUser.push(goal)
                } else if (assigneesIdsToShow.includes(assigneeId)) {
                    if (!goalsByAssignee[assigneeId]) goalsByAssignee[assigneeId] = []
                    goalsByAssignee[assigneeId].push(goal)
                }
            }
        }

        goalsByAssigneeArray = [[currentUserId, goalsAssignedToCurrentUser], ...Object.entries(goalsByAssignee)]
    }

    goalsByAssigneeArray.forEach(goalsByAssignee => {
        const goals = goalsByAssignee[1]
        goalsByAssignee[1] = sortBy(goals, [
            goal => goal.sortIndexByMilestone && goal.sortIndexByMilestone[milestoneId],
        ]).reverse()
    })

    return goalsByAssigneeArray
}

export const getAssigneesIdsToShowInBoard = (currentUserId, userWorkstreamsIdsInProject, projectId) => {
    if (isWorkstream(currentUserId)) return [currentUserId]

    if (currentUserId === ALL_GOALS_ID) {
        const { projectWorkstreams, projectUsers, projectContacts } = store.getState()
        return [
            ...projectWorkstreams[projectId].map(item => item.uid),
            ...projectUsers[projectId].map(item => item.uid),
            ...projectContacts[projectId].map(item => item.uid),
        ]
    }

    const userWorkstreamIds = userWorkstreamsIdsInProject
        ? [...userWorkstreamsIdsInProject, DEFAULT_WORKSTREAM_ID]
        : [DEFAULT_WORKSTREAM_ID]

    return [currentUserId, ...userWorkstreamIds]
}

export function isPrivateGoal(goal, customUserId) {
    const { loggedUser } = store.getState()
    const userId = customUserId ? customUserId : loggedUser.uid
    return (
        !goal ||
        loggedUser.isAnonymous ||
        (goal.isPublicFor && !goal.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) && !goal.isPublicFor.includes(userId))
    )
}

const filterGoalsInMilestone = (goalsToShowAmount, milestone, goals, assigneesIdsToShow, inDone) => {
    const candidateGoals = []
    const { date: milestoneDate, id: milestoneId } = milestone
    const milestoneType = normalizeMilestoneType(milestone.milestoneType)
    const scheduleModeForMilestone =
        milestoneType === MILESTONE_TYPE_LINEAR ? GOAL_SCHEDULE_MODE_DYNAMIC : GOAL_SCHEDULE_MODE_FIXED

    for (let i = 0; i < goals.length; i++) {
        const goal = goals[i]
        const {
            completionMilestoneDate,
            startingMilestoneDate,
            assigneesIds,
            parentDoneMilestoneIds,
            progress,
            dynamicProgress,
        } = goal

        const goalScheduleMode = normalizeGoalScheduleMode(goal.scheduleMode)
        const belongsToMilestone = inDone
            ? parentDoneMilestoneIds.includes(milestoneId)
            : completionMilestoneDate >= milestoneDate &&
              startingMilestoneDate <= milestoneDate &&
              (milestoneDate !== BACKLOG_DATE_NUMERIC || progress !== 100)
        const belongsToMilestoneType = inDone || goalScheduleMode === scheduleModeForMilestone
        const belongsToAnAssigneeToShow = assigneesIds.some(assigneeId => assigneesIdsToShow.includes(assigneeId))

        if (belongsToMilestone && belongsToMilestoneType && belongsToAnAssigneeToShow) {
            candidateGoals.push(goal)
        }
    }

    const sortedGoals = sortBy(candidateGoals, [
        goal => goal.sortIndexByMilestone && goal.sortIndexByMilestone[milestoneId],
    ]).reverse()

    if (goalsToShowAmount && goalsToShowAmount > 0) {
        return sortedGoals.slice(0, goalsToShowAmount)
    }
    return sortedGoals
}

const processMilestonesAndGoalsToCountAndShow = (
    inAllProjects,
    numberGoalsAllTeams,
    projectId,
    milestonesToShow,
    inDone,
    goals,
    assigneesIdsToShow
) => {
    const { goalsShowMoreExpanded } = store.getState()

    const BASE_NUMBER_OF_MILESTONES_TO_SHOW = inAllProjects
        ? BASE_NUMBER_OF_MILESTONES_TO_SHOW_ALL_PROJECTS
        : BASE_NUMBER_OF_MILESTONES_TO_SHOW_SELECTED_PROJECT

    // In automatic (linear) milestones mode we always surface the active milestone plus the next
    // configured future milestones even when they are still empty, so the user has buckets to plan into.
    // The backend already caps the number of open linear milestones to active + futureMilestonesToCreate,
    // so we can show them all without an explicit client-side limit and without collapsing them away.
    const project = ProjectHelper.getProjectById(projectId)
    const milestonesConfig = normalizeGoalMilestonesConfig(project?.goalMilestonesConfig)
    const isAutomaticMode = !inAllProjects && !inDone && milestonesConfig.mode === GOAL_MILESTONES_MODE_LINEAR

    const backlogId = `${BACKLOG_MILESTONE_ID}${projectId}`

    const finalMilestonesToShow = inDone
        ? milestonesToShow
        : [...milestonesToShow, { date: BACKLOG_DATE_NUMERIC, id: backlogId }]

    let goalsToShowAmount = inAllProjects && numberGoalsAllTeams ? numberGoalsAllTeams : null
    const numberMilestonesToShow = goalsShowMoreExpanded || isAutomaticMode ? null : BASE_NUMBER_OF_MILESTONES_TO_SHOW

    let boardNeedShowMore = false
    const alreadyCountedGoals = {}
    const boardGoalsByMilestones = {}
    const boardMilestones = []
    const goalsAmount = { open: 0, done: 0 }

    for (let i = 0; i < finalMilestonesToShow.length; i++) {
        const stopAddingMilestonesAndGoals =
            (numberMilestonesToShow && boardMilestones.length === numberMilestonesToShow) || goalsToShowAmount === 0

        const milestone = finalMilestonesToShow[i]
        const { id } = milestone
        const milestoneGoals = filterGoalsInMilestone(goalsToShowAmount, milestone, goals, assigneesIdsToShow, inDone)

        // Keep the active milestone visible just like the Tasks board, even when no goal currently matches it,
        // both in the selected project and in All Projects.
        // Automatic linear milestones remain visible as planning buckets as well.
        const showMilestoneWithoutGoals =
            milestoneGoals.length === 0 &&
            shouldShowMilestoneWithoutGoals({
                inAllProjects,
                inDone,
                milestoneIndex: i,
                isAutomaticMode,
                isLinearMilestone: normalizeMilestoneType(milestone.milestoneType) === MILESTONE_TYPE_LINEAR,
                isBacklog: id === backlogId,
            })

        if (stopAddingMilestonesAndGoals) {
            if (id === backlogId || milestoneGoals.length > 0) {
                boardNeedShowMore = true
                break
            }
        } else {
            if ((!inAllProjects && id === backlogId) || milestoneGoals.length > 0 || showMilestoneWithoutGoals) {
                milestoneGoals.forEach(goal => {
                    if (!alreadyCountedGoals[goal.id]) {
                        alreadyCountedGoals[goal.id] = goal
                        inDone ? goalsAmount.done++ : goalsAmount.open++
                        if (goalsToShowAmount) goalsToShowAmount--
                    }
                })
                boardMilestones.push(milestone)
                boardGoalsByMilestones[milestone.id] = milestoneGoals
            }
        }
    }

    if (!isAutomaticMode && goalsShowMoreExpanded && BASE_NUMBER_OF_MILESTONES_TO_SHOW < boardMilestones.length)
        boardNeedShowMore = true

    return { boardGoalsByMilestones, boardNeedShowMore, boardMilestones, goalsAmount }
}

const processMilestonesAndGoalsToOnlyCount = (
    inAllProjects,
    numberGoalsAllTeams,
    projectId,
    miletonesToCount,
    inDone,
    goals,
    assigneesIdsToShow,
    goalsAmount
) => {
    const BASE_NUMBER_OF_MILESTONES_TO_SHOW = inAllProjects
        ? BASE_NUMBER_OF_MILESTONES_TO_SHOW_ALL_PROJECTS
        : BASE_NUMBER_OF_MILESTONES_TO_SHOW_SELECTED_PROJECT

    let goalsToShowAmount = inAllProjects && numberGoalsAllTeams ? numberGoalsAllTeams : null

    const finalMilestonesToCount = inDone
        ? [...miletonesToCount, { date: BACKLOG_DATE_NUMERIC, id: `${BACKLOG_MILESTONE_ID}${projectId}` }]
        : miletonesToCount

    let milestonesAmount = 0
    const alreadyCountedGoals = {}
    for (let i = 0; i < finalMilestonesToCount.length; i++) {
        const milestone = finalMilestonesToCount[i]
        const { id } = milestone
        const milestoneGoals = filterGoalsInMilestone(goalsToShowAmount, milestone, goals, assigneesIdsToShow, !inDone)
        if (milestoneGoals.length > 0) {
            milestoneGoals.forEach(goal => {
                if (!alreadyCountedGoals[goal.id]) {
                    alreadyCountedGoals[goal.id] = goal
                    inDone ? goalsAmount.open++ : goalsAmount.done++
                    if (goalsToShowAmount) goalsToShowAmount--
                }
            })
            milestonesAmount++
        }
        if (milestonesAmount === BASE_NUMBER_OF_MILESTONES_TO_SHOW || goalsToShowAmount === 0) break
    }
}

const getMilestonesAndGoalsFiltered = (
    inAllProjects,
    numberGoalsAllTeams,
    projectId,
    milestonesToShow,
    miletonesToCount,
    inDone,
    goals,
    assigneesIdsToShow
) => {
    const {
        boardGoalsByMilestones,
        boardNeedShowMore,
        boardMilestones,
        goalsAmount,
    } = processMilestonesAndGoalsToCountAndShow(
        inAllProjects,
        numberGoalsAllTeams,
        projectId,
        milestonesToShow,
        inDone,
        goals,
        assigneesIdsToShow
    )

    processMilestonesAndGoalsToOnlyCount(
        inAllProjects,
        numberGoalsAllTeams,
        projectId,
        miletonesToCount,
        inDone,
        goals,
        assigneesIdsToShow,
        goalsAmount
    )

    return { boardMilestones, boardGoalsByMilestones, goalsAmount, boardNeedShowMore }
}

export const filterMilestonesAndGoalsInCurrentUser = (
    inAllProjects,
    numberGoalsAllTeams,
    projectId,
    openMilestones,
    doneMilestones,
    goals
) => {
    const { currentUser, goalsActiveTab } = store.getState()

    const assigneesIdsToShow = getAssigneesIdsToShowInBoard(
        currentUser.uid,
        currentUser.workstreams ? currentUser.workstreams[projectId] : null,
        projectId
    )

    const { boardMilestones, boardGoalsByMilestones, goalsAmount, boardNeedShowMore } =
        goalsActiveTab === GOALS_OPEN_TAB_INDEX
            ? getMilestonesAndGoalsFiltered(
                  inAllProjects,
                  numberGoalsAllTeams,
                  projectId,
                  openMilestones,
                  doneMilestones,
                  false,
                  goals,
                  assigneesIdsToShow
              )
            : getMilestonesAndGoalsFiltered(
                  inAllProjects,
                  numberGoalsAllTeams,
                  projectId,
                  doneMilestones,
                  openMilestones,
                  true,
                  goals,
                  assigneesIdsToShow
              )

    store.dispatch([
        setBoardMilestonesInProject(projectId, boardMilestones),
        setBoardGoalsByMilestoneInProject(projectId, boardGoalsByMilestones),
        setBoardNeedShowMoreInProject(projectId, boardNeedShowMore),
        setOpenGoalsAmount(projectId, goalsAmount.open),
        setDoneGoalsAmount(projectId, goalsAmount.done),
    ])
}

export const getOwnerId = (projectId, assigeeId) => {
    const { loggedUser } = store.getState()
    const isGuide = !!ProjectHelper.getProjectById(projectId)?.parentTemplateId
    return isGuide ? (assigeeId === ALL_GOALS_ID ? loggedUser.uid : assigeeId) : ALL_USERS
}
