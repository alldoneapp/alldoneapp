import { StyleSheet } from 'react-native'

export const taskPresentationLayout = StyleSheet.create({
    container: {
        justifyContent: 'center',
        marginLeft: -16,
        marginRight: -16,
    },
    taskRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        marginHorizontal: 8,
        borderRadius: 4,
    },
    leadingContent: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
    },
})
