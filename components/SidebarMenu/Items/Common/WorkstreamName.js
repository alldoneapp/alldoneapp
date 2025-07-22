import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { useSelector } from 'react-redux'

import styles from '../../../styles/global'
import { DEFAULT_WORKSTREAM_ID } from '../../../Workstreams/WorkstreamHelper'
import { getUserItemTheme } from '../../Themes'
import { translate } from '../../../../i18n/TranslationService'

export default function WorkstreamName({ workstreamId, workstreamName }) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const currentUserId = useSelector(state => state.currentUser.uid)

    const theme = getUserItemTheme(themeName)
    const highlight = currentUserId === workstreamId
    const name = workstreamId === DEFAULT_WORKSTREAM_ID ? translate(workstreamName) : workstreamName

    return (
        <Text style={[localStyles.container, highlight ? theme.nameActive : theme.name]} numberOfLines={1}>
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
