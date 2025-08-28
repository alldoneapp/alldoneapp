import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import ProjectPropertiesHeader from './ProjectPropertiesHeader'
import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { setSelectedTypeOfProject, showConfirmPopup } from '../../../redux/actions'
import {
    CONFIRM_POPUP_TRIGGER_DELETE_PROJECT,
    CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT,
} from '../../UIComponents/ConfirmPopup'
import URLsProjects, { URL_PROJECT_DETAILS_PROPERTIES } from '../../../URLSystem/Projects/URLsProjects'
import Backend from '../../../utils/BackendBridge'
import FollowObject from '../../Followers/FollowObject'
import { FOLLOWER_PROJECTS_TYPE } from '../../Followers/FollowerConstants'
import {
    DV_TAB_PROJECT_PROPERTIES,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_TASKS,
} from '../../../utils/TabNavigationConstants'
import CreatedBy from '../../TaskDetailedView/Properties/CreatedBy'
import { useDispatch, useSelector } from 'react-redux'
import DescriptionField from '../../TaskDetailedView/Properties/DescriptionField'
import { FEED_PROJECT_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import SharedHelper from '../../../utils/SharedHelper'
import ConnectCalendarProperty from './ConnectCalendar/ConnectCalendarProperty'
import ConnectGmailProperty from './ConnectGmail/ConnectGmailProperty'
import ColorProperty from './ColorProperty/ColorProperty'
import PrivacyProperty from './PrivacyProperty/PrivacyProperty'
import GuidesProperty from './GuidesProperty/GuidesProperty'
import { translate } from '../../../i18n/TranslationService'
import Icon from '../../Icon'
import CopyProjectWrapper from './CopyProject/CopyProjectWrapper'
import ProjectHelper, { PROJECT_PRIVATE } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import EstimationTypeProperty from './EstimationTypeProperty/EstimationTypeProperty'
import ProjectStatus from './Status/ProjectStatus'
import { getUserData } from '../../../utils/backends/Users/usersFirestore'
import AssistantProperty from '../../UIComponents/FloatModals/ChangeAssistantModal/AssistantProperty'
import AutoEstimation from './AutoEstimation/AutoEstimation'

const ProjectProperties = ({ project, type }) => {
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const mobile = useSelector(state => state.smallScreen)
    const dispatch = useDispatch()
    const [creator, setCreator] = useState({})
    const projectId = project.id
    const accessGranted = SharedHelper.accessGranted(loggedUser, project.id)

    const leaveProject = () => {
        dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT,
                object: {
                    userId: loggedUser.uid,
                    projectId: project.id,
                },
            })
        )
    }

    const isGuide = !!project.parentTemplateId
    const cannotLeaveGuide = isGuide && loggedUser.realTemplateProjectIds.includes(project.parentTemplateId)

    useEffect(() => {
        getUserData(project.creatorId, false).then(user => {
            setCreator(user)
        })
        writeBrowserURL()
    }, [])

    useEffect(() => {
        dispatch(setSelectedTypeOfProject(type))
    }, [type])

    const deleteProject = () => {
        dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_PROJECT,
                object: {
                    projectId: projectId,
                    navigation: DV_TAB_ROOT_TASKS,
                    headerText: 'Be careful, this action is permanent',
                    headerQuestion: 'Do you really want to delete this project?',
                },
            })
        )
    }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_PROJECT_PROPERTIES) {
            const data = { projectId: projectId }
            URLsProjects.push(URL_PROJECT_DETAILS_PROPERTIES, data, projectId)
        }
    }

    const userIsNormalUserInGuide = ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)
    const hasGuideChildren = project.guideProjectIds.length > 0
    return (
        <View style={localStyles.container}>
            <ProjectPropertiesHeader />

            <View style={[localStyles.properties, mobile ? localStyles.propertiesMobile : undefined]}>
                {accessGranted ? (
                    <>
                        <View style={{ flex: 1, marginRight: mobile ? 0 : 72 }}>
                            <ColorProperty project={project} disabled={!accessGranted || userIsNormalUserInGuide} />
                            <ProjectStatus project={project} disabled={!accessGranted || hasGuideChildren} />
                            <ConnectCalendarProperty projectId={project.id} disabled={!accessGranted} />
                            <ConnectGmailProperty projectId={project.id} disabled={!accessGranted} />
                            <PrivacyProperty project={project} disabled={!accessGranted || userIsNormalUserInGuide} />
                        </View>

                        <View style={{ flex: 1 }}>
                            <AssistantProperty
                                projectId={projectId}
                                assistantId={project.assistantId}
                                disabled={!accessGranted || userIsNormalUserInGuide}
                                objectId={projectId}
                                objectType={'projects'}
                                header={'Project assistant'}
                            />
                            {hasGuideChildren && <GuidesProperty project={project} />}
                            <EstimationTypeProperty
                                project={project}
                                disabled={!accessGranted || userIsNormalUserInGuide}
                            />
                            <AutoEstimation
                                projectId={projectId}
                                disabled={!accessGranted || userIsNormalUserInGuide}
                                autoEstimation={project.autoEstimation}
                            />
                            <FollowObject
                                projectId={projectId}
                                followObjectsType={FOLLOWER_PROJECTS_TYPE}
                                followObjectId={projectId}
                                loggedUserId={loggedUser.uid}
                                object={project}
                                disabled={!accessGranted}
                            />
                            <CreatedBy createdDate={project.created} creator={creator} />
                        </View>
                    </>
                ) : (
                    <View style={localStyles.anonymousDesc}>
                        <Icon name="info" color={colors.Text03} size={18} style={{ marginTop: 2, marginRight: 8 }} />
                        <Text style={[styles.body1, { color: colors.Text03 }]}>
                            {translate('Project DV anonymous description')}
                        </Text>
                    </View>
                )}
            </View>

            <DescriptionField
                projectId={projectId}
                object={project}
                disabled={!accessGranted || userIsNormalUserInGuide}
                objectType={FEED_PROJECT_OBJECT_TYPE}
            />

            <View style={localStyles.footerSection}>
                {!isGuide && (project.isShared !== PROJECT_PRIVATE || accessGranted) && (
                    <View style={{ alignSelf: 'flex-end' }}>
                        <CopyProjectWrapper project={project} />
                    </View>
                )}

                {accessGranted && (
                    <View style={localStyles.footerRow}>
                        {isGuide && !cannotLeaveGuide && (
                            <Button
                                icon={'kick'}
                                title={translate('Leave community')}
                                type={'ghost'}
                                iconColor={colors.UtilityRed200}
                                titleStyle={{ color: colors.UtilityRed200 }}
                                buttonStyle={{ borderColor: colors.UtilityRed200, borderWidth: 2, marginTop: 16 }}
                                onPress={leaveProject}
                            />
                        )}
                        {!userIsNormalUserInGuide && (
                            <Button
                                icon={'trash-2'}
                                title={translate('Delete Project')}
                                type={'ghost'}
                                iconColor={colors.UtilityRed200}
                                titleStyle={{ color: colors.UtilityRed200 }}
                                buttonStyle={{
                                    borderColor: colors.UtilityRed200,
                                    borderWidth: 2,
                                    marginTop: 16,
                                }}
                                onPress={deleteProject}
                                accessible={false}
                                disabled={hasGuideChildren}
                            />
                        )}
                    </View>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    properties: {
        flexDirection: 'row',
    },
    propertiesMobile: {
        flexDirection: 'column',
    },
    propertyRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    propertyRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    propertyRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    propertyRowRight: {
        justifyContent: 'flex-end',
    },
    footerSection: {
        marginTop: 24,
    },
    footerRow: {
        alignSelf: 'flex-end',
        marginBottom: 16,
    },
    anonymousDesc: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'flex-start',
        marginBottom: 16,
    },
})

export default ProjectProperties
