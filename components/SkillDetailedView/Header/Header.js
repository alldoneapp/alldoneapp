import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import BackButton from './BackButton'
import TagList from './TagList'
import LastEdition from './LastEdition'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import DVHamburgButton from '../../UIControls/DVHamburgButton'
import OpenInNewWindowButton from '../../UIControls/OpenInNewWindowButton'
import { DV_TAB_SKILL_CHAT } from '../../../utils/TabNavigationConstants'
import styles, { colors } from '../../styles/global'
import Title from './Title'
import DvBotButton from '../../UIControls/DvBotButton'
import BotLine from '../../ChatsView/ChatDV/BotLine/BotLine'
import { setDvIsFullScreen } from '../../../redux/actions'

export default function Header({ projectId, userHasAccessToProject }) {
    const dispatch = useDispatch()
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const skillId = useSelector(state => state.skillInDv.id)
    const isFullScreen = useSelector(state => state.dvIsFullScreen)
    const assistantId = useSelector(state => state.skillInDv.assistantId)
    const selectedNavItem = useSelector(state => state.selectedNavItem)

    const setFullscreen = isFullScreen => {
        dispatch(setDvIsFullScreen(isFullScreen))
    }

    return (
        <View style={[localStyles.container, isFullScreen && { paddingBottom: 8 }]}>
            <View style={localStyles.upperHeader}>
                {isMiddleScreen && userHasAccessToProject && <BackButton projectId={projectId} />}

                {smallScreenNavigation && isAnonymous && (
                    <View style={localStyles.backButtonMobile}>
                        <DVHamburgButton />
                    </View>
                )}
                <Title projectId={projectId} />
            </View>
            {!isFullScreen && (
                <View style={localStyles.bottomHeader}>
                    <TagList projectId={projectId} />
                    <LastEdition projectId={projectId} />
                    <CopyLinkButton style={{ marginRight: 8 }} />
                    <DvBotButton navItem={DV_TAB_SKILL_CHAT} projectId={projectId} assistantId={assistantId} />
                    <OpenInNewWindowButton />
                </View>
            )}
            {isFullScreen && selectedNavItem === DV_TAB_SKILL_CHAT && (
                <View style={localStyles.bottomHeader}>
                    <BotLine
                        setFullscreen={setFullscreen}
                        objectId={skillId}
                        assistantId={assistantId}
                        projectId={projectId}
                        objectType={'skills'}
                    />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingBottom: 24,
    },
    upperHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    titleContainer: {
        marginRight: 'auto',
        flex: 1,
        maxHeight: 800,
        overflowY: 'hidden',
    },
    bottomHeader: {
        marginTop: 22,
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButtonMobile: {
        left: -16,
    },
    ellipsis: {
        ...styles.title4,
        color: colors.Text01,
        backgroundColor: '#ffffff',
        paddingHorizontal: 8,
        position: 'absolute',
        bottom: 0,
        right: 0,
    },
})
