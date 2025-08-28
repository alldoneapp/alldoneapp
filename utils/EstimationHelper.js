import moment from 'moment'
import ProjectHelper from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import { BACKLOG_DATE_STRING } from '../components/TaskListView/Utils/TasksHelper'
import { translate } from '../i18n/TranslationService'
import store from '../redux/store'
import { getDateFormat } from '../components/UIComponents/FloatModals/DateFormatPickerModal'

export const ESTIMATION_TYPE_POINTS = 'POINTS'
export const ESTIMATION_TYPE_TIME = 'TIME'
export const ESTIMATION_TYPE_BOTH = 'POINTS_AND_TIME'

export const TIME_TEXT_DEFAULT = 'TEXT_DEFAULT'
export const TIME_TEXT_DEFAULT_SHORT = 'TEXT_DEFAULT_SHORT'
export const TIME_MINI = 'MINI'
export const TIME_MINI_SHORT = 'MINI_SHORT'
export const TIME_TEXT_DEFAULT_MINI = 'TEXT_DEFAULT_MINI'
export const TIME_HOURS = 'HOURS'
export const TIME_HOURS_MINI = 'HOURS_MINI'
export const TIME_MAX_TO_HOURS = 'TIME_MAX_TO_HOURS'

// Estimations are defined in MINUTES
export const ESTIMATION_0_MIN = 0
export const ESTIMATION_15_MIN = 15
export const ESTIMATION_30_MIN = 30
export const ESTIMATION_1_HOUR = 60
export const ESTIMATION_2_HOURS = 120
export const ESTIMATION_4_HOURS = 240
export const ESTIMATION_8_HOURS = 480
export const ESTIMATION_16_HOURS = 960

export const ESTIMATION_DATA = {
    [ESTIMATION_0_MIN]: {},
    [ESTIMATION_15_MIN]: {},
    [ESTIMATION_30_MIN]: {},
    [ESTIMATION_1_HOUR]: {},
    [ESTIMATION_2_HOURS]: {},
    [ESTIMATION_4_HOURS]: {},
    [ESTIMATION_8_HOURS]: {},
    [ESTIMATION_16_HOURS]: {},
}

export const ESTIMATION_OPTIONS = [
    ESTIMATION_0_MIN,
    ESTIMATION_15_MIN,
    ESTIMATION_30_MIN,
    ESTIMATION_1_HOUR,
    ESTIMATION_2_HOURS,
    ESTIMATION_4_HOURS,
    ESTIMATION_8_HOURS,
    ESTIMATION_16_HOURS,
]

export const ESTIMATION_TIME_OPTIONS_ICONS = {
    [ESTIMATION_0_MIN]: '0',
    [ESTIMATION_15_MIN]: '15m',
    [ESTIMATION_30_MIN]: '30m',
    [ESTIMATION_1_HOUR]: '1h',
    [ESTIMATION_2_HOURS]: '2h',
    [ESTIMATION_4_HOURS]: '4h',
    [ESTIMATION_8_HOURS]: '8h',
    [ESTIMATION_16_HOURS]: '16h',
}

export const ESTIMATION_POINTS_OPTIONS_ICONS = {
    [ESTIMATION_0_MIN]: 0,
    [ESTIMATION_15_MIN]: 1,
    [ESTIMATION_30_MIN]: 2,
    [ESTIMATION_1_HOUR]: 3,
    [ESTIMATION_2_HOURS]: 5,
    [ESTIMATION_4_HOURS]: 8,
    [ESTIMATION_8_HOURS]: 13,
    [ESTIMATION_16_HOURS]: 21,
}

export const ESTIMATION_TIME_OPTIONS_TEXTS = {
    [ESTIMATION_0_MIN]: 'no estimation',
    [ESTIMATION_15_MIN]: '15 minutes',
    [ESTIMATION_30_MIN]: '30 minutes',
    [ESTIMATION_1_HOUR]: '1 hour',
    [ESTIMATION_2_HOURS]: '2 hours',
    [ESTIMATION_4_HOURS]: '4 hours',
    [ESTIMATION_8_HOURS]: '8 hours',
    [ESTIMATION_16_HOURS]: '16 hours',
}

export const ESTIMATION_POINTS_OPTIONS_TEXTS = {
    [ESTIMATION_0_MIN]: '< 10 minutes',
    [ESTIMATION_15_MIN]: '~ 15 minutes',
    [ESTIMATION_30_MIN]: '~ 30 minutes',
    [ESTIMATION_1_HOUR]: '~ 1 hour',
    [ESTIMATION_2_HOURS]: '~ 2 hours',
    [ESTIMATION_4_HOURS]: '~ half a day',
    [ESTIMATION_8_HOURS]: '~ 1 day',
    [ESTIMATION_16_HOURS]: '~ 2 days',
}

export const ESTIMATION_OPTIONS_SHORTCUTS = {
    [ESTIMATION_0_MIN]: '0',
    [ESTIMATION_15_MIN]: '1',
    [ESTIMATION_30_MIN]: '2',
    [ESTIMATION_1_HOUR]: '3',
    [ESTIMATION_2_HOURS]: '4',
    [ESTIMATION_4_HOURS]: '5',
    [ESTIMATION_8_HOURS]: '6',
    [ESTIMATION_16_HOURS]: '7',
}

export const ESTIMATION_POINTS_VALUES = {
    [ESTIMATION_0_MIN]: 0,
    [ESTIMATION_15_MIN]: 1,
    [ESTIMATION_30_MIN]: 2,
    [ESTIMATION_1_HOUR]: 3,
    [ESTIMATION_2_HOURS]: 5,
    [ESTIMATION_4_HOURS]: 8,
    [ESTIMATION_8_HOURS]: 13,
    [ESTIMATION_16_HOURS]: 21,
}

export const getEstimationIcons = projectId => {
    const project = ProjectHelper.getProjectById(projectId)
    return project.estimationType === ESTIMATION_TYPE_TIME
        ? ESTIMATION_TIME_OPTIONS_ICONS
        : ESTIMATION_POINTS_OPTIONS_ICONS
}

export const getEstimationIconByValue = (projectId, estimation) => {
    if (ESTIMATION_OPTIONS.includes(estimation)) {
        const estimationIcons = getEstimationIcons(projectId)
        return estimationIcons[estimation]
    } else {
        return 'c'
    }
}

export const getEstimationText = projectId => {
    const project = ProjectHelper.getProjectById(projectId)
    return project.estimationType === ESTIMATION_TYPE_TIME
        ? ESTIMATION_TIME_OPTIONS_TEXTS
        : ESTIMATION_POINTS_OPTIONS_TEXTS
}

export const getEstimationTagText = (projectId, estimation) => {
    const project = ProjectHelper.getProjectById(projectId)

    if (project.estimationType === ESTIMATION_TYPE_POINTS) {
        return estimation <= 1 ? 'Point' : 'Points'
    } else {
        switch (estimation) {
            case ESTIMATION_0_MIN:
                return 'No estimation'
            case ESTIMATION_15_MIN:
                return 'Minutes'
            case ESTIMATION_30_MIN:
                return 'Minutes'
            case ESTIMATION_1_HOUR:
                return 'Hour'
            case ESTIMATION_2_HOURS:
                return 'Hours'
            case ESTIMATION_4_HOURS:
                return 'Hours'
            case ESTIMATION_8_HOURS:
                return 'Hours'
            case ESTIMATION_16_HOURS:
                return 'Hours'
            default:
                return 'Custom'
        }
    }
}

/**
 * Get Estimation value by:
 *      Pints: Points values
 *      Time: In minutes
 * @param projectId
 * @param estimation
 * @param customEstimationType
 * @returns {string|*}
 */
export const getEstimationRealValue = (projectId, estimation, customEstimationType) => {
    let estimationType = ''

    if (customEstimationType) {
        estimationType = customEstimationType
    } else if (projectId) {
        const project = ProjectHelper.getProjectById(projectId)
        estimationType = project.estimationType
    } else {
        estimationType = ESTIMATION_TYPE_TIME
    }

    return getEstimationTypeRealValue(estimation, estimationType)
}

export const getEstimationTypeRealValue = (estimation, estimationType) => {
    if (estimationType === ESTIMATION_TYPE_TIME) {
        return estimation
    } else {
        // Estimation value in DB is Predefined in ESTIMATION_OPTIONS
        if (ESTIMATION_OPTIONS.includes(estimation)) {
            return ESTIMATION_POINTS_VALUES[estimation]
        } else {
            // If Estimation value is Custom, then we need to approximate
            switch (true) {
                case estimation <= 11: // less than 11m
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_0_MIN]
                case 11 < estimation && estimation <= 22: // between 11m & 22m
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_15_MIN]
                case 22 < estimation && estimation <= 45: // between 22m & 45m
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_30_MIN]
                case 45 < estimation && estimation <= 90: // between 45m & 1h30m
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_1_HOUR]
                case 90 < estimation && estimation <= 180: // between 1h30m & 3h
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_2_HOURS]
                case 180 < estimation && estimation <= 360: // between 3h & 6h
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_4_HOURS]
                case 360 < estimation && estimation <= 720: // between 6h & 12h
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_8_HOURS]
                case 720 < estimation && estimation <= 1200: // between 12h & 20h
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_16_HOURS]
                case 1200 < estimation: // more than 20h
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_4_HOURS]
            }
        }
    }
}

export const getEstimationResume = (projectId, estimation) => {
    if (projectId) {
        const project = ProjectHelper.getProjectById(projectId)
        return getEstimationTypeResume(estimation, project.estimationType)
    } else {
        return getEstimationTypeResume(estimation, ESTIMATION_TYPE_TIME)
    }
}

export const getEstimationTypeResume = (estimation, estimationType) => {
    if (estimationType === ESTIMATION_TYPE_POINTS) {
        return { value: estimation, text: estimation <= 1 ? 'Point' : 'Points', hours: 0 }
    } else {
        // default for less than an hour
        let resume = estimation
        let text = 'Minutes'
        let hours = estimation < 60 ? 0 : parseFloat((estimation / 60).toFixed(1))

        // "estimation" value is in MINUTES

        // Use parseFloat because toFixed returns a string
        switch (true) {
            case estimation === 60: // 1 hour
                resume = 1
                text = 'Hour'
                break
            case 60 < estimation && estimation < 480: // 8 hours
                resume = parseFloat((estimation / 60).toFixed(2))
                text = 'Hours'
                break
            case estimation === 480: // 1 day
                resume = 1
                text = 'Day'
                break
            case 480 < estimation && estimation < 10560: // between 1 day & 1 month (1 day === 8 hours) (1 month === 22 days)
                resume = parseFloat((estimation / 480).toFixed(2))
                text = 'Days'
                break
            case estimation === 10560: // 1 month
                resume = 1
                text = 'Month'
                break
            case 10560 < estimation && estimation < 126720: // between 1 month & 1 year (1 year === 12 months)
                resume = parseFloat((estimation / 10560).toFixed(2))
                text = 'Months'
                break
            case estimation === 126720: // 1 year
                resume = 1
                text = 'Year'
                break
            case 126720 < estimation: // more than 1 year
                resume = parseFloat((estimation / 126720).toFixed(2))
                text = 'Years'
                break
        }

        return { value: resume, text: text, hours: hours }
    }
}

export const convertMinutesInHours = minutes => {
    return minutes / 60
}

export const getDoneTimeValue = (estimation, template = TIME_TEXT_DEFAULT) => {
    const estimationResume = getEstimationTypeResume(estimation, ESTIMATION_TYPE_TIME)
    const hours = estimationResume.hours > 0 ? ` (${estimationResume.hours} ${translate('hours')})` : ''
    const hoursMini = estimationResume.hours > 0 ? ` (${estimationResume.hours}${translate('Initial of Hours')})` : ''

    let finalText = ''
    switch (template) {
        case TIME_TEXT_DEFAULT:
            finalText = `${estimationResume.value} ${translate(estimationResume.text)}${hours}`
            break
        case TIME_TEXT_DEFAULT_SHORT:
            finalText = `${estimationResume.value} ${translate(`Initial of ${estimationResume.text}`)}`
            break
        case TIME_MINI:
            finalText = `${estimationResume.value}${translate(estimationResume.text)}${hoursMini}`.toLowerCase()
            break
        case TIME_MINI_SHORT:
            finalText = `${estimationResume.value}${translate(`Initial of ${estimationResume.text}`).toLowerCase()}`
            break
        case TIME_TEXT_DEFAULT_MINI:
            finalText = `${estimationResume.value}${translate(
                `Initial of ${estimationResume.text}`
            )}${hoursMini}`.toLowerCase()
            break
        case TIME_HOURS:
            finalText = `${estimationResume.hours} ${translate('hours')}`
            break
        case TIME_HOURS_MINI:
            finalText = `${estimationResume.hours}${translate('Initial of Hours')}`.toLowerCase()
            break
        case TIME_MAX_TO_HOURS:
            finalText = `${estimationResume.hours > 1 ? estimationResume.hours : estimationResume.value} ${translate(
                estimationResume.hours > 1 ? 'hours' : estimationResume.text
            )}`
            break
        default:
            finalText = `${estimationResume.value} ${translate(estimationResume.text)}${hours}`
            break
    }

    return finalText
}

export const getEstimationTypeByProjectId = projectId => {
    const project = ProjectHelper.getProjectById(projectId)
    return project?.estimationType || ESTIMATION_TYPE_TIME
}

export const getEstimationTypeToUse = projectId => {
    if (projectId) {
        return getEstimationTypeByProjectId(projectId)
    } else {
        const { loggedUserProjects } = store.getState()
        let type = false
        for (let project of loggedUserProjects) {
            if (!type && project.estimationType === ESTIMATION_TYPE_TIME) type = ESTIMATION_TYPE_TIME
            if (!type && project.estimationType === ESTIMATION_TYPE_POINTS) type = ESTIMATION_TYPE_POINTS
            if (
                (type === ESTIMATION_TYPE_TIME && project.estimationType === ESTIMATION_TYPE_POINTS) ||
                (type === ESTIMATION_TYPE_POINTS && project.estimationType === ESTIMATION_TYPE_TIME)
            ) {
                type = ESTIMATION_TYPE_BOTH
                break
            }
        }

        return type
    }
}

export const getListOfProjectsByEstimationType = () => {
    const { loggedUserProjects } = store.getState()

    const projectsByEstimationType = {
        [ESTIMATION_TYPE_TIME]: [],
        [ESTIMATION_TYPE_POINTS]: [],
    }

    for (let project of loggedUserProjects) {
        if (project.estimationType === ESTIMATION_TYPE_TIME) {
            projectsByEstimationType[ESTIMATION_TYPE_TIME].push(project)
        } else {
            projectsByEstimationType[ESTIMATION_TYPE_POINTS].push(project)
        }
    }

    return projectsByEstimationType
}

export const generateDateHeaderText = (projectId, upperCaseDateText, dayName, estimation, amountTasks) => {
    const inBacklog = upperCaseDateText === BACKLOG_DATE_STRING

    let text
    if (inBacklog) {
        text = translate('Someday')
    } else {
        text = `${upperCaseDateText} • ${dayName}`
        if (estimation > 0) {
            const estimationResume = getEstimationResume(projectId, estimation)
            const value = estimationResume.hours > 0 ? estimationResume.hours : estimationResume.value
            const valueType = estimationResume.hours > 0 ? 'Hours' : estimationResume.text
            text += ` • ${value} ${translate(valueType).toUpperCase()}`
        }
        if (amountTasks > 0) text += ` • ${amountTasks} ${translate(amountTasks > 1 ? 'tasks' : 'task').toUpperCase()}`
    }
    return text
}

export const generateDateHeaderTextInMyDaySection = (dateFormated, projectIds, estimations, amountTasks) => {
    const todayDate = moment()
    const todayFormated = todayDate.format('YYYYMMDD')
    const isTodayDate = dateFormated === todayFormated

    const date = isTodayDate ? todayDate : moment(dateFormated, 'YYYYMMDD')

    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

    const dayName = weekdays[date.isoWeekday() - 1]
    const dateText = isTodayDate ? translate('TODAY') : date.format(getDateFormat())

    let headerText = `${dateText} • ${translate(dayName)}`

    let time = 0
    let points = 0

    projectIds.forEach((projectId, index) => {
        const { estimationType } = ProjectHelper.getProjectById(projectId)
        estimationType === ESTIMATION_TYPE_POINTS ? (points += estimations[index]) : (time += estimations[index])
    })

    const updateEstimationText = (estimation, estimationType) => {
        const estimationResume = getEstimationTypeResume(estimation, estimationType)
        const { value, text, hours } = estimationResume
        const convertedValue = getEstimationTypeRealValue(hours >= 1 ? hours : value, estimationType)
        headerText += ` • ${convertedValue} ${hours >= 1 ? 'hours' : text}`
    }

    if (time > 0) updateEstimationText(time, ESTIMATION_TYPE_TIME)
    if (points > 0) headerText += ` • ${points} ${translate('points')}`
    if (amountTasks > 0) headerText += ` • ${amountTasks} ${translate(amountTasks > 1 ? 'tasks' : 'task')}`

    return headerText.toUpperCase()
}
