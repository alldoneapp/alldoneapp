import { StyleSheet } from 'react-native'

import { colors } from '../../styles/global'

export const taskEditorLayout = StyleSheet.create({
    addTaskSection: {
        paddingHorizontal: 8,
    },
    inlineEditor: {
        flex: 1,
        marginLeft: -16,
        marginRight: -16,
        marginBottom: 0,
        backgroundColor: 'transparent',
        borderWidth: 0,
        borderRadius: 0,
        boxShadow: '0px 0px 0px rgba(0,0,0,0.00)',
        elevation: 0,
    },
    actionBar: {
        flex: 1,
        height: 55,
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: colors.Grey100,
        borderTopWidth: 1,
        borderStyle: 'solid',
        borderTopColor: colors.Gray300,
        paddingVertical: 7,
        paddingHorizontal: 9,
    },
    inlineActionBar: {
        marginHorizontal: 8,
        borderBottomLeftRadius: 4,
        borderBottomRightRadius: 4,
    },
})
