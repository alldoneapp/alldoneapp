import React, { useState, useEffect } from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
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

    const onKeyDown = event => {
        if (showHighlight && event.key === 'Escape') {
            closeModal()
        }
    }

    useEffect(() => {
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
        }
    })

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
        <Popover
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
        </Popover>
    )
}
