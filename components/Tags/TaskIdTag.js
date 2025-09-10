import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch } from 'react-redux'

import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../../utils/NavigationService'
import { getDvMainTabLink } from '../../utils/LinkingHelper'

export default function TaskIdTag({ taskId, projectId, humanReadableId, style, disabled, isMobile }) {
    const dispatch = useDispatch()

    const onPress = () => {
        if (!disabled && taskId && projectId) {
            const path = getDvMainTabLink(projectId, taskId, 'tasks')
            URLTrigger.processUrl(NavigationService, path)
        }
    }

    // Don't render if no human-readable ID is available
    if (!humanReadableId) {
        return null
    }

    return (
        <TouchableOpacity disabled={disabled} onPress={onPress}>
            <View style={[localStyles.container, isMobile && localStyles.containerMobile, style]}>
                <Icon name="hashtag" size={isMobile ? 12 : 14} color={colors.Text03} style={localStyles.icon} />
                <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{humanReadableId}</Text>
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
        paddingHorizontal: 6,
    },
    containerMobile: {
        minWidth: 24,
        height: 24,
        paddingHorizontal: 6,
    },
    icon: {
        marginRight: 4,
    },
    text: {
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 4,
        fontWeight: '600',
        fontSize: 11,
    },
})
