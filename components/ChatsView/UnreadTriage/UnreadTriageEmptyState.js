import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { isTagFilterEmptyEverywhere, useUnreadTriage } from './UnreadTriageContext'

/**
 * All Projects > Chats > Unread with a tag selected that matches nothing in any project. The
 * project sections hide themselves when the tag leaves them empty (AT-3112), so without this the
 * page would be blank under the filter line. `projectIds` are the projects that have unread chats.
 */
export default function UnreadTriageEmptyState({ projectIds }) {
    const triage = useUnreadTriage()
    if (!isTagFilterEmptyEverywhere(triage, projectIds)) return null

    return (
        <View style={localStyles.container} testID="unread-tag-empty">
            <Text style={localStyles.text}>{translate('Nothing unread with this tag')}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        paddingVertical: 32,
    },
    text: {
        ...styles.body1,
        color: colors.Text03,
        textAlign: 'center',
    },
})
