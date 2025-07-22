import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'
import v4 from 'uuid/v4'

import Icon from '../../../../Icon'
import styles, { colors } from '../../../../styles/global'
import Button from '../../../../UIControls/Button'
import { translate } from '../../../../../i18n/TranslationService'
import ProjectHelper from '../../../ProjectsSettings/ProjectHelper'
import SelectProjectFromListModal from './SelectProjectFromListModal'
import { unwatch, watchActiveAndArchivedProjects, watchProject } from '../../../../../utils/backends/firestore'
import { setDefaultProjectId } from '../../../../../utils/backends/Users/usersFirestore'

export default function DefaultProject({ user }) {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)
    const [defaultProject, setDefaultProject] = useState(null)
    const [activeProjects, setActiveProjects] = useState([])

    const { defaultProjectId, uid: userId } = user

    const onSelectProject = projectId => {
        if (defaultProjectId !== projectId) setDefaultProjectId(userId, projectId)
    }

    const closeModal = () => {
        setOpen(false)
    }

    const openModal = () => {
        setOpen(true)
    }

    const filterActiveProjects = projects => {
        const activeProjects = ProjectHelper.getActiveProjects2(projects, user)
        setActiveProjects(activeProjects)
    }

    useEffect(() => {
        if (defaultProjectId) {
            const watcherKey = v4()
            watchProject(defaultProjectId, setDefaultProject, watcherKey)
            return () => {
                unwatch(watcherKey)
            }
        } else {
            setDefaultProject(null)
        }
    }, [defaultProjectId])

    useEffect(() => {
        const watcherKey = v4()
        watchActiveAndArchivedProjects(userId, watcherKey, filterActiveProjects)
        return () => {
            unwatch(watcherKey)
        }
    }, [userId, user.projectIds.length])

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'circle'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={localStyles.text} numberOfLines={1}>
                    {translate('Default project')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Popover
                    content={
                        <SelectProjectFromListModal
                            closeModal={closeModal}
                            projects={activeProjects}
                            title={translate('Select one of the projects')}
                            description={translate('You need to select a default project')}
                            onSelectProject={onSelectProject}
                            activeProjectId={defaultProject ? defaultProject.id : ''}
                        />
                    }
                    onClickOutside={closeModal}
                    isOpen={open}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={mobile ? null : undefined}
                >
                    {defaultProject ? (
                        <Button
                            icon={'circle-poject_color'}
                            iconColor={defaultProject.color}
                            type={'ghost'}
                            title={defaultProject.name}
                            onPress={openModal}
                        />
                    ) : (
                        <Button
                            icon={'edit'}
                            type={'ghost'}
                            title={'None'}
                            onPress={openModal}
                            disabled={activeProjects.length === 0}
                        />
                    )}
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    settingRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    settingRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    settingRowRight: {
        justifyContent: 'flex-end',
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
})
