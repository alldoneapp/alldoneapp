import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { shrinkTagText } from '../../../../functions/Utils/parseTextUtils'

export default function ContactStatusItem({ status, updateStatus, currentStatusId, closeModal }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { id, name, color } = status

    const selected = id === currentStatusId || (id === null && currentStatusId === null)

    const selectOption = () => {
        if (!selected) {
            updateStatus(id)
        }
        closeModal()
    }

    return (
        <TouchableOpacity
            style={[localStyles.container, selected && localStyles.selectedContainer]}
            onPress={selectOption}
        >
            <View style={localStyles.containerOption}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {color ? (
                        <View style={[localStyles.colorDot, { backgroundColor: color }]} />
                    ) : (
                        <Icon name="tag" size={24} color={colors.Text03} />
                    )}
                    <Text style={localStyles.name}>
                        {shrinkTagText(name, smallScreenNavigation ? 18 : smallScreen ? 25 : 30)}
                    </Text>
                </View>
                {selected && <Icon name={'check'} size={24} color="white" style={{ marginLeft: 'auto', right: 11 }} />}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 48,
        padding: 8,
        flexDirection: 'row',
    },
    containerOption: {
        flexDirection: 'row',
        flex: 1,
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    colorDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
    },
    name: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginLeft: 12,
    },
    selectedContainer: {
        backgroundColor: '#1e2a51',
        borderRadius: 4,
    },
})
