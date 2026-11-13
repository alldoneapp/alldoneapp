import { PROJECT_COLOR_SYSTEM, PROJECT_DARK_BORDER_CONTRAST, PROJECT_DARK_GOAL_BAR_CONTRAST } from './ProjectColors'
import Colors from '../Colors'
import { contrastRatio, resolveColor } from '../colorMode'

// The frame around a goal and its tasks and the goal progress fill are what give the open-tasks
// board its structure. With the plain adaptive tints a violet project's frame sat at 1.05:1 on the
// dark project card and the board looked like one flat surface.
describe('project structure colors', () => {
    const systems = Object.entries(PROJECT_COLOR_SYSTEM)

    it('keeps the light pastels in light mode', () => {
        systems.forEach(([, system]) => {
            expect(resolveColor(system.PROJECT_ITEM_SECTION_BORDER, 'light')).toBe(
                resolveColor(system.PROJECT_ITEM_SECTION_ACTIVE, 'light')
            )
            expect(resolveColor(system.PROJECT_GOAL_BAR, 'light')).toBe(
                resolveColor(system.PROJECT_ITEM_ACTIVE, 'light')
            )
            expect(resolveColor(system.PROJECT_GOAL_BOX_BORDER, 'light')).toBe(
                resolveColor(system.PROJECT_ITEM_SECTION_ITEM_ACTIVE, 'light')
            )
        })
        const violet = PROJECT_COLOR_SYSTEM[Colors.Marker_Violet_01]
        expect(resolveColor(violet.PROJECT_ITEM_SECTION_BORDER, 'light')).toBe(Colors.Marker_Violet_02)
    })

    it('draws the frame and the goal bar at a fixed contrast on the dark card for every project color', () => {
        expect(systems).toHaveLength(11)
        systems.forEach(([, system]) => {
            const card = resolveColor(system.PROJECT_ITEM_SECTION, 'dark')
            const border = contrastRatio(resolveColor(system.PROJECT_ITEM_SECTION_BORDER, 'dark'), card)
            const bar = contrastRatio(resolveColor(system.PROJECT_GOAL_BAR, 'dark'), card)
            expect(border).toBeGreaterThanOrEqual(PROJECT_DARK_BORDER_CONTRAST)
            expect(border).toBeLessThan(PROJECT_DARK_BORDER_CONTRAST + 0.1)
            expect(bar).toBeGreaterThanOrEqual(PROJECT_DARK_GOAL_BAR_CONTRAST)
            expect(bar).toBeLessThan(PROJECT_DARK_GOAL_BAR_CONTRAST + 0.1)
            // The frame has to stand out from the fill it runs along.
            expect(border).toBeGreaterThan(bar)
        })
    })
})
