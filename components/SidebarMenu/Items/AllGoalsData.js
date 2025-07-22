import React from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import { getUserItemTheme } from '../Themes'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'
import styles from '../../styles/global'

export default function AllGoalsData({ sectionName, sectionId }) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const { expanded } = useCollapsibleSidebar()

    const theme = getUserItemTheme(themeName)
    const highlight = currentUserId === sectionId

    return (
        <View style={localStyles.container}>
            <Icon
                size={20}
                name={'circle'}
                color={highlight ? theme.nameActive.color : theme.name.color}
                style={localStyles.icon}
            />
            {expanded && (
                <Text style={[localStyles.text, highlight ? theme.nameActive : theme.name]} numberOfLines={1}>
                    {sectionName}
                </Text>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
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
