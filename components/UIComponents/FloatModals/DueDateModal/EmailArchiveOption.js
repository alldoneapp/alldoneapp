import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import styles, { colors } from '../../../styles/global'
import CheckBox from '../../../CheckBox'
import { translate } from '../../../../i18n/TranslationService'

// AT-3164: the "Archive email in Gmail" option of the postpone dialog. The dialog decides whether
// it is shown (the linked email is still in the inbox) and archives only when a date is confirmed.
export default function EmailArchiveOption({ checked, onToggle }) {
    const label = translate('Archive email in Gmail')

    const onPress = event => {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        onToggle()
    }

    return (
        <TouchableOpacity
            testID={'postpone-archive-email-option'}
            onPress={onPress}
            style={localStyles.container}
            accessible={true}
            accessibilityRole={'checkbox'}
            accessibilityState={{ checked }}
            accessibilityLabel={label}
        >
            <CheckBox
                checked={checked}
                externalContainerStyle={checked ? { borderWidth: 1 } : { backgroundColor: 'transparent' }}
            />
            <Text style={localStyles.text}>{label}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Text03,
        marginLeft: 8,
    },
})
