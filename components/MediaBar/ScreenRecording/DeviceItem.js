import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import Icon from '../../Icon'
import global, { colors } from '../../styles/global'

const DeviceItem = ({ label, onPress, checked, icon, index, videoDeviceId }) => {
    return (
        <TouchableOpacity
            accessible={false}
            style={[
                localStyles.touchable,
                (checked || (index === 0 && videoDeviceId === 'default')) && {
                    backgroundColor: 'rgba(139, 149, 167, 0.22)',
                },
            ]}
            onPress={() => onPress()}
        >
            <Icon
                name={icon}
                size={24}
                color={!(checked || (index === 0 && videoDeviceId === 'default')) ? 'white' : colors.Primary100}
                style={{ marginRight: 8 }}
            />
            <Text
                style={[
                    localStyles.title,
                    (checked || (index === 0 && videoDeviceId === 'default')) && { color: colors.Primary100 },
                ]}
            >
                {label}
            </Text>
            {(checked || (index === 0 && videoDeviceId === 'default')) && (
                <Icon name={'check'} size={24} color="#fff" style={{ marginLeft: 'auto' }} />
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    touchable: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 4,
        paddingVertical: 12,
        paddingHorizontal: 8,
    },
    title: {
        ...global.subtitle1,
        color: 'white',
    },
})

export default DeviceItem
