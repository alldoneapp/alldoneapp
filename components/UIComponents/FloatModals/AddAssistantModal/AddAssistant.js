import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import AddAssistanPlaceholder from './AddAssistanPlaceholder'
import CreateAssistant from './CreateAssistant'

export default function AddAssistant({ inputRef, projectId, closeModal }) {
    const [isOpen, setIsOpen] = useState(false)

    const openInput = () => {
        setIsOpen(true)
    }

    const closeInput = () => {
        setIsOpen(false)
    }

    return (
        <View style={[isOpen && localStyles.container]}>
            {isOpen ? (
                <CreateAssistant
                    inputRef={inputRef}
                    projectId={projectId}
                    closeModal={closeModal}
                    closeInput={closeInput}
                />
            ) : (
                <AddAssistanPlaceholder onPress={openInput} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 16,
    },
})
