import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'

export const CREATED_BY_ME_TAG_LABEL = 'Created by me'

// Shown next to the project ScopeTag while the creator filter is active, so the
// narrowed scope is visible from the search popup without reopening the modal.
export default function CreatedByMeTag() {
    return (
        <View style={localStyles.tag}>
            <Icon name="user" size={12} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate(CREATED_BY_ME_TAG_LABEL)}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey300,
        borderRadius: 12,
        paddingLeft: 6,
        paddingRight: 8,
        height: 24,
        marginTop: 8,
        marginLeft: 8,
    },
    icon: {
        marginRight: 4,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
})
