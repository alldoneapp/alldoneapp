import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import PropTypes from 'prop-types'
import Popover from 'react-tiny-popover'
import { useSelector, useDispatch } from 'react-redux'

import styles from '../../styles/global'
import TaskHeaderMoreButton from '../../UIComponents/FloatModals/MorePopupsOfMainViews/Tasks/TaskHeaderMoreButton'
import ChangeObjectListModal from '../../UIComponents/FloatModals/ChangeObjectListModal'
import { translate } from '../../../i18n/TranslationService'
import ToggleByTime from '../ToggleByTime'
import { checkIfSelectedAllProjects } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { switchProject, storeLoggedUser } from '../../../redux/actions'
import store from '../../../redux/store'

const UserTasksHeader = () => {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const userId = useSelector(state => state.currentUser.uid)
    const currentSection = useSelector(state => state.taskViewToggleSection)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const project = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const realProjectIds = useSelector(state => state.loggedUser.realProjectIds)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const [open, setOpen] = useState(false)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const inOpenSection = currentSection === 'Open'

    const accessGranted = !isAnonymous && (inAllProjects || (project && realProjectIds.includes(project.id)))

    const handleToggle = showByTime => {
        if (showByTime && !inAllProjects) {
            // First update the showAllProjectsByTime setting and switch to All Projects view
            const { loggedUser } = store.getState()
            dispatch([storeLoggedUser({ ...loggedUser, showAllProjectsByTime: true }), switchProject(-1)])
        }
    }

    return (
        <View
            style={[
                localStyles.container,
                smallScreenNavigation
                    ? localStyles.headerTextForMobile
                    : isMiddleScreen && localStyles.headerTextForTablet,
            ]}
        >
            <Popover
                content={<ChangeObjectListModal closePopover={() => setOpen(false)} />}
                onClickOutside={() => setOpen(false)}
                isOpen={open}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'start'}
                contentLocation={smallScreenNavigation ? null : undefined}
            >
                <TouchableOpacity disabled={!accessGranted} accessible={false} onPress={() => setOpen(true)}>
                    <Text style={localStyles.headerText}> {translate('Tasks')}</Text>
                </TouchableOpacity>
            </Popover>
            {inOpenSection && <TaskHeaderMoreButton userId={userId} />}
            <ToggleByTime onToggle={handleToggle} containerStyle={!inOpenSection && { marginLeft: 8 }} />
        </View>
    )
}

UserTasksHeader.propTypes = {
    style: PropTypes.any,
}

export function getFormattedName(fullName) {
    if (fullName === 'Loading...') {
        return fullName
    }

    let name = fullName.split(' ')[0]

    if (name[name.length - 1] === 's') {
        return name + `' tasks`
    }

    return name + `'s tasks`
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        height: 80,
        maxHeight: 80,
        minHeight: 80,
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 40,
        paddingBottom: 8,
        paddingHorizontal: 104,
    },
    headerText: {
        ...styles.title5,
    },
    headerTextForMobile: {
        paddingHorizontal: 16,
    },
    headerTextForTablet: {
        paddingHorizontal: 56,
    },
})

export default UserTasksHeader
