import React from 'react'
import { View, StyleSheet } from 'react-native'

import styles from '../styles/global'
import GuideProjectsListUsers from './GuideProjectsListUsers'

export default function GuideProjects({ navigation }) {
    return (
        <View>
            <GuideProjectsListUsers navigation={navigation} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 32,
        paddingLeft: 24,
        paddingBottom: 4,
        marginTop: 32,
        alignItems: 'center',
    },
    text: {
        ...styles.body1,
    },
})
