import React, { useRef } from 'react'
import { StyleSheet } from 'react-native'

import MoreButtonWrapper from '../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/MoreButtonWrapper'
import OrganizeModalItem from './OrganizeModalItem'

export default function DateHeaderMoreButton() {
    const modalRef = useRef(null)

    const dismissModal = () => {
        modalRef.current.close()
    }

    return (
        <MoreButtonWrapper
            ref={modalRef}
            buttonStyle={localStyles.buttonStyle}
            shortcut="M"
            noBorder={true}
            iconSize={20}
        >
            <OrganizeModalItem shortcut="1" onPress={dismissModal} />
        </MoreButtonWrapper>
    )
}

const localStyles = StyleSheet.create({
    buttonStyle: {
        maxHeight: 24,
        maxWidth: 20,
        paddingVertical: 0,
        minHeight: 24,
    },
})
