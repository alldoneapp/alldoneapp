import React from 'react'
import { StyleSheet, View } from 'react-native'
import UserTitle from './UserTitle'
import Indicator from './Indicator'
import BackButton from './BackButton'
import TagList from './TagList'
import SharedHelper from '../../../utils/SharedHelper'
import { useSelector } from 'react-redux'
import { DV_TAB_USER_CHAT } from '../../../utils/TabNavigationConstants'
import BotLine from '../../ChatsView/ChatDV/BotLine/BotLine'

export default function Header({ contact, project, isFullscreen, setFullscreen }) {
    const mobile = useSelector(state => state.isMiddleScreen)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const accessGranted = SharedHelper.accessGranted(null, project.id)

    return (
        <View style={localStyles.container}>
            <View style={[localStyles.upperHeader, isFullscreen && { paddingBottom: 16 }]}>
                {mobile && accessGranted && (
                    <View style={localStyles.backButtonMobile}>
                        <BackButton user={contact} projectIndex={project.index} />
                    </View>
                )}
                <View style={{ marginRight: 'auto', flex: 1 }}>
                    <UserTitle contact={contact} project={project} />
                </View>
                <View>
                    <Indicator />
                </View>
            </View>

            {!isFullscreen && (
                <View style={localStyles.bottomHeader}>
                    <TagList project={project} user={contact} />
                </View>
            )}
            {isFullscreen && selectedTab === DV_TAB_USER_CHAT && (
                <View style={localStyles.bottomHeader}>
                    <BotLine
                        setFullscreen={setFullscreen}
                        objectId={contact.uid}
                        assistantId={contact.assistantId}
                        projectId={project.id}
                        objectType={'users'}
                    />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 140,
        flexDirection: 'column',
        justifyContent: 'space-between',
        paddingBottom: 24,
        overflow: 'hidden',
    },
    upperHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    bottomHeader: {
        flexDirection: 'row',
    },
    backButtonMobile: {
        left: -16,
    },
})
