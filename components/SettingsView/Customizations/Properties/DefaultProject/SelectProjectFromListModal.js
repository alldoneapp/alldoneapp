import React from 'react'
import { StyleSheet, View } from 'react-native'

import ProjectModalItem from './ProjectModalItem'
import CustomScrollView from '../../../../UIControls/CustomScrollView'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../../utils/HelperFunctions'
import useWindowSize from '../../../../../utils/useWindowSize'
import { colors } from '../../../../styles/global'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'

export default function SelectProjectFromListModal({
    closeModal,
    projects,
    title,
    description,
    onSelectProject,
    activeProjectId,
}) {
    const [width, height] = useWindowSize()

    const selectProject = projectId => {
        onSelectProject(projectId)
        closeModal()
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader closeModal={closeModal} title={title} description={description} />
                {projects.map(projectItem => {
                    return (
                        <ProjectModalItem
                            key={projectItem.id}
                            selectedProjectId={activeProjectId}
                            project={projectItem}
                            onProjectSelect={selectProject}
                        />
                    )
                })}
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        maxHeight: 356,
        zIndex: 11000,
    },
    title: {
        flexDirection: 'column',
        marginTop: 8,
    },
    scroll: {
        padding: 16,
    },
})
