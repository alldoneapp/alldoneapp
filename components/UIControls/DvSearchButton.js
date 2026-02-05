import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { showGlobalSearchPopup, setSearchText } from '../../redux/actions'
import { translate } from '../../i18n/TranslationService'

export default function DvSearchButton({ style }) {
    const dispatch = useDispatch()
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)
    const tablet = useSelector(state => state.isMiddleScreen)
    const tabletNoteDV = useSelector(state => state.isMiddleScreenNoteDV)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const mobileCollapsed = useSelector(state => state.smallScreenNavSidebarCollapsed)
    const isMobile = sidebarExpanded ? tablet || tabletNoteDV : mobile || mobileCollapsed

    const openSearch = () => {
        dispatch(setSearchText(''))
        dispatch(showGlobalSearchPopup(false))
    }

    return (
        <TouchableOpacity onPress={openSearch} style={[localStyles.container, style]} accessible={false}>
            <Icon name={'search'} size={18} color={colors.Text03} />
            {!isMobile && <Text style={localStyles.text}>{translate('Search')}</Text>}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        maxHeight: 32,
        minHeight: 32,
        borderWidth: 1,
        borderRadius: 4,
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderColor: colors.Gray400,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 6,
        paddingHorizontal: 8,
        marginRight: 8,
    },
    text: {
        ...styles.caption1,
        color: colors.Text03,
        marginLeft: 8,
        marginRight: 4,
    },
})
