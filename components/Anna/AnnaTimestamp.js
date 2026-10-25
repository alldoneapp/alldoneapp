import React from 'react'
import moment from 'moment'
import { useSelector } from 'react-redux'
import { getTimeFormatForDateFormat } from '../../utils/dateTimeFormats'

export default function AnnaTimestamp({ timestamp }) {
    const format = useSelector(state => getTimeFormatForDateFormat(state.dateFormat))
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime())) return null
    return <time dateTime={date.toISOString()}>{moment(date).format(format)}</time>
}
