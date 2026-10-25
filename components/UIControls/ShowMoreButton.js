import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'

export default function ShowMoreButton({ expanded, contract, expand, style, expandText, contractText, loading }) {
    // AT-2382 - while the ghosts are up the request is already in flight, so a second press
    // could only tear the listener down and restart the wait. Dimming rather than hiding
    // keeps the row height stable, which is the same no-layout-shift rule the ghosts follow.
    return (
        <View style={[localStyles.moreButton, style]}>
            <TouchableOpacity
                style={[localStyles.container, loading && localStyles.containerLoading]}
                onPress={expanded ? contract : expand}
                disabled={!!loading}
                accessibilityState={{ busy: !!loading, disabled: !!loading }}
            >
                {expandText || contractText ? (
                    <Text style={localStyles.text}>{translate(expanded ? contractText : expandText)}</Text>
                ) : (
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={24} color={colors.Text04} />
                )}
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        justifyContent: 'center',
    },
    containerLoading: {
        opacity: 0.5,
    },
    moreButton: {
        flex: 1,
        height: 24,
        flexDirection: 'row',
        justifyContent: 'center',
    },
    text: {
        ...styles.buttonLabel,
        fontFamily: 'Roboto-Regular',
        color: colors.Text03,
    },
})
