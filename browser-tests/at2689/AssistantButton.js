import React from 'react'
import { TouchableOpacity, View } from 'react-native'
import { colors } from '../../components/styles/global'

// Same dimensions as DvBotButton; avoid assistant/thread Firestore subscriptions.
export default function AssistantButton({ style }) {
    return (
        <TouchableOpacity
            accessibilityLabel="Assistant"
            onPress={() => {
                window.__assistantOpened = true
            }}
            style={[
                {
                    minHeight: 32,
                    maxHeight: 32,
                    borderWidth: 1,
                    borderRadius: 4,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingVertical: 7,
                    paddingHorizontal: 7,
                    marginRight: 8,
                    borderColor: colors.Gray400,
                },
                style,
            ]}
        >
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#8A94A6' }} />
        </TouchableOpacity>
    )
}
