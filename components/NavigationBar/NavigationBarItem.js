import React, { forwardRef, useImperativeHandle } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../styles/global'
import {
    hideFloatPopup,
    setAllFeeds,
    setFollowedFeeds,
    setInPartnerFeeds,
    setReloadGlobalFeeds,
    setSelectedNavItem,
    storeCurrentUser,
} from '../../redux/actions'
import Shortcut from '../UIControls/Shortcut'
import { NAVBAR_ITEM_MAP } from '../../utils/TabNavigationConstants'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import { useDispatch, useSelector } from 'react-redux'
import { translate, useTranslator } from '../../i18n/TranslationService'
import AmountTag from '../Feeds/FollowSwitchableTag/AmountTag'

const NavigationBarItem = (
    {
        children,
        feedAmount,
        invitationsAmount,
        selected,
        expandPicker,
        isMobile,
        isSecondary,
        forceTabletMargins,
        isNextShortcutTab,
    },
    ref
) => {
    useTranslator()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUser = useSelector(state => state.currentUser)
    const inPartnerFeeds = useSelector(state => state.inPartnerFeeds)
    const dispatch = useDispatch()

    const tabText = NAVBAR_ITEM_MAP[children] ? NAVBAR_ITEM_MAP[children] : children

    const onPress = () => {
        if (expandPicker !== undefined) {
            expandPicker()
        }

        const actionsToDispatch = [setSelectedNavItem(children), hideFloatPopup()]

        if (NAVBAR_ITEM_MAP[children] === 'Updates' || children === 'Updates') {
            actionsToDispatch.push(setReloadGlobalFeeds(true))

            if (loggedUser.uid !== currentUser.uid) {
                if (feedAmount > 0) {
                    if (inPartnerFeeds) {
                        actionsToDispatch.push(setInPartnerFeeds(false))
                        actionsToDispatch.push(setFollowedFeeds())
                        actionsToDispatch.push(setAllFeeds())
                    }
                    actionsToDispatch.push(storeCurrentUser(loggedUser))
                } else {
                    actionsToDispatch.push(setInPartnerFeeds(true))
                }
            }
        }
        dismissAllPopups(true, true, true)
        dispatch(actionsToDispatch)
    }

    useImperativeHandle(ref, () => ({
        onPress,
    }))

    return (
        <TouchableOpacity
            style={[isMobile ? localStyles.parentMobile : localStyles.parent, isSecondary && { marginRight: 0 }]}
            onPress={onPress}
        >
            {invitationsAmount > 0 && (
                <View style={localStyles.badge}>
                    <AmountTag feedAmount={invitationsAmount} isFollowedButton={true} />
                </View>
            )}
            <View
                style={[
                    localStyles.itemTextContainer,
                    smallScreenNavigation && (!feedAmount || feedAmount <= 0) && localStyles.itemTextContainerMobile,
                    isMobile
                        ? localStyles.containerMobile
                        : isMiddleScreen || forceTabletMargins
                        ? localStyles.containerTablet
                        : localStyles.container,
                ]}
            >
                <Text
                    style={
                        selected
                            ? [styles.subtitle2, { color: isMobile ? 'white' : colors.Primary400 }]
                            : [styles.body2, { color: isMobile ? 'white' : colors.Text03 }]
                    }
                >
                    {translate(tabText)}
                </Text>
            </View>

            <View
                style={[
                    localStyles.underline,
                    !selected ? null : isMobile ? localStyles.underlineMobile : localStyles.underlineActive,
                ]}
            />

            {isNextShortcutTab && (
                <View style={{ position: 'absolute', top: 0, right: -2 }}>
                    <Shortcut text={'Just_Tab'} />
                </View>
            )}
        </TouchableOpacity>
    )
}

export default forwardRef(NavigationBarItem)

const localStyles = StyleSheet.create({
    container: {
        height: 44,
        marginLeft: 24,
        marginRight: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    containerTablet: {
        height: 44,
        marginLeft: 10,
        marginRight: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    containerMobile: {
        height: 44,
        marginLeft: 16,
        marginRight: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 'auto',
    },
    parent: {
        flex: 1,
        flexDirection: 'column',
        marginRight: 12,
    },
    parentMobile: {
        flexDirection: 'column',
    },
    underline: {
        width: '100%',
        height: 4,
        backgroundColor: 'transparent',
    },
    underlineActive: {
        backgroundColor: colors.Primary400,
    },
    underlineMobile: {
        backgroundColor: colors.Primary200,
    },
    itemTextContainer: {
        flexDirection: 'row',
    },
    itemTextContainerMobile: {
        flexDirection: 'column',
    },
    badge: {
        position: 'absolute',
        top: 0,
        right: 0,
    },
})
