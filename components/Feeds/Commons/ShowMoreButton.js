import React from 'react'
import { StyleSheet } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'

import { colors } from '../../styles/global'
import Icon from '../../Icon'

export default function ShowMoreButton({ forExpand, onPress, style, loading }) {
    // AT-2382 - mirrors `UIControls/ShowMoreButton`'s loading treatment so the two
    // show-more buttons in the app behave the same while their ghosts are up: dimmed and
    // inert, but still occupying their 40px so nothing below them moves.
    return (
        <TouchableOpacity
            style={[localStyles.button, { marginBottom: forExpand ? 16 : 0 }, loading && localStyles.loading, style]}
            onPress={onPress}
            disabled={!!loading}
            accessibilityState={{ busy: !!loading, disabled: !!loading }}
        >
            <Icon name={forExpand ? 'chevron-down' : 'chevron-up'} size={24} color={colors.Text04} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        alignSelf: 'center',
        padding: 8,
        height: 40,
    },
    loading: {
        opacity: 0.5,
    },
})
