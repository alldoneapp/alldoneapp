import React, { useEffect, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch } from 'react-redux'

import OptionButton from '../OptionButtons/OptionButton'
import AssistantTaskSearchModal from './AssistantTaskSearchModal'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import { colors } from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'

export default function AssistantTaskSearchButtonWrapper() {
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
        <Popover
            content={<AssistantTaskSearchModal closeModal={closeModal} />}
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
            />
        </Popover>
    )
}

const localStyles = {
    searchButton: {
        backgroundColor: colors.UtilityBlue200,
        borderColor: colors.UtilityBlue150,
    },
    searchText: {
        color: '#ffffff',
    },
}
