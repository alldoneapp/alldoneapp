import moment from 'moment'

import { translate } from '../../../i18n/TranslationService'
import {
    DESTINATION_SOMEDAY,
    MILESTONE_OVERDUE,
    MILESTONE_UPCOMING,
    RULE_DO_LATER,
    RULE_FOCUS,
    RULE_GOAL,
    RULE_MILESTONE_AT_RISK,
    RULE_NO_ROOM,
    RULE_RANKED,
    RULE_YOU,
    RULE_YOUR_MUST,
    RULE_YOUR_PRIORITY,
    TIER_COULD,
    TIER_MUST,
    TIER_SHOULD,
    formatPlanDuration,
    getDestinationDate,
    isMilestoneImminent,
} from '../../../utils/dailyPlan/dailyPlanModel'
import { getTaskPriorityLabel } from '../../../utils/TaskPriority'

export const TIER_LABEL_KEYS = {
    [TIER_MUST]: 'Must do',
    [TIER_SHOULD]: 'Should do',
    [TIER_COULD]: 'Could do',
}

export const TIER_SHORT_KEYS = {
    [TIER_MUST]: 'dailyPlan tier short must',
    [TIER_SHOULD]: 'dailyPlan tier short should',
    [TIER_COULD]: 'dailyPlan tier short could',
}

/** "Thu 26 Nov" (with the year when it is not this year). */
export const formatPlanDate = (date, nowMs = Date.now()) => {
    const value = moment(date)
    return value.format(value.year() === moment(nowMs).year() ? 'ddd D MMM' : 'ddd D MMM YYYY')
}

/** "Milestone Thu 26 Nov" / "Milestone Thu 26 Nov overdue" for an active goal milestone, else ''. */
export const getMilestoneText = (candidate, nowMs = Date.now()) => {
    const milestone = candidate.milestone
    if (!milestone || (milestone.status !== MILESTONE_UPCOMING && milestone.status !== MILESTONE_OVERDUE)) return ''
    return translate(
        milestone.status === MILESTONE_OVERDUE ? 'dailyPlan milestone overdue' : 'dailyPlan milestone date',
        { date: formatPlanDate(milestone.date, nowMs) }
    )
}

/**
 * The visible explanation of a milestone at risk: when it is, how much goal work is due, how much of
 * it today needs, and that it was planned ahead of the project order.
 */
export const getMilestoneRiskText = (row, nowMs = Date.now()) => {
    const { candidate, detail } = row
    const milestone = getMilestoneText(candidate, nowMs)
    if (!detail) return milestone
    return translate('dailyPlan reason milestone at risk', {
        milestone,
        days: detail.workdaysLeft,
        share: formatPlanDuration(detail.shareMinutes),
        effort: formatPlanDuration(detail.effortMinutes),
    })
}

/** Why the row is where it is, in one short line. */
export const getRowReason = (row, nowMs = Date.now()) => {
    const { candidate } = row
    switch (row.rule) {
        case RULE_YOUR_MUST:
            return translate('dailyPlan reason your must')
        case RULE_FOCUS:
            return translate('dailyPlan reason focus')
        case RULE_YOUR_PRIORITY:
            return translate('dailyPlan reason your priority', {
                priority: translate(getTaskPriorityLabel(candidate.priority)),
            })
        case RULE_MILESTONE_AT_RISK:
            return `${getMilestoneRiskText(row, nowMs)} · ${translate('dailyPlan reason ahead of project order')}`
        case RULE_GOAL: {
            const milestone = getMilestoneText(candidate, nowMs)
            return milestone
                ? translate('dailyPlan reason goal milestone', { milestone })
                : translate('dailyPlan reason goal')
        }
        case RULE_RANKED:
            return translate('dailyPlan reason ranked')
        case RULE_DO_LATER:
            return translate('dailyPlan reason do later')
        case RULE_YOU:
            return translate('dailyPlan reason you')
        case RULE_NO_ROOM:
        default:
            return row.detail && isMilestoneImminent(candidate.milestone)
                ? translate('dailyPlan reason milestone no room', { reason: getMilestoneRiskText(row, nowMs) })
                : translate('dailyPlan reason no room')
    }
}

const DESTINATION_LABEL_KEYS = {
    '3d': 'dailyPlan destination 3d',
    '1w': 'dailyPlan destination 1w',
    '1m': 'dailyPlan destination 1m',
    '3m': 'dailyPlan destination 3m',
    '6m': 'dailyPlan destination 6m',
    '1y': 'dailyPlan destination 1y',
    [DESTINATION_SOMEDAY]: 'Someday',
}

export const getDestinationLabel = key => translate(DESTINATION_LABEL_KEYS[key] || 'Someday')

/** "Thu 26 Nov" (with the year when it is not this year); empty for Someday. */
export const getDestinationDateText = (key, nowMs = Date.now()) => {
    if (key === DESTINATION_SOMEDAY) return ''
    return formatPlanDate(getDestinationDate(key, nowMs), nowMs)
}
