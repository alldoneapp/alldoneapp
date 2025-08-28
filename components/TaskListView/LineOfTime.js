import moment from 'moment'
import React, { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'

import { getPixelPerMinute } from '../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'

export default function LineOfTime({ time, tagsExpandedHeight }) {
    const [linePosition, setLinePosition] = useState(0)

    const updateLinePosition = () => {
        const INPUT_PADDING = 36
        const QUARTER_OF_HOUR = 15
        const MARGIN = 10
        const BORDER_HEIGHT = 1
        const LINE_HEIGHT = 2
        const EXTRA_SPACE = MARGIN + BORDER_HEIGHT + LINE_HEIGHT + tagsExpandedHeight

        const { startDate, endDate } = time
        const differenceTime = endDate.diff(startDate, 'minutes')

        const pixelPerMinute = getPixelPerMinute(differenceTime)

        const dateNow = moment()
        const progressTime = dateNow.isAfter(endDate)
            ? endDate.diff(startDate, 'minutes')
            : dateNow.diff(startDate, 'minutes')

        if (progressTime >= QUARTER_OF_HOUR) {
            setLinePosition(pixelPerMinute * progressTime + EXTRA_SPACE + INPUT_PADDING)
        }
    }

    useEffect(() => {
        updateLinePosition()

        const ONE_MINUTE = 60000
        const interval = setInterval(updateLinePosition, ONE_MINUTE)
        return () => {
            clearInterval(interval)
        }
    }, [time, tagsExpandedHeight])

    return <View style={[localStyles.container, { top: linePosition }]}></View>
}

const localStyles = StyleSheet.create({
    container: {
        height: 2,
        backgroundColor: 'red',
        flex: 1,
        marginHorizontal: 8,
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
    },
})
