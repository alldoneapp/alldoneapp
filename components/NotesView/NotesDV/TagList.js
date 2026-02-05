import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { useSelector } from 'react-redux'
import SharedHelper from '../../../utils/SharedHelper'
import { FEED_NOTE_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import ProjectTag from '../../Tags/ProjectTag'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import PrivacyTag from '../../Tags/PrivacyTag'
import OpenInNewWindowButton from '../../UIControls/OpenInNewWindowButton'
import { translate } from '../../../i18n/TranslationService'
import useLastEditDate from '../../../hooks/useLastEditDate'
import { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'
import { DV_TAB_NOTE_CHAT } from '../../../utils/TabNavigationConstants'
import DvBotButton from '../../UIControls/DvBotButton'
import DvSearchButton from '../../UIControls/DvSearchButton'

export default function TagList({ projectId, note, disabled, updateObjectState }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreenNoteDV)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const project = ProjectHelper.getProjectById(projectId)
    const isMobile = loggedUser.sidebarExpanded ? tablet : mobile
    const editionText = useLastEditDate(note.lastEditionDate)

    const editor = getUserPresentationDataInProject(project?.id, note.lastEditorId)

    return (
        <View style={localStyles.container}>
            <View style={{ flexDirection: 'row' }}>
                <View style={{ marginRight: 12 }}>
                    <ProjectTag project={project} disabled={!accessGranted} isMobile={isMobile} />
                </View>
                <View style={{ marginRight: 12 }}>
                    <PrivacyTag
                        projectId={projectId}
                        object={note}
                        objectType={FEED_NOTE_OBJECT_TYPE}
                        disabled={!accessGranted || disabled}
                        isMobile={isMobile}
                    />
                </View>
            </View>
            <View style={{ marginTop: 'auto', flexDirection: 'row' }}>
                <Text style={localStyles.lastEdited}>
                    {tablet
                        ? `${translate('edited')} ${editionText}\n ${translate('by')} ${
                              editor.displayName.split(' ')[0]
                          }`
                        : `${translate('last edited')} ${editionText}\n ${translate('by')} ${editor.displayName}`}
                </Text>
                <CopyLinkButton style={{ top: -5, marginRight: 8 }} />
                <DvSearchButton style={{ top: -5 }} />
                <DvBotButton
                    style={{ top: -5 }}
                    navItem={DV_TAB_NOTE_CHAT}
                    projectId={projectId}
                    assistantId={note.assistantId}
                    objectId={note.id}
                    objectType={FEED_NOTE_OBJECT_TYPE}
                    parentObject={note}
                    updateObjectState={updateObjectState}
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
    tagContainer: {
        marginRight: 12,
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
