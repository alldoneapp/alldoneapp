import React from 'react'
import { StyleSheet, View, Text } from 'react-native'
import styles from '../../styles/global'

import { themed } from '../../../Themes/colorMode'

const ProjectTitle = ({ project }) => {
    return (
        <View style={{ height: 64, flex: 1 }}>
            <View style={localStyles.upperContainer} />
            <View style={localStyles.bottomContainer}>
                <Text style={[styles.title4]}>{project.name}</Text>
            </View>
        </View>
    )
}

export default ProjectTitle

const localStyles = StyleSheet.create({
    upperContainer: {
        height: 32,
        backgroundColor: themed.Surface,
    },
    bottomContainer: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        backgroundColor: themed.Surface,
        height: 32,
    },
})
