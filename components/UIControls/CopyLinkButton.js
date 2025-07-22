import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import ReactTooltip from 'react-tooltip'
import { useSelector } from 'react-redux'
import { copyTextToClipboard } from '../../utils/HelperFunctions'
import { translate } from '../../i18n/TranslationService'

export default function CopyLinkButton({ style }) {
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)
    const tablet = useSelector(state => state.isMiddleScreen)
    const tabletNoteDV = useSelector(state => state.isMiddleScreenNoteDV)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const mobileCollapsed = useSelector(state => state.smallScreenNavSidebarCollapsed)
    const isMobile = sidebarExpanded ? tablet || tabletNoteDV : mobile || mobileCollapsed

    const copyLink = () => {
        copyTextToClipboard(window.location)
    }

    return (
        <TouchableOpacity
            onPress={copyLink}
            style={[localStyles.container, style]}
            data-tip={translate('Link copied to clipboard')}
            accessible={false}
        >
            <Icon name={'link'} size={18} color={colors.Text03} />
            {!isMobile && <Text style={localStyles.text}>{translate('Copy link')}</Text>}
            <ReactTooltip
                className={'ad-global-tooltip'}
                delayHide={1000}
                place={'bottom'}
                event={'click'}
                eventOff={'mouseout'}
                effect={'solid'}
            />
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
    },
    text: {
        ...styles.caption1,
        color: colors.Text03,
        marginLeft: 8,
        marginRight: 4,
    },
})
