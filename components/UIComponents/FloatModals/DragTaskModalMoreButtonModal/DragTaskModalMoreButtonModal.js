import React from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import ModalHeader from '../ModalHeader'
import ModalItem from '../MorePopupsOfEditModals/Common/ModalItem'

export default function DragTaskModalMoreButtonModal({ closeModal, onPressDeleteButton, setShowHighlight }) {
    const renderItems = () => {
        const list = []

        list.push(shortcut => {
            return (
                <ModalItem
                    key={'mbtn-highlight'}
                    icon="highlight"
                    text="Highlight"
                    shortcut={shortcut}
                    onPress={() => {
                        setShowHighlight(true)
                    }}
                />
            )
        })
        list.push(shortcut => {
            return (
                <ModalItem
                    key={'mbtn-delete'}
                    icon="trash-2"
                    text="Delete"
                    shortcut={shortcut}
                    onPress={() => {
                        closeModal()
                        onPressDeleteButton()
                    }}
                />
            )
        })

        return list
    }

    return (
        <View>
            <View style={[localStyles.container, applyPopoverWidth()]}>
                <ModalHeader closeModal={closeModal} title="More options" />
                {renderItems().map((item, index) => item((index + 1).toString()))}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
        padding: 16,
        paddingBottom: 8,
    },
})
