import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { ESTIMATIONS_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import useWindowSize from '../../../../utils/useWindowSize'
import { translate } from '../../../../i18n/TranslationService'
import {
    ESTIMATION_OPTIONS,
    ESTIMATION_TYPE_TIME,
    getEstimationTypeByProjectId,
} from '../../../../utils/EstimationHelper'
import EstimationModalBackButton from './EstimationModalBackButton'
import CustomEstimationItem from './CustomEstimationItem'
import CustomEstimationModal from './CustomEstimationModal'
import ModalHeader from '../ModalHeader'
import EstimationModalOptions from './EstimationModalOptions'
import AutoAdaptEstimation from './AutoAdaptEstimation'

export default function EstimationModal({
    projectId,
    estimation,
    setEstimationFn,
    autoEstimation,
    setAutoEstimation,
    showAutoEstimation,
    closePopover,
    showBackButton,
    disabled,
}) {
    const [width, height] = useWindowSize()
    const [selectedEstimation] = useState(estimation || 0)
    const [showCustomForm, setShowCustomForm] = useState(false)
    const estimationType = getEstimationTypeByProjectId(projectId)

    const setEstimation = value => {
        closePopover(value)
        setEstimationFn(value)
    }

    const closeCustomModal = () => {
        setShowCustomForm(false)
    }

    const showCustomModal = () => {
        setShowCustomForm(true)
    }

    useEffect(() => {
        storeModal(ESTIMATIONS_MODAL_ID)
        return () => {
            removeModal(ESTIMATIONS_MODAL_ID)
        }
    }, [])

    return showCustomForm ? (
        <CustomEstimationModal
            setEstimation={setEstimation}
            initialEstimation={selectedEstimation}
            closeModal={closeCustomModal}
        />
    ) : (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView showsVerticalScrollIndicator={false}>
                <View style={localStyles.subContainer}>
                    <ModalHeader
                        closeModal={event => {
                            event.stopPropagation()
                            closePopover()
                        }}
                        title={translate('Estimation')}
                        description={translate('Select an estimation for your task')}
                    />
                    {!disabled && showAutoEstimation && (
                        <AutoAdaptEstimation autoEstimation={autoEstimation} setAutoEstimation={setAutoEstimation} />
                    )}
                    <EstimationModalOptions
                        projectId={projectId}
                        setEstimation={setEstimation}
                        selectedEstimation={selectedEstimation}
                        disabled={disabled}
                    />
                </View>
                {estimationType === ESTIMATION_TYPE_TIME && (
                    <CustomEstimationItem
                        estimation={selectedEstimation}
                        openCustomForm={showCustomModal}
                        isSelected={!ESTIMATION_OPTIONS.includes(selectedEstimation)}
                        disabled={disabled}
                    />
                )}
                {showBackButton && <EstimationModalBackButton closePopover={closePopover} />}
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    subContainer: {
        paddingTop: 16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 8,
    },
})
