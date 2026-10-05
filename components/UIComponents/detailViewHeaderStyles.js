import { StyleSheet } from 'react-native'

// DV metadata uses the available header width, independently of sidebar and
// viewport flags. Gaps leave no trailing tag margin to trigger an early wrap.
export default StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        minWidth: 0,
        alignItems: 'flex-start',
        columnGap: 8,
        rowGap: 12,
    },
    tagList: {
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        maxWidth: '100%',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        columnGap: 12,
        rowGap: 8,
    },
    projectTag: {
        flexShrink: 1,
        minWidth: 24,
        maxWidth: '100%',
    },
    primaryTags: {
        flexDirection: 'row',
        flexShrink: 1,
        minWidth: 0,
        maxWidth: '100%',
        columnGap: 12,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        flexShrink: 0,
        maxWidth: '100%',
        marginLeft: 'auto',
        rowGap: 8,
    },
})
