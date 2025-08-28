import React from 'react'
import { Text, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import ProjectTag from '../Tags/ProjectTag'
import { useSelector } from 'react-redux'
import ModernImage from '../../utils/ModernImage'
import { translate } from '../../i18n/TranslationService'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { ALL_GOALS_ID } from '../AllSections/allSectionHelper'

export default function EmptyGoalsAllProjects({ sortedActiveProjects }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    return (
        <View style={localStyles.emptyInbox}>
            <ModernImage
                srcWebp={require('../../web/images/illustrations/Empty-Goals-All-Projects.webp')}
                fallback={require('../../web/images/illustrations/Empty-Goals-All-Projects.png')}
                style={{ flex: 1, width: '100%', maxWidth: 500 }}
                alt={'Empty Goals inbox All projects'}
            />
            <View style={[localStyles.emptyInboxText, smallScreenNavigation && localStyles.emptyInboxTextMobile]}>
                <Icon name={'info'} size={22} color={colors.Text03} style={{ marginRight: 9 }} />
                <Text style={[styles.body1, { color: colors.Text02, textAlign: 'center' }]}>
                    {translate('You can add goals to define a roadmap & milestones together with your project')}
                    {'\n'}
                    {translate('Select a project to start adding goals')}
                </Text>
            </View>
            <View style={localStyles.projectsTags}>
                {sortedActiveProjects.map(project => {
                    const loggedUserIsAdmin = ProjectHelper.checkIfLoggedUserIsAdminUserInGuide(project)
                    return loggedUserIsAdmin ? null : (
                        <ProjectTag
                            key={project.id}
                            project={project}
                            style={localStyles.projectTag}
                            path={`/projects/${project.id}/user/${
                                project.parentTemplateId ? loggedUserId : ALL_GOALS_ID
                            }/goals/open`}
                        />
                    )
                })}
            </View>
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
        alignItems: 'flex-start',
        flexDirection: 'row',
    },
    emptyInboxTextMobile: {
        marginHorizontal: 16,
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
