import { useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { addHashtagFilters, clearHashtagFilters, removeHashtagFilters } from '../../redux/actions'

export default function useSelectorHashtagFilters() {
    const dispatch = useDispatch()
    const hashtagFilters = useSelector(state => state.hashtagFilters)
    const hashtagFiltersArray = useMemo(() => Array.from(hashtagFilters.keys()), [hashtagFilters])

    const addToFilters = hashtag => {
        dispatch(addHashtagFilters(hashtag))
    }

    const removeFromFilters = hashtag => {
        dispatch(removeHashtagFilters(hashtag))
    }

    const clearFilters = () => {
        dispatch(clearHashtagFilters())
    }

    return [hashtagFilters, hashtagFiltersArray, addToFilters, removeFromFilters, clearFilters]
}
