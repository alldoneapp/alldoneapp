import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'

const ContactStatusItem = ({ status, dragHandleProps, isDragging }) => {
    return (
        <View style={[localStyles.container, isDragging && localStyles.dragging]}>
            <View style={[localStyles.colorDot, { backgroundColor: status.color }]} />

            <View style={localStyles.nameContainer}>
                <Text style={[styles.body1, { color: colors.Text01 }]}>{status.name}</Text>
            </View>

            <div {...dragHandleProps} style={{ display: 'flex', alignItems: 'center', cursor: 'grab', padding: 8 }}>
                <Icon name="menu" size={24} color={colors.Text03} />
            </div>
        </View>
    )
}

export default ContactStatusItem

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        height: 56,
        alignItems: 'center',
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey300,
        paddingHorizontal: 8,
        marginBottom: 8,
        backgroundColor: 'white',
    },
    dragging: {
        borderColor: colors.Primary100,
        shadowColor: 'rgba(0,0,0,0.15)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 4,
    },
    colorDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
        marginLeft: 8,
    },
    nameContainer: {
        flexDirection: 'column',
        marginLeft: 12,
        flex: 1,
    },
})
