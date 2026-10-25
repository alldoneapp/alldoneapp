import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import moment from 'moment'
import { translate } from '../../i18n/TranslationService'

import { getDateFormat, getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { getUserPresentationDataInProject } from '../ContactsView/Utils/ContactsHelper'

export default function LastEditionData({ note, projectId, inCommentPopup }) {
    const [editorName, setEditorName] = useState('')

    const { lastEditionDate, views, lastEditorId } = note

    const parseDate = date => {
        if (Date.now() - date < 60000) return translate('Just now')
        return translate('Edited: Time on Date', {
            time: moment(date).format(getTimeFormat(true)),
            date: moment(date).format(getDateFormat()),
        })
    }

    useEffect(() => {
        const { displayName } = getUserPresentationDataInProject(projectId, lastEditorId)
        setEditorName(displayName)
    }, [projectId, lastEditorId])

    return (
        <View style={localStyles.dateAndSubHint}>
            <Text style={[styles.caption2, localStyles.subHintText, inCommentPopup && localStyles.textInCommentPopup]}>
                {`${parseDate(lastEditionDate)} • ${editorName} • ${views === 1 ? translate('1 view') : translate('Amount views', { amount: views })}`}
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
    textInCommentPopup: {
        color: colors.UtilityBlue125,
    },
})
