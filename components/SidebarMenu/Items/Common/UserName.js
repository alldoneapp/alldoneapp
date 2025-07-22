import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { useSelector } from 'react-redux'

import styles from '../../../styles/global'
import { getUserItemTheme } from '../../Themes'

export default function UserName({ userId, name, containerStyle }) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const currentUserId = useSelector(state => state.currentUser.uid)

    const theme = getUserItemTheme(themeName)
    const highlight = currentUserId === userId

    return (
        <Text
            style={[localStyles.container, highlight ? theme.nameActive : theme.name, containerStyle]}
            numberOfLines={1}
        >
            {name}
        </Text>
    )
}

const localStyles = StyleSheet.create({
    container: {
        ...styles.body2,
        lineHeight: 20,
    },
})
