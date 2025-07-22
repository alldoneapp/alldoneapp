import React from 'react'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import { colors } from '../../styles/global'

export default function MobileIcon({ icon, active }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    return (
        <Icon
            name={icon}
            size={20}
            color={active ? colors.Primary100 : colors.Text03}
            style={(!smallScreenNavigation || active) && { marginLeft: 8 }}
        />
    )
}
