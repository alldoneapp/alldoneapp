import React, { useEffect } from 'react'
import { Text, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import ProjectTag from '../Tags/ProjectTag'
import { useDispatch, useSelector } from 'react-redux'
import { resetLoadingData } from '../../redux/actions'
import ModernImage from '../../utils/ModernImage'
import { translate } from '../../i18n/TranslationService'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function EmptyNotesAllProjects({ sortedActiveProjects }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const loggedUser = useSelector(state => state.loggedUser)
    const dispatch = useDispatch()

    useEffect(() => {
        dispatch(resetLoadingData())
    }, [])

    return (
        <View style={localStyles.emptyInbox}>
            <ModernImage
                srcWebp={require('../../web/images/illustrations/Empty-Notes-All-Projects.webp')}
                fallback={require('../../web/images/illustrations/Empty-Notes-All-Projects.png')}
                style={{ flex: 1, width: '100%', maxWidth: 447 }}
                alt={translate('Empty Notes inbox All projects')}
            />
            <View style={[localStyles.emptyInboxText, mobile && localStyles.emptyInboxTextMobile]}>
                <Icon name={'info'} size={22} color={colors.Text03} style={{ marginRight: 9 }} />
                <Text style={[styles.body1, { color: colors.Text02, textAlign: 'center' }]}>
                    {translate('Empty Notes inbox All projects description')}
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
                            path={`/projects/${project.id}/user/${loggedUser.uid}/notes/followed`}
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
