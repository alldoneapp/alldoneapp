import React from 'react'
import { Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import { useDispatch, useSelector } from 'react-redux'
import Button from '../UIControls/Button'
import { hideFloatPopup, showGlobalSearchPopup } from '../../redux/actions'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import ModernImage from '../../utils/ModernImage'
import { translate } from '../../i18n/TranslationService'

export default function NothingToShow({ containerStyle, mainText, hideButton, hideImage, hideSecondaryText }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const dispatch = useDispatch()

    const onPressSearch = e => {
        e?.preventDefault()
        dispatch([hideFloatPopup(), showGlobalSearchPopup(false)])
        dismissAllPopups()
    }

    return (
        <View style={[localStyles.emptyInbox, containerStyle]}>
            {!hideImage && (
                <ModernImage
                    srcWebp={require('../../web/images/illustrations/Nothing-To-Show.webp')}
                    fallback={require('../../web/images/illustrations/Nothing-To-Show.png')}
                    style={{ flex: 1, width: '100%', maxWidth: 411 }}
                    alt={translate('nothing to show header')}
                />
            )}
            <View
                style={[
                    localStyles.emptyInboxText,
                    mobile && localStyles.emptyInboxTextMobile,
                    hideImage && { marginTop: 0 },
                ]}
            >
                <Text style={localStyles.primaryText}>{translate(mainText ? mainText : 'nothing to show header')}</Text>
                {!hideSecondaryText && (
                    <Text style={localStyles.secondaryText}>{translate('Try a different search criteria')}</Text>
                )}
            </View>
            {!hideButton && (
                <View style={localStyles.buttonSection}>
                    <Button title={translate('Search')} type={'primary'} icon={'search'} onPress={onPressSearch} />
                </View>
            )}
        </View>
    )
}

const localStyles = {
    emptyInbox: {
        flex: 1,
        marginTop: 32,
        alignItems: 'center',
    },
    emptyInboxText: {
        marginTop: 32,
        maxWidth: 700,
        marginHorizontal: 104,
    },
    emptyInboxTextMobile: {
        marginHorizontal: 16,
    },
    primaryText: {
        ...styles.title4,
        color: colors.Text02,
        textAlign: 'center',
    },
    secondaryText: {
        ...styles.body1,
        color: colors.Text02,
        textAlign: 'center',
        marginTop: 32,
    },
    buttonSection: {
        width: '100%',
        maxWidth: 700,
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
    },
}
