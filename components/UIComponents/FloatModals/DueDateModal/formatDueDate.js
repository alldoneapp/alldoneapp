import moment from 'moment'

export const formatDueDate = (date, now = moment()) => date.format(date.isSame(now, 'year') ? 'D MMM' : 'D MMM YYYY')
