const fs = require('fs')
const path = require('path')

const source = fs.readFileSync(path.resolve(__dirname, 'TaskDetailedView.js'), 'utf8')

describe('AT-2533 moved task detailed-view handoff', () => {
    it('follows the server move marker into the target project before handling source deletion', () => {
        const markerBranch = source.match(
            /if \(task\?\.movingToOtherProjectId\) \{([\s\S]*?)\n        \}\n\n        if \(task == null\)/
        )?.[1]

        expect(markerBranch).toBeTruthy()
        expect(markerBranch).toMatch(/NavigationService\.navigate\('TaskDetailedView'/)
        expect(markerBranch).toMatch(/switchProject\(targetProject\.index\)/)
        expect(markerBranch).toMatch(/URLsTasks\.push\(/)
        expect(markerBranch).toMatch(/return/)
    })
})
