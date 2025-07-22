import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { HASHTAG_COLOR_MAPPING } from './HashtagsInteractionPopup'
import Icon from '../../../../Icon'

export default function ColorDot({ colorKey, selected = false, onPress }) {
    return (
        <TouchableOpacity
            style={[localStyles.container, { backgroundColor: HASHTAG_COLOR_MAPPING[colorKey].editDot }]}
            onPress={() => onPress(colorKey)}
            accessible={false}
        >
            {selected && <Icon name={'check'} color={'#ffffff'} size={16} />}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 20,
        height: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 50,
    },
})
