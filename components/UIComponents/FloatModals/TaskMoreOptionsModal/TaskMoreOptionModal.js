import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import { colors } from '../../../styles/global'
import { TASK_MORE_OPTIONS_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import { showFloatPopup, hideFloatPopup } from '../../../../redux/actions'
import ModalHeader from '../ModalHeader'
import { translate } from '../../../../i18n/TranslationService'
import ModalItem from '../MorePopupsOfEditModals/Common/ModalItem'
import DescriptionModal from '../DescriptionModal/DescriptionModal'
import { FEED_TASK_OBJECT_TYPE } from '../../../Feeds/Utils/FeedsConstants'
import EstimationModal from '../EstimationModal/EstimationModal'
import HighlightColorModal from '../HighlightColorModal/HighlightColorModal'
import { getTaskAutoEstimation, OPEN_STEP } from '../../../TaskListView/Utils/TasksHelper'

export default function TaskMoreOptionModal({
    saveDescription,
    saveEstimation,
    setAutoEstimation,
    saveHighlight,
    projectId,
    task,
    closeModal,
}) {
    const dispatch = useDispatch()
    const [showDescriptionModal, setShowDescriptionModal] = useState(false)
    const [showHighlightModal, setShowHighlightModal] = useState(false)
    const [showEstimationModal, setShowEstimationModal] = useState(false)

    const showDescription = () => {
        setShowDescriptionModal(true)
    }

    const showHighlight = () => {
        setShowHighlightModal(true)
    }

    const showEstimation = () => {
        setShowEstimationModal(true)
    }

    useEffect(() => {
        storeModal(TASK_MORE_OPTIONS_MODAL_ID)
        dispatch(showFloatPopup())
        return () => {
            removeModal(TASK_MORE_OPTIONS_MODAL_ID)
            dispatch(hideFloatPopup())
        }
    }, [])

    return (
        <CustomScrollView showsVerticalScrollIndicator={false}>
            {showDescriptionModal ? (
                <DescriptionModal
                    projectId={projectId}
                    object={task}
                    closeModal={closeModal}
                    objectType={FEED_TASK_OBJECT_TYPE}
                    updateDescription={saveDescription}
                />
            ) : showEstimationModal ? (
                <EstimationModal
                    projectId={projectId}
                    estimation={task.estimations[OPEN_STEP]}
                    setEstimationFn={saveEstimation}
                    closePopover={closeModal}
                    showBackButton={true}
                    autoEstimation={getTaskAutoEstimation(projectId, task.estimations[OPEN_STEP], task.autoEstimation)}
                    setAutoEstimation={setAutoEstimation}
                    showAutoEstimation={!task.isSubtask}
                    disabled={!!task.calendarData}
                />
            ) : showHighlightModal ? (
                <HighlightColorModal onPress={saveHighlight} selectedColor={task.hasStar} responsive={true} />
            ) : (
                <View style={[localStyles.container, applyPopoverWidth()]}>
                    <ModalHeader closeModal={closeModal} title={translate('More options')} description={''} />
                    <ModalItem icon={'droplet-off'} text={'Highlight'} shortcut="1" onPress={showHighlight} />
                    <ModalItem icon={'info'} text={'Description'} shortcut="2" onPress={showDescription} />
                    <ModalItem icon={'clock'} text={'Estimation'} shortcut="3" onPress={showEstimation} />
                </View>
            )}
        </CustomScrollView>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        padding: 16,
        maxHeight: 424,
    },
})
