import moment from 'moment'

import { translate } from '../../../i18n/TranslationService'
import {
    DESTINATION_SOMEDAY,
    RULE_DO_LATER,
    RULE_FOCUS,
    RULE_GOAL,
    RULE_NO_ROOM,
    RULE_PROTECTED,
    RULE_RANKED,
    RULE_YOU,
    RULE_YOUR_MUST,
    RULE_YOUR_PRIORITY,
    TIER_COULD,
    TIER_MUST,
    TIER_SHOULD,
    getDestinationDate,
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

/** Why the row is where it is, in one short line. */
export const getRowReason = row => {
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
        case RULE_PROTECTED:
            return translate('dailyPlan reason protected', { count: candidate.timesPostponed })
        case RULE_GOAL:
            return translate('dailyPlan reason goal')
        case RULE_RANKED:
            return candidate.timesPostponed > 0
                ? translate('dailyPlan reason ranked postponed', { count: candidate.timesPostponed })
                : translate('dailyPlan reason ranked')
        case RULE_DO_LATER:
            return translate('dailyPlan reason do later')
        case RULE_YOU:
            return translate('dailyPlan reason you')
        case RULE_NO_ROOM:
        default:
            return candidate.protected
                ? translate('dailyPlan reason protected no room', { count: candidate.timesPostponed })
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
    const date = moment(getDestinationDate(key, nowMs))
    return date.format(date.year() === moment(nowMs).year() ? 'ddd D MMM' : 'ddd D MMM YYYY')
}
