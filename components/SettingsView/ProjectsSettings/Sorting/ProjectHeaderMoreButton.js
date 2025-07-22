import React, { useRef } from 'react'
import { StyleSheet } from 'react-native'

import MoreButtonWrapper from '../../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/MoreButtonWrapper'
import OrganizeModalItem from './OrganizeModalItem'

export default function ProjectHeaderMoreButton({ modalAlign, projectType }) {
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
            modalAlign={modalAlign}
        >
            <OrganizeModalItem shortcut="1" onPress={dismissModal} projectType={projectType} />
        </MoreButtonWrapper>
    )
}

const localStyles = StyleSheet.create({
    buttonStyle: {
        maxHeight: 20,
        maxWidth: 20,
        paddingVertical: 0,
        minHeight: 20,
    },
})
