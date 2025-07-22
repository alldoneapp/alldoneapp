import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../../../UIComponents/FloatModals/ModalHeader'
import StatusItem from './StatusItem'
import { PROJECT_TYPE_ACTIVE, PROJECT_TYPE_ARCHIVED } from '../../../SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../../../redux/store'
import { setSelectedTypeOfProject } from '../../../../redux/actions'
import Backend from '../../../../utils/BackendBridge'

export default function ProjectStatusModal({ closeModal, project }) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)

    const currentStatus = ProjectHelper.getTypeOfProject(loggedUser, project.id)

    const selectStatus = itemStatus => {
        const { selectedProjectIndex, loggedUserProjects } = store.getState()

        const selectedProjectId = loggedUserProjects[selectedProjectIndex]?.id

        if (selectedProjectId && project.id === selectedProjectId) {
            dispatch(setSelectedTypeOfProject(currentStatus))
        }
        itemStatus === PROJECT_TYPE_ACTIVE
            ? Backend.convertToActiveProject(loggedUser, project)
            : Backend.convertToArchiveProject(loggedUser, project)

        closeModal()
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <ModalHeader
                closeModal={closeModal}
                title={translate('Project status')}
                description={translate('Choose the project status')}
            />
            <>
                <StatusItem
                    selectStatus={selectStatus}
                    icon="circle"
                    text="Normal"
                    containerStyle={{ marginBottom: 8 }}
                    currentStatus={currentStatus}
                    itemStatus={PROJECT_TYPE_ACTIVE}
                />
                <StatusItem
                    selectStatus={selectStatus}
                    icon="archive"
                    text="Archive"
                    containerStyle={{ marginBottom: 8 }}
                    currentStatus={currentStatus}
                    itemStatus={PROJECT_TYPE_ARCHIVED}
                />
            </>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 432,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        padding: 16,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
