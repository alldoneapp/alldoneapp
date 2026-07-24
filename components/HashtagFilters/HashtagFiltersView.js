import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import useSelectorHashtagFilters from './UseSelectorHashtagFilters'
import TagItem from './TagItem'
import ClearAllFilters from './ClearAllFilters'

export default function HashtagFiltersView({ handleSpaces }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const currentUserUid = useSelector(state => state.currentUser.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const [filters, filtersArray, addToFilters, removeFromFilters, clearFilters] = useSelectorHashtagFilters()

    useEffect(() => {
        return () => {
            clearFilters()
        }
    }, [])

    useEffect(() => {
        filtersArray.length > 0 && clearFilters()
    }, [currentUserUid, selectedProjectIndex])

    return filtersArray.length > 0 ? (
        <View
            style={[
                localStyles.container,
                handleSpaces &&
                    (smallScreenNavigation
                        ? localStyles.containerMobile
                        : isMiddleScreen
                        ? localStyles.containerTablet
                        : localStyles.containerDesktop),
            ]}
        >
            {filtersArray.map(hashtag => (
                <TagItem
                    key={hashtag}
                    text={hashtag}
                    colorKey={filters.get(hashtag)}
                    onPress={() => removeFromFilters(hashtag)}
                    containerStyle={localStyles.tag}
                />
            ))}

            {filtersArray.length > 1 && <ClearAllFilters onPress={() => clearFilters()} />}
        </View>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 8,
    },
    tag: {
        marginRight: 8,
    },
    containerMobile: {
        paddingHorizontal: 16,
    },
    containerTablet: {
        paddingHorizontal: 56,
    },
    containerDesktop: {
        paddingHorizontal: 104,
    },
})
