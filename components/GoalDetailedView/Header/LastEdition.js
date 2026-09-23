import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'
import useLastEditDate from '../../../hooks/useLastEditDate'
import { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function LastEdition({ goal, projectId }) {
    const tablet = useSelector(state => state.isMiddleScreen)
    const { lastEditionDate, lastEditorId } = goal
    const editionText = useLastEditDate(lastEditionDate)

    const { shortName, displayName } = getUserPresentationDataInProject(projectId, lastEditorId)

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.lastEdited}>
                {tablet
                    ? `${translate('edited')} ${editionText}\n ${translate('by')} ${shortName}`
                    : `${translate('last edited')} ${editionText}\n ${translate('by')} ${displayName}`}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        justifyContent: 'flex-end',
    },
    lastEdited: {
        ...styles.body3,
        position: 'relative',
        top: -2,
        color: colors.Text03,
        marginRight: 8,
        lineHeight: 14,
        textAlign: 'right',
    },
})
