import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'

export default function TaskSummarizeTags({ amountTags, style, onPress }) {
    return (
        <TouchableOpacity onPress={onPress}>
            <View style={[localStyles.container, style]}>
                <Icon name={'tag'} size={16} color={colors.Text03} style={localStyles.icon} />
                <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{`${amountTags}`}</Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})
