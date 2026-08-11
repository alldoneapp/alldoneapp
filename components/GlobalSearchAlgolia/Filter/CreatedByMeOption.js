import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import CheckBox from '../../CheckBox'
import { translate } from '../../../i18n/TranslationService'

export const CREATED_BY_ME_OPTION_LABEL = 'Only objects I created'
export const CREATED_BY_ME_OPTION_HINT = 'Hides objects created by other people'

// Row rendered inside the "Select search scope" modal. Toggling it deliberately
// does NOT close the modal: the creator filter is an independent dimension from
// the project scope, so the user can set both before going back to the search.
export default function CreatedByMeOption({ enabled, onToggle }) {
    return (
        <TouchableOpacity style={localStyles.container} onPress={onToggle} accessibilityRole="checkbox">
            <CheckBox
                externalContainerStyle={enabled ? { borderWidth: 1 } : { backgroundColor: 'transparent' }}
                checked={enabled}
            />
            <View style={localStyles.textContainer}>
                <Text style={localStyles.text}>{translate(CREATED_BY_ME_OPTION_LABEL)}</Text>
                <Text style={localStyles.hint}>{translate(CREATED_BY_ME_OPTION_HINT)}</Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 8,
        marginBottom: 4,
    },
    textContainer: {
        flexDirection: 'column',
        marginLeft: 8,
        flexShrink: 1,
    },
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    hint: {
        ...styles.body3,
        color: colors.Text03,
    },
})
