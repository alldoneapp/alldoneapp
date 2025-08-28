import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { useSelector } from 'react-redux'

import styles from '../../../styles/global'
import { getUserItemTheme } from '../../Themes'

export default function UserRole({ user, role }) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const currentUserId = useSelector(state => state.currentUser.uid)

    const theme = getUserItemTheme(themeName)
    const highlight = currentUserId === user.uid

    return (
        <Text style={[localStyles.container, highlight ? theme.nameActive : theme.name]} numberOfLines={1}>
            {role}
        </Text>
    )
}

const localStyles = StyleSheet.create({
    container: {
        ...styles.body3,
        flex: 1,
        opacity: 0.5,
        marginLeft: 6,
        alignSelf: 'flex-end',
        marginRight: 8,
        lineHeight: 16,
    },
})
