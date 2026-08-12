import React, { useState } from 'react'
import AppPopover from '../../UIComponents/ModalShell/AppPopover'
import { useDispatch, useSelector } from 'react-redux'
import { StyleSheet } from 'react-native'

import Button from '../../UIControls/Button'
import SelectProjectModalInInvoceGeneration from './SelectProjectModalInInvoceGeneration'
import { translate } from '../../../i18n/TranslationService'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import ProjectHelper from '../ProjectsSettings/ProjectHelper'

export default function SelectProjectModalInInvoceGenerationWrapper() {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const activeProjectsAmount = ProjectHelper.getAmountActiveProjects(loggedUser)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    return (
        <AppPopover
            content={<SelectProjectModalInInvoceGeneration closeModal={closeModal} />}
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <Button
                icon="several-file-text"
                title={translate('Generate Invoice')}
                type={'ghost'}
                buttonStyle={localStyles.buttonStyle}
                onPress={openModal}
                disabled={activeProjectsAmount === 0}
            />
        </AppPopover>
    )
}

const localStyles = StyleSheet.create({
    buttonStyle: {
        marginTop: 16,
        alignSelf: 'flex-end',
    },
})
