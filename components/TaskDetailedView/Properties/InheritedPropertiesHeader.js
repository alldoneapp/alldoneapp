import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'

export default InheritedPropertiesHeader = () => {
    return (
        <View>
            <View style={localStyles.container}>
                <Text style={localStyles.title}>Inherited properties</Text>
            </View>
            <View style={localStyles.infoContainer}>
                <Icon name="info" color={colors.Text03} size={19} />
                <Text style={localStyles.infoText}>
                    Here you can see the properties this subtask inherid from its parent task. Please take into account
                    that editing these properties will make this subtask become a normal task and move to a different
                    position in the task list.
                </Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 60,
        paddingTop: 22,
    },
    title: {
        ...styles.title6,
        color: colors.Text01,
    },
    infoContainer: {
        paddingVertical: 8,
        flexDirection: 'row',
    },
    infoText: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 8,
    },
})
