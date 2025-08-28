import React from 'react'
import { StyleSheet, View, Text } from 'react-native'
import styles from '../../styles/global'

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
        backgroundColor: 'white',
    },
    bottomContainer: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        backgroundColor: 'white',
        height: 32,
    },
})
