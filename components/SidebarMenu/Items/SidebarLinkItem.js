import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles from '../../styles/global'
import Icon from '../../Icon'
import { getUserItemTheme } from '../Themes'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../../hooks/UseOnHover'

// A project-wide view (Wiki, Chats) in the simple sidebar, where the project only lists its people.
// It is drawn like those rows rather than reusing the section header the full sidebar uses,
// because that one sits on the section background and would read as a separate block here.
export default function SidebarLinkItem({
    icon,
    text,
    highlight,
    onPress,
    projectColor,
    accessibilityLabel,
    nativeID,
}) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const { expanded } = useCollapsibleSidebar()

    const theme = getUserItemTheme(themeName)
    const { hover, onHover, offHover } = useOnHover(highlight, highlight)

    return (
        <TouchableOpacity onPress={onPress} accessibilityLabel={accessibilityLabel} nativeID={nativeID}>
            <View
                style={[
                    localStyles.container,
                    highlight ? theme.containerActive(projectColor) : theme.container(projectColor),
                    !expanded && localStyles.containerCollapsed,
                    !highlight && hover && theme.containerActive(projectColor),
                ]}
                onMouseEnter={onHover}
                onMouseLeave={offHover}
            >
                <Icon
                    size={20}
                    name={icon}
                    color={highlight ? theme.nameActive.color : theme.name.color}
                    style={localStyles.icon}
                />
                {expanded && (
                    <Text style={[localStyles.text, highlight ? theme.nameActive : theme.name]} numberOfLines={1}>
                        {text}
                    </Text>
                )}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        flexDirection: 'row',
        height: 48,
        paddingLeft: 26,
    },
    containerCollapsed: {
        paddingLeft: 18,
    },
    icon: {
        height: 20,
        width: 20,
        marginRight: 10,
    },
    text: {
        ...styles.body2,
        lineHeight: 20,
    },
})
