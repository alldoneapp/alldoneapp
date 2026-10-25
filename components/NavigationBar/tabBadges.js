import { DV_TAB_SETTINGS_INTEGRATIONS, DV_TAB_SETTINGS_INVITATIONS } from '../../utils/TabNavigationConstants'

/**
 * Which attention count, if any, belongs on a given navigation tab.
 *
 * Pending project invitations were the only source until AT-2491 added broken email/calendar
 * connections: an account whose OAuth grant dies is otherwise invisible unless you happen to
 * open Settings > Integrations, and one sat dead for four days in production before anybody
 * noticed.
 *
 * Its own module rather than a NavigationBar export because NavigationBar transitively pulls
 * in Button → GoalProgress → BackendBridge → the Firebase client, which cannot be imported
 * under jest.
 */
export function resolveTabBadgeAmount(tabItem, { invitationsAmount = 0, integrationsAlertAmount = 0 } = {}) {
    if (tabItem === DV_TAB_SETTINGS_INVITATIONS) return invitationsAmount > 0 ? invitationsAmount : 0
    if (tabItem === DV_TAB_SETTINGS_INTEGRATIONS) return integrationsAlertAmount > 0 ? integrationsAlertAmount : 0
    return 0
}
