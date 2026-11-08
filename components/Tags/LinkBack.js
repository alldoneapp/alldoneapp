import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors, windowTagStyle } from '../styles/global'
import NavigationService from '../../utils/NavigationService'
import URLTrigger from '../../URLSystem/URLTrigger'

export default function LinkBack({
    link,
    text,
    style,
    inTaskDetailedView,
    toComments,
    disabled,
    tagStyle,
    iconSize = 16,
}) {
    const openLink = async () => {
        if (inTaskDetailedView) {
            URLTrigger.processUrl(NavigationService, `/projects/projectId/tasks/taskId/properties`)
        }
        URLTrigger.processUrl(NavigationService, link)
    }

    const getCustomStyle = () => {
        return inTaskDetailedView ? { height: 32, paddingRight: 12 } : { height: 24, paddingRight: 8 }
    }

    return (
        <TouchableOpacity disabled={disabled} style={tagStyle}>
            <a
                style={{ textDecoration: 'none', minHeight: 24 }}
                href={link}
                target="_blank"
                onClick={e => {
                    e.stopPropagation()
                    e.preventDefault()
                    openLink()
                }}
            >
                <View style={[localStyles.urlTag, getCustomStyle()]}>
                    <Icon size={iconSize || 16} name="link" color={colors.Primary100} />
                    <Text
                        style={[
                            localStyles.urlText,
                            inTaskDetailedView && styles.title6,
                            style,
                            { color: colors.Primary100, marginRight: 8 },
                            !inTaskDetailedView && windowTagStyle(),
                        ]}
                    >
                        {text}
                    </Text>
                </View>
            </a>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    urlTag: {
        backgroundColor: '#D6EBFF',
        paddingLeft: 4,
        paddingRight: 8,
        borderRadius: 50,
        flexDirection: 'row',
        alignItems: 'center',
    },
    urlText: {
        ...styles.subtitle2,
        color: colors.Primary100,
        marginLeft: 4.65,
    },
})
