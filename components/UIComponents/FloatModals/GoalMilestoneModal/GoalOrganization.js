import React from 'react'
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import styles from '../../../styles/global'

export default function GoalOrganization({ organizeOnlyThisMilestoneGoals }) {
    return (
        <View>
            <TouchableOpacity style={localStyles.container} onPress={organizeOnlyThisMilestoneGoals}>
                <Text style={localStyles.text}>All of this milestone</Text>
            </TouchableOpacity>
            <TouchableOpacity style={localStyles.container} disabled={true}>
                <Text style={localStyles.text}>All of this milestone and later</Text>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
})
