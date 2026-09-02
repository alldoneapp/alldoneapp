import { DV_TAB_SETTINGS_INTEGRATIONS, DV_TAB_SETTINGS_INVITATIONS } from '../../utils/TabNavigationConstants'
import { resolveTabBadgeAmount } from './tabBadges'

describe('resolveTabBadgeAmount (AT-2491)', () => {
    test('badges the Integrations tab with the number of broken connections', () => {
        // Without this, a dead account is invisible unless the user happens to open the tab.
        expect(resolveTabBadgeAmount(DV_TAB_SETTINGS_INTEGRATIONS, { integrationsAlertAmount: 2 })).toBe(2)
    })

    test('leaves the Integrations tab clean when every account works', () => {
        expect(resolveTabBadgeAmount(DV_TAB_SETTINGS_INTEGRATIONS, { integrationsAlertAmount: 0 })).toBe(0)
        expect(resolveTabBadgeAmount(DV_TAB_SETTINGS_INTEGRATIONS)).toBe(0)
    })

    test('keeps the pre-existing invitations badge working', () => {
        expect(resolveTabBadgeAmount(DV_TAB_SETTINGS_INVITATIONS, { invitationsAmount: 3 })).toBe(3)
    })

    test('does not leak one tab’s count onto the other', () => {
        expect(resolveTabBadgeAmount(DV_TAB_SETTINGS_INVITATIONS, { integrationsAlertAmount: 5 })).toBe(0)
        expect(resolveTabBadgeAmount(DV_TAB_SETTINGS_INTEGRATIONS, { invitationsAmount: 5 })).toBe(0)
    })

    test('badges no other tab', () => {
        expect(resolveTabBadgeAmount('Profile', { invitationsAmount: 4, integrationsAlertAmount: 4 })).toBe(0)
    })
})
