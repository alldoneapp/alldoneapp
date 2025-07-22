import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../UIControls/Shortcut'

export default function OptionShortcutCaption({ text }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    return (
        <View style={{ marginLeft: 'auto' }}>
            {smallScreenNavigation ? (
                <Icon name={'chevron-right'} size={24} color={colors.Text03} />
            ) : (
                <Shortcut text={text} theme={SHORTCUT_LIGHT} />
            )}
        </View>
    )
}
