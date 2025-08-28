import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { useSelector } from 'react-redux'
import { WORKSTREAM_ID_PREFIX } from '../Workstreams/WorkstreamHelper'

export default function DateTag({
    date,
    icon = 'calendar',
    onPress,
    isMobile = false,
    disabled = false,
    outline = false,
    style,
}) {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <TouchableOpacity onPress={onPress} disabled={disabled}>
            <View style={[(outline ? otl : localStyles).container, style]}>
                <Icon
                    name={icon}
                    size={outline ? 14 : 16}
                    color={outline ? colors.UtilityBlue200 : colors.Text03}
                    style={localStyles.icon}
                />
                {!mobile && !isMobile && (
                    <Text style={[(outline ? otl : localStyles).text, windowTagStyle()]}>{date}</Text>
                )}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})

const otl = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderRadius: 50,
        borderWidth: 1,
        borderColor: colors.UtilityBlue200,
        alignItems: 'center',
        justifyContent: 'center',
        height: 20,
    },
    icon: {
        marginHorizontal: 3,
    },
    text: {
        ...styles.caption1,
        color: colors.UtilityBlue200,
        marginVertical: 1,
        marginRight: 6,
        marginLeft: 2,
    },
})
