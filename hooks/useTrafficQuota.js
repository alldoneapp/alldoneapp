import { useSelector } from 'react-redux'
import {
    PERSONAL_TRAFFIC_QUOTE_LIMIT,
    PLAN_STATUS_FREE,
    PROJECT_TRAFFIC_QUOTE_LIMIT,
} from '../components/Premium/PremiumHelper'

export default function useTrafficQuota(projectId) {
    const monthlyTraffic = useSelector(state => state.loggedUser.monthlyTraffic)
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)
    const projectMonthlyTraffic = useSelector(state => state.loggedUserProjectsMap[projectId]?.monthlyTraffic)

    const limitedByTraffic =
        premiumStatus === PLAN_STATUS_FREE &&
        (monthlyTraffic >= PERSONAL_TRAFFIC_QUOTE_LIMIT || projectMonthlyTraffic >= PROJECT_TRAFFIC_QUOTE_LIMIT)

    return limitedByTraffic
}
