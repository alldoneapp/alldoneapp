import React, { useState } from 'react'
import { View } from 'react-native'
import AppPopover from '../../ModalShell/AppPopover'
import DragTaskModalMoreButtonModal from './DragTaskModalMoreButtonModal'
import MoreButton from '../MorePopupsOfEditModals/Common/MoreButton'
import { useSelector } from 'react-redux'
import HighlightColorModal from '../HighlightColorModal/HighlightColorModal'

export default function DragTaskModalMoreButtonWrapperjs({
    disabled,
    onPressDeleteButton,
    selectedColor,
    setHighlight,
    setOpenMoreOptions,
    openMoreOptions,
}) {
    const smallScreen = useSelector(state => state.smallScreen)
    const [showHighlight, setShowHighlight] = useState(false)

    const openModal = () => {
        setShowHighlight(false)
        setOpenMoreOptions(true)
    }

    const closeModal = () => {
        setTimeout(() => {
            setOpenMoreOptions(false)
        })
    }

    return (
        <AppPopover
            content={
                <View key={openMoreOptions}>
                    {showHighlight ? (
                        <HighlightColorModal
                            onPress={(event, data) => {
                                setHighlight(data.color)
                                closeModal()
                            }}
                            selectedColor={selectedColor}
                        />
                    ) : (
                        <DragTaskModalMoreButtonModal
                            onPressDeleteButton={onPressDeleteButton}
                            closeModal={closeModal}
                            setShowHighlight={setShowHighlight}
                        />
                    )}
                </View>
            }
            onClickOutside={closeModal}
            isOpen={openMoreOptions}
            position={['top', 'left', 'right', 'bottom']}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <MoreButton noBorder={true} onPress={openModal} disabled={disabled} iconColor="#ffffff" />
        </AppPopover>
    )
}
