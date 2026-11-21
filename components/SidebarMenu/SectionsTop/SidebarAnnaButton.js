import React, { useContext } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch } from 'react-redux'

import store from '../../../redux/store'
import { hideWebSideBar } from '../../../redux/actions'
import { translate } from '../../../i18n/TranslationService'
import { dismissAllPopups } from '../../../utils/HelperFunctions'
import styles, { colors } from '../../styles/global'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../../hooks/UseOnHover'
import { AnnaSidebarModeContext } from '../../Anna/AnnaShellSidebarContext'
import { AnnaAppShownContext } from '../../Anna/AnnaTopStripContext'

/**
 * AT-3121: Anna as one big button at the very top of the "Anna on top" sidebar. A press opens the
 * chat as it was last shown, or goes back to it when it is open. The sidebar marks only what the main
 * area shows: with Anna alone this button is the marked one; beside Alldone the section is, and the
 * button only has a ring around Anna's photo. Closed, it looks like any other row: no fill, no border
 * (a white card with a blue border read as marked).
 */
export default function SidebarAnnaButton() {
    const anna = useContext(AnnaSidebarModeContext)
    return anna ? <AnnaButton anna={anna} /> : null
}

function AnnaButton({ anna: { name, photo, chatShown, onOpenChat } }) {
    const dispatch = useDispatch()
    const appShown = useContext(AnnaAppShownContext)
    const { expanded } = useCollapsibleSidebar()
    const { hover, onHover, offHover } = useOnHover()

    const alone = chatShown && !appShown
    const beside = chatShown && appShown

    const onPress = e => {
        e?.preventDefault()
        dismissAllPopups(true, true, true)
        if (store.getState().smallScreenNavigation) dispatch(hideWebSideBar())
        onOpenChat()
    }

    return (
        <TouchableOpacity
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: alone }}
            aria-current={alone ? 'page' : undefined}
            accessibilityLabel={`${name} – ${translate('How can I help?')}`}
            nativeID="sidebar-anna-button"
            testID="sidebar-anna-button"
        >
            <View
                style={[
                    localStyles.container,
                    !expanded && localStyles.containerCollapsed,
                    hover && localStyles.containerHover,
                    alone && localStyles.containerSelected,
                ]}
                onMouseEnter={onHover}
                onMouseLeave={offHover}
            >
                <View style={[localStyles.avatarRing, beside && localStyles.avatarRingOpen]}>
                    {photo ? (
                        <Image source={{ uri: photo }} style={localStyles.avatar} />
                    ) : (
                        <View style={[localStyles.avatar, localStyles.avatarFallback]}>
                            <Text style={localStyles.avatarInitial}>{name.charAt(0)}</Text>
                        </View>
                    )}
                </View>
                {expanded && (
                    <View style={localStyles.texts}>
                        <Text style={[localStyles.name, alone && localStyles.nameSelected]} numberOfLines={1}>
                            {name}
                        </Text>
                        <Text style={localStyles.subtitle} numberOfLines={1}>
                            {translate('How can I help?')}
                        </Text>
                    </View>
                )}
            </View>
        </TouchableOpacity>
    )
}

const AVATAR_SIZE = 36

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 10,
        marginTop: 4,
        marginBottom: 12,
        paddingVertical: 8,
        paddingHorizontal: 8,
        borderRadius: 12,
        // Kept transparent at rest, so marking it does not move anything.
        borderWidth: 1,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
    },
    containerCollapsed: {
        marginHorizontal: 4,
        paddingHorizontal: 2,
        justifyContent: 'center',
    },
    containerHover: {
        backgroundColor: colors.UtilityBlue100,
    },
    containerSelected: {
        backgroundColor: colors.UtilityBlue100,
        borderColor: colors.Primary100,
    },
    // The ring sits outside the photo, so the photo keeps its size when it shows.
    avatarRing: {
        width: AVATAR_SIZE + 6,
        height: AVATAR_SIZE + 6,
        borderRadius: (AVATAR_SIZE + 6) / 2,
        borderWidth: 2,
        borderColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarRingOpen: {
        borderColor: colors.Primary100,
    },
    avatar: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_SIZE / 2,
    },
    avatarFallback: {
        backgroundColor: colors.Primary100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarInitial: {
        ...styles.subtitle1,
        // On the fixed blue of the fallback avatar in both colour modes.
        color: '#FFFFFF',
    },
    texts: {
        marginLeft: 10,
        flex: 1,
        minWidth: 0,
    },
    name: {
        ...styles.subtitle1,
        color: colors.Text01,
    },
    nameSelected: {
        color: colors.Primary100,
    },
    subtitle: {
        ...styles.caption2,
        color: colors.Text03,
    },
})
