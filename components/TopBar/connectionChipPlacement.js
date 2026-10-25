/**
 * Where the connection status chip is allowed to live (AT-2426).
 *
 * The desktop `TopBar` is a single non-wrapping flex row in which NOTHING gives way:
 * react-native-web's base `View` sets `flexShrink: 0`, and every element in the row —
 * `HomeButton` 44, `XpBar` 212/145, `GoldArea` ~94, `TasksStatisticsArea` ~126,
 * `QuotaBar` ~135, `NotificationArea` a hard `width: 160` — is an incompressible box.
 * A labelled chip costs 141-183px including its 16px `marginLeft` — measured in Chromium
 * for "Slow connection" across en/de/es — and the row has no slack to pay for it. With
 * `justifyContent: 'space-between'` the overflow does not truncate anything; it pushes
 * `rightArea` — search, chat, the notification bell — past the right edge.
 *
 * `XpBar`'s manual `offSet` looks like the relief valve and is not one: it is computed
 * from `topBarWidth`, the container's OWN width, which does not change when the chip
 * appears inside it. So the chip is never budgeted for, and what actually pays for it is
 * the XP bar being squeezed toward a degenerate width.
 *
 * Hence the mobile treatment — below the header, stacked, with a row to itself — extends
 * to tablets. `smallScreen` is the band: content width <= `SCREEN_BREAKPOINT` (970),
 * i.e. roughly a <= 1233px window with the sidebar expanded. It is the app's existing
 * tablet flag — `TopBarStatisticArea` already switches to `XP_BAR_TABLET` on it — and it
 * covers every iPad in BOTH orientations, landscape included.
 *
 * The narrower `isMiddleScreen` (<= ~1052px) was measured and rejected: it leaves iPad
 * Air / Pro 11 landscape (1180 / 1194px) with the chip in the header, where it fits in
 * English with 4.75px to spare and does NOT fit in German — "Langsame Verbindung" is
 * 182.7px against 154.4px of slack. A breakpoint that is correct only in the shortest of
 * the three shipped languages is not correct. See `browser-tests/at2426/`, which measures
 * this in real Chromium across en/de/es rather than inferring it from font metrics.
 *
 * It is OR-ed with `smallScreenNavigation` rather than relying on set inclusion. The flag
 * does imply `smallScreen` arithmetically, but the two are written by SEPARATE
 * `store.dispatch` calls in `AppNavigator.onLayoutChange` (the nav flags go out in one
 * batch, `toggleSmallScreen` in its own call), so a resize has a render window in which
 * `smallScreenNavigation` is already true and `smallScreen` is not yet. Without the OR the
 * chip would be in neither placement for that frame — `TopBarMobile` never renders it, and
 * the stacked slot would not have turned on.
 *
 * Lives in its own module rather than on `ConnectionStatusChip` so that the two call
 * sites — `TopBar` and `MainViewsContainer`, in different trees — can share the rule
 * without the component itself becoming a dependency of every suite that only wants to
 * mock the chip away.
 *
 * Known and deliberately NOT addressed here (measured, pre-existing, unchanged by this
 * rule): between roughly 1234px and 1500px the header is at its tightest — `smallScreen`
 * has switched off, so the full-size XP bar and wide pills are back, while the horizontal
 * margins stay at 104px each. At 1280px the row has only ~23px of slack, so the chip
 * spills ~57px (en) / ~84px (de) past the padding edge, and at 1440px German still spills.
 * That band needs the header itself to give way and is its own piece of work.
 */
export const showConnectionChipBelowHeader = state => state.smallScreenNavigation || state.smallScreen
