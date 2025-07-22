import React from 'react'
import { Text } from 'react-native'

import styles, { colors } from '../styles/global'

export default function VerticalEllipsis({ isSubtask, task }) {
    return (
        <Text
            style={[
                { alignSelf: 'baseline' },
                isSubtask ? styles.body2 : styles.body1,
                isSubtask && task.done && { color: colors.Text03 },
            ]}
        >
            ...
        </Text>
    )
}
