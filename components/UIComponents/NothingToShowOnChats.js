import React from 'react'
import { Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import { shallowEqual, useSelector } from 'react-redux'
import ModernImage from '../../utils/ModernImage'
import { translate } from '../../i18n/TranslationService'
import ProjectTag from '../Tags/ProjectTag'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_TYPE_ACTIVE, PROJECT_TYPE_GUIDE } from '../SettingsView/ProjectsSettings/ProjectsSettings'

export default function NothingToShowOnChats({ isInChats }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const uid = useSelector(state => state.loggedUser.uid)
    const activeProjects = useSelector(
        state => ProjectHelper.getProjectsByType(state.loggedUserProjects, state.loggedUser, PROJECT_TYPE_ACTIVE),
        shallowEqual
    )
    const guideProjects = useSelector(
        state => ProjectHelper.getProjectsByType(state.loggedUserProjects, state.loggedUser, PROJECT_TYPE_GUIDE),
        shallowEqual
    )
    const sortedActiveProjects = [
        ...ProjectHelper.sortProjects(activeProjects, uid),
        ...ProjectHelper.sortProjects(guideProjects, uid),
    ]

    return (
        <View style={localStyles.emptyInbox}>
            <ModernImage
                srcWebp={require('../../web/images/illustrations/Nothing-To-Show.webp')}
                fallback={require('../../web/images/illustrations/Nothing-To-Show.png')}
                style={{ flex: 1, width: '100%', maxWidth: 411 }}
                alt={translate('nothing to show header')}
            />
            <View style={[localStyles.emptyInboxText, mobile && localStyles.emptyInboxTextMobile]}>
                <Text style={localStyles.primaryText}>{translate('nothing to show header')}</Text>
            </View>
            {isInChats && (
                <View style={localStyles.projectsTags}>
                    {sortedActiveProjects.map(project => {
                        const loggedUserIsAdmin = ProjectHelper.checkIfLoggedUserIsAdminUserInGuide(project)
                        return loggedUserIsAdmin ? null : (
                            <ProjectTag
                                key={project.id}
                                project={project}
                                style={localStyles.projectTag}
                                path={`/projects/${project.id}/user/${uid}/chats/followed`}
                            />
                        )
                    })}
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
    projectsTags: {
        width: '100%',
        maxWidth: 700,
        flexWrap: 'wrap',
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
    },
    projectTag: {
        marginHorizontal: 6,
        marginBottom: 12,
    },
}
