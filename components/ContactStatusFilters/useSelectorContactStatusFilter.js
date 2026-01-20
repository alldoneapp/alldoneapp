import { useDispatch, useSelector } from 'react-redux'
import { clearContactStatusFilter, setContactStatusFilter } from '../../redux/actions'

export default function useSelectorContactStatusFilter() {
    const dispatch = useDispatch()
    const contactStatusFilter = useSelector(state => state.contactStatusFilter)

    const setFilter = statusId => {
        dispatch(setContactStatusFilter(statusId))
    }

    const clearFilter = () => {
        dispatch(clearContactStatusFilter())
    }

    return [contactStatusFilter, setFilter, clearFilter]
}
