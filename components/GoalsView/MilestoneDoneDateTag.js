import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { useSelector } from 'react-redux'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'

export default function MilestoneDoneDateTag({ date }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [expanded, setExpanded] = useState(false)

    const dateText = date.format(getDateFormat())
    const shortTag = smallScreenNavigation && !expanded

    useEffect(() => {
        setExpanded(false)
    }, [smallScreenNavigation])

    return (
        <TouchableOpacity
            onPress={() => {
                setExpanded(expanded => !expanded)
            }}
            disabled={!smallScreenNavigation}
            style={[localStyles.container, shortTag && { paddingRight: 4 }]}
        >
            <Icon name="calendar" size={16} color={colors.Text03} />
            <Text style={[styles.subtitle2, !shortTag && localStyles.text, windowTagStyle()]}>
                {shortTag ? '' : dateText}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        height: 24,
        marginTop: 4,
        marginRight: 8,
        paddingLeft: 4,
        paddingRight: 8,
    },

    text: {
        color: colors.Text03,
        marginLeft: 4,
    },
})
