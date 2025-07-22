import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import moment from 'moment'

import { getDateFormat, getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { getUserPresentationDataInProject } from '../ContactsView/Utils/ContactsHelper'

export default function LastEditionData({ note, projectId }) {
    const [editorName, setEditorName] = useState('')

    const { lastEditionDate, views, lastEditorId } = note

    const parseDate = date => {
        if (Date.now() - date < 60) return 'Just now'
        return `Edited: ${moment(date).format(`${getTimeFormat(true)} of ${getDateFormat()}`)}`
    }

    useEffect(() => {
        const { displayName } = getUserPresentationDataInProject(projectId, lastEditorId)
        setEditorName(displayName)
    }, [projectId, lastEditorId])

    return (
        <View style={localStyles.dateAndSubHint}>
            <Text style={[styles.caption2, localStyles.subHintText]}>
                {`${parseDate(lastEditionDate)} • ${editorName} • ${views} views`}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    dateAndSubHint: {
        flex: 1,
        marginLeft: 36,
        maxHeight: 20,
        paddingBottom: 6,
        flexDirection: 'row',
        alignItems: 'flex-start',
        overflow: 'hidden',
    },
    subHintText: {
        color: colors.Text03,
        alignItems: 'flex-start',
    },
})
