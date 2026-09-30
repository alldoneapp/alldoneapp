/**
 * AT-2661: compare visible pixels, rather than the fraction of each card. A long
 * project filling the viewport should beat a small, fully visible project.
 * Read on opening so scrolling does not need Redux updates or observers.
 */
export function getMostVisibleTaskProjectId() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return null
    const viewport = document.getElementById('main-task-list-viewport')
    if (!viewport) return null

    const bounds = viewport.getBoundingClientRect()
    const visualViewport = window.visualViewport
    const top = Math.max(bounds.top, visualViewport?.offsetTop || 0)
    const bottom = Math.min(
        bounds.bottom,
        visualViewport ? visualViewport.offsetTop + visualViewport.height : window.innerHeight
    )
    const left = Math.max(bounds.left, visualViewport?.offsetLeft || 0)
    const right = Math.min(
        bounds.right,
        visualViewport ? visualViewport.offsetLeft + visualViewport.width : window.innerWidth
    )
    if (bottom <= top || right <= left) return null

    const visibleAreas = new Map()
    viewport.querySelectorAll('[data-task-project-id]').forEach(section => {
        const style = window.getComputedStyle(section)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return
        const rect = section.getBoundingClientRect()
        const height = Math.max(0, Math.min(rect.bottom, bottom) - Math.max(rect.top, top))
        const width = Math.max(0, Math.min(rect.right, right) - Math.max(rect.left, left))
        const projectId = section.dataset.taskProjectId
        visibleAreas.set(projectId, (visibleAreas.get(projectId) || 0) + height * width)
    })

    let mostVisibleProjectId = null
    let largestArea = 0
    visibleAreas.forEach((area, projectId) => {
        if (area > largestArea) {
            largestArea = area
            mostVisibleProjectId = projectId
        } else if (area === largestArea) {
            // Equal visibility does not establish a clear project context.
            mostVisibleProjectId = null
        }
    })
    return mostVisibleProjectId
}
