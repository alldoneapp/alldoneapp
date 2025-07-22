import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import AssigneesIcon from '../GoalsView/EditGoalsComponents/AssigneesIcon'
import { exitsOpenModals } from '../ModalsManager/modalsManager'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import { useSelector } from 'react-redux'
import SocialText from '../UIControls/SocialText/SocialText'
import { DEFAULT_WORKSTREAM_ID } from './WorkstreamHelper'
import { translate } from '../../i18n/TranslationService'

const ProjectWorkstreamItem = ({ projectId, workstream, openEditModal }) => {
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const isDefault = workstream.uid === DEFAULT_WORKSTREAM_ID
    const onOpenEditModal = () => {
        if (showFloatPopup === 0 && openEditModal && !exitsOpenModals()) {
            openEditModal()
        } else {
            dismissAllPopups(true, true, true)
        }
    }

    return (
        <View style={localStyles.container}>
            <TouchableOpacity onPress={onOpenEditModal} style={localStyles.touchContainer}>
                <View style={localStyles.streamIcon}>
                    <Icon size={30} name="workstream" color={colors.Text03} />
                </View>

                <View style={localStyles.wstreamData}>
                    <Text style={[localStyles.wstreamName, styles.body1]}>
                        {isDefault ? translate(workstream.displayName) : workstream.displayName}
                    </Text>
                    {!!workstream.description && (
                        <View style={localStyles.captionText}>
                            <SocialText
                                style={localStyles.info}
                                numberOfLines={1}
                                projectId={projectId}
                                inFeedComment={true}
                                showEllipsis={true}
                            >
                                {isDefault ? translate(workstream.description) : workstream.description}
                            </SocialText>
                        </View>
                    )}
                </View>
                <View style={localStyles.buttonSection}>
                    <AssigneesIcon assigneesIds={workstream.userIds} disableModal={true} projectId={projectId} />
                </View>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 64,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    touchContainer: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    wstreamData: {
        flex: 1,
        paddingTop: 2,
        marginLeft: 12,
        flexDirection: 'column',
        justifyContent: 'flex-start',
    },
    streamIcon: {
        marginTop: 2,
        width: 40,
        height: 40,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    wstreamName: {
        justifyContent: 'flex-start',
    },
    captionText: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
    },
    buttonSection: {
        marginLeft: 8,
    },
    separator: {
        width: 4,
        height: 4,
        marginHorizontal: 8,
        borderRadius: 50,
        backgroundColor: colors.Text03,
    },
    info: {
        ...styles.caption2,
        color: colors.Text03,
    },
})

export default ProjectWorkstreamItem
