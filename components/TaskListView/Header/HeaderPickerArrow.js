import React from 'react'
import { StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import { isSectionsTopSidebarNavigation } from '../../../utils/SidebarNavigationModes'

/**
 * AT-3121: in the "Anna on top" sidebar the lines above a list are where the section, the project and
 * the person are switched, so a name there that opens a picker carries a small arrow after it.
 * Other sidebar modes keep their header as it was. Callers render it only where a press opens a picker.
 */
export default function HeaderPickerArrow({ color, style }) {
    const annaOnTop = useSelector(state => isSectionsTopSidebarNavigation(state.loggedUser?.sidebarNavigationMode))
    if (!annaOnTop) return null
    return <Icon name="chevron-down" size={18} color={color || colors.Text02} style={[localStyles.arrow, style]} />
}

const localStyles = StyleSheet.create({
    arrow: {
        marginLeft: 2,
        flexShrink: 0,
    },
})
