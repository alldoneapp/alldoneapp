import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { useSelector } from 'react-redux'
import Icon from '../../Icon'

const NoteHighlightTag = ({ hasStar, onPress, isMobile, style, disabled }) => {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    return (
        <TouchableOpacity onPress={onPress} disabled={disabled}>
            <View style={[localStyles.container, style]}>
                <Icon name={'highlight'} size={16} color={colors.Text03} style={localStyles.icon} />
                <Text style={[styles.subtitle2, !smallScreenNavigation && !isMobile ? localStyles.text : undefined]}>
                    {smallScreenNavigation || isMobile ? '' : hasStar ? 'Highlighted' : 'Normal'}
                </Text>
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
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})
export default NoteHighlightTag
