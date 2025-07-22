import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { useSelector } from 'react-redux'
import SharedHelper from '../../../utils/SharedHelper'
import { FEED_CHAT_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import PrivacyTag from '../../Tags/PrivacyTag'
import OpenInNewWindowButton from '../../UIControls/OpenInNewWindowButton'
import { DV_TAB_CHAT_BOARD } from '../../../utils/TabNavigationConstants'
import useLastEditDate from '../../../hooks/useLastEditDate'
import { translate } from '../../../i18n/TranslationService'
import useGetUserPresentationData from '../../ContactsView/Utils/useGetUserPresentationData'
import DvBotButton from '../../UIControls/DvBotButton'

export default function TagList({ projectId, chat }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const tablet = useSelector(state => state.isMiddleScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    const isMobile = loggedUser.sidebarExpanded ? tablet : mobile
    const editionText = useLastEditDate(chat.lastEditionDate)

    const editorData = useGetUserPresentationData(chat.lastEditorId)
    return (
        <View style={localStyles.container}>
            <View style={{ flexDirection: 'row' }}>
                <View style={{ marginRight: 12 }}>
                    <PrivacyTag
                        projectId={projectId}
                        object={chat}
                        objectType={FEED_CHAT_OBJECT_TYPE}
                        disabled={!accessGranted}
                        isMobile={isMobile}
                    />
                </View>
            </View>
            <View style={{ marginTop: 'auto', flexDirection: 'row' }}>
                <Text style={localStyles.lastEdited}>
                    {tablet
                        ? `${translate('edited')} ${editionText}\n ${translate('by')} ${
                              editorData.displayName.split(' ')[0]
                          }`
                        : `${translate('last edited')} ${editionText}\n ${translate('by')} ${editorData.displayName}`}
                </Text>
                <CopyLinkButton style={{ top: -5, marginRight: 8 }} />
                <DvBotButton
                    style={{ top: -5 }}
                    navItem={DV_TAB_CHAT_BOARD}
                    projectId={projectId}
                    assistantId={chat.assistantId}
                />
                <OpenInNewWindowButton style={{ top: -5 }} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    lastEdited: {
        ...styles.body3,
        position: 'relative',
        top: -2,
        color: colors.Text03,
        marginRight: 8,
        lineHeight: 14,
        textAlign: 'right',
    },
})
