import React from 'react'
import { View, StyleSheet } from 'react-native'

import Icon from '../../../../Icon'
import Shortcut from '../../../../UIControls/Shortcut'

export default function ShortcutContainer({ containerStyle, text, icon, shortcutStyle }) {
    return (
        <View style={[localStyles.container, containerStyle]}>
            <Shortcut
                text={icon ? <Icon name={icon} color={'#ffffff'} size={12} /> : text}
                containerStyle={shortcutStyle}
                custom={!!icon}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 0,
    },
})
