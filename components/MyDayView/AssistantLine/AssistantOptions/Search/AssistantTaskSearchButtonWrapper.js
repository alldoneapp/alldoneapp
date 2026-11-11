import React, { useEffect, useRef, useState } from 'react'
import AppPopover from '../../../../UIComponents/ModalShell/AppPopover'
import { useDispatch } from 'react-redux'

import OptionButton from '../OptionButtons/OptionButton'
import AssistantTaskSearchModal from './AssistantTaskSearchModal'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import { translate } from '../../../../../i18n/TranslationService'
import { modeColor } from '../../../../../Themes/colorMode'

export default function AssistantTaskSearchButtonWrapper({ onLayout }) {
    const dispatch = useDispatch()
    const [isOpen, setIsOpen] = useState(false)
    const isUnmountedRef = useRef(false)

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            dispatch(hideFloatPopup())
        }
    }, [])

    const safeSetIsOpen = value => {
        if (!isUnmountedRef.current) setIsOpen(value)
    }

    const openModal = () => {
        safeSetIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        safeSetIsOpen(false)
        dispatch(hideFloatPopup())
    }

    return (
        <AppPopover
            // The modal queries assistant tasks across every project. Keep it
            // out of the closed popover tree instead of relying on every
            // popover presenter to suppress closed content.
            content={isOpen ? <AssistantTaskSearchModal closeModal={closeModal} /> : null}
            align={'start'}
            position={['bottom', 'left', 'right', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={null}
            disableReposition
        >
            <OptionButton
                text={translate('Search')}
                icon="search"
                containerStyle={{ marginHorizontal: 8, marginBottom: 8 }}
                buttonStyle={localStyles.searchButton}
                iconColor="#ffffff"
                textStyle={localStyles.searchText}
                onPress={openModal}
                onLayout={onLayout}
                testID="assistant-task-search-button"
            />
        </AppPopover>
    )
}

const localStyles = {
    // Light blue with a pastel rim on the light card. In dark mode a solid primary blue: the
    // pastel rim glared and white text on the light blue was hard to read.
    searchButton: {
        backgroundColor: modeColor('#5AACFF', '#2F7CF6'),
        borderColor: modeColor('#A3D1FF', '#2F7CF6'),
    },
    searchText: {
        color: '#ffffff',
    },
}
