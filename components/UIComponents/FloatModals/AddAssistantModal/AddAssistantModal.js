import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { translate } from '../../../../i18n/TranslationService'
import AddAssistant from './AddAssistant'
import AssistantsArea from './AssistantsArea'
import { getSafeAreaModalMaxHeight } from '../../../../utils/modalSafeArea'

export default function AddAssistantModal({ closeModal, project }) {
    const [width, height] = useWindowSize()
    const inputRef = useRef()

    const onKeyDown = e => {
        if (!inputRef?.current?.isFocused()) {
            if (e.key === 'Escape') {
                closeModal()
            }
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    return (
        <View>
            <View
                style={[localStyles.container, applyPopoverWidth(), { maxHeight: getSafeAreaModalMaxHeight(height) }]}
            >
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Add assistant')}
                        description={translate('Add the assistant using a template or create a completely new one')}
                        disabledEscape={true}
                    />
                    <AddAssistant inputRef={inputRef} projectId={project.id} closeModal={closeModal} />
                    <AssistantsArea closeModal={closeModal} project={project} />
                </CustomScrollView>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
})
