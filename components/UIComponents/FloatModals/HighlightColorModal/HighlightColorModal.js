import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../../../styles/global'
import ColorItem from './ColorItem'
import { BACKGROUND_COLORS } from '../../../../utils/ColorConstants'
import useWindowSize from '../../../../utils/useWindowSize'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import CustomScrollView from '../../../UIControls/CustomScrollView'

export default function HighlightColorModal({
    onPress,
    selectedColor = BACKGROUND_COLORS[0].color,
    responsive = false,
    closeModal,
}) {
    const [width, height] = useWindowSize()

    const onKeyDown = event => {
        if (event.key === 'Escape' && closeModal) {
            closeModal()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View
            style={[
                localStyles.container,
                responsive && { ...applyPopoverWidth(), maxHeight: height - MODAL_MAX_HEIGHT_GAP },
            ]}
        >
            <CustomScrollView showsVerticalScrollIndicator={false}>
                {BACKGROUND_COLORS.map(item => (
                    <ColorItem
                        key={item.name}
                        data={item}
                        selectedColor={selectedColor}
                        onPress={onPress}
                        closeModal={closeModal}
                    />
                ))}
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 187,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
})
