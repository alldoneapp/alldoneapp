import React, { useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import useSelectorContactStatusFilter from './useSelectorContactStatusFilter'
import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import { translate } from '../../i18n/TranslationService'
import NavigationService from '../../utils/NavigationService'
import { setSelectedNavItem } from '../../redux/actions'
import { DV_TAB_PROJECT_CONTACT_STATUSES } from '../../utils/TabNavigationConstants'

export default function ContactStatusFiltersView({ projectContacts }) {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const projectsMap = useSelector(state => state.loggedUserProjectsMap)
    const projectUsers = useSelector(state => state.projectUsers)
    const currentUserUid = useSelector(state => state.currentUser.uid)
    const [contactStatusFilter, setFilter, clearFilter] = useSelectorContactStatusFilter()

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    // Clear filter when user or project changes
    useEffect(() => {
        return () => {
            clearFilter()
        }
    }, [])

    useEffect(() => {
        contactStatusFilter && clearFilter()
    }, [currentUserUid, selectedProjectIndex])

    // Don't show in "All Projects" view
    if (inAllProjects) {
        return null
    }

    const project = loggedUserProjects[selectedProjectIndex]
    const projectData = projectsMap[project?.id]

    const hasContactStatuses = projectData?.contactStatuses && Object.keys(projectData.contactStatuses).length > 0
    const statuses = hasContactStatuses ? Object.values(projectData.contactStatuses) : []
    const sortedStatuses = [...statuses].sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0))

    // Count contacts and members per status
    const contacts = projectContacts[project.id] || []
    const members = projectUsers[project.id] || []
    const statusCounts = {}
    let totalCount = contacts.length + members.length

    contacts.forEach(contact => {
        if (contact.contactStatusId) {
            statusCounts[contact.contactStatusId] = (statusCounts[contact.contactStatusId] || 0) + 1
        }
    })

    const onPressStatus = statusId => {
        if (contactStatusFilter === statusId) {
            clearFilter()
        } else {
            setFilter(statusId)
        }
    }

    const onPressAll = () => {
        clearFilter()
    }

    const onPressEdit = () => {
        NavigationService.navigate('ProjectDetailedView', {
            projectIndex: selectedProjectIndex,
        })
        dispatch(setSelectedNavItem(DV_TAB_PROJECT_CONTACT_STATUSES))
    }

    const isAllSelected = contactStatusFilter === null

    return (
        <View style={localStyles.container}>
            <TouchableOpacity
                style={[localStyles.statusItem, isAllSelected && localStyles.statusItemSelected]}
                onPress={onPressAll}
            >
                <Text style={[localStyles.statusName, isAllSelected && localStyles.statusNameSelected]}>
                    {translate('All')}
                </Text>
                <Text style={[localStyles.statusCount, isAllSelected && localStyles.statusCountSelected]}>
                    {totalCount}
                </Text>
            </TouchableOpacity>

            {sortedStatuses.map(status => {
                const count = statusCounts[status.id] || 0
                const isSelected = contactStatusFilter === status.id

                return (
                    <TouchableOpacity
                        key={status.id}
                        style={[localStyles.statusItem, isSelected && localStyles.statusItemSelected]}
                        onPress={() => onPressStatus(status.id)}
                    >
                        <View
                            style={[
                                localStyles.colorDot,
                                { backgroundColor: status.color },
                                isSelected && localStyles.colorDotSelected,
                            ]}
                        />
                        <Text style={[localStyles.statusName, isSelected && localStyles.statusNameSelected]}>
                            {status.name}
                        </Text>
                        <Text style={[localStyles.statusCount, isSelected && localStyles.statusCountSelected]}>
                            {count}
                        </Text>
                    </TouchableOpacity>
                )
            })}

            <TouchableOpacity style={localStyles.editItem} onPress={onPressEdit}>
                <Icon name="edit-2" size={14} color={colors.Text03} />
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginBottom: 8,
    },
    statusItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey200,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginRight: 8,
        marginBottom: 8,
    },
    statusItemSelected: {
        backgroundColor: colors.Primary200,
    },
    colorDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 6,
    },
    colorDotSelected: {
        borderWidth: 1,
        borderColor: 'white',
    },
    statusName: {
        ...styles.caption1,
        color: colors.Text03,
        marginRight: 6,
    },
    statusNameSelected: {
        color: 'white',
    },
    statusCount: {
        ...styles.caption2,
        color: colors.Text03,
    },
    statusCountSelected: {
        color: 'white',
    },
    editItem: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: colors.Grey200,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
})
