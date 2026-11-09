// MCP feed parity (goals, milestones, OKRs, wiki sources): the feed layers are tested on their own
// (goalToolFeeds, okrToolFeeds, knowledgeWikiFeed); this pins that the shared tool entry point and the
// OKR trigger actually hand them over. A dropped `feeds` argument fails nothing else: the tool still
// succeeds and Updates silently stays empty.
const fs = require('fs')
const path = require('path')

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const between = (source, start, end) => {
    const from = source.indexOf(start)
    expect(from).toBeGreaterThan(-1)
    const to = source.indexOf(end, from)
    expect(to).toBeGreaterThan(from)
    return source.slice(from, to)
}

describe('the goal, OKR and wiki tools write their Updates entries', () => {
    const helper = read('Assistant/assistantHelper.js')

    test('update_milestone gets the same feeds as create_goal and update_goal', () => {
        const block = between(helper, "case 'update_milestone': {", "case 'delete_contact':")
        expect(block).toMatch(/const feeds = buildGoalToolFeeds\(/)
        expect(between(block, 'result = await updateMilestone({', '} else {')).toMatch(/^\s+feeds,$/m)
    })

    test('create_okr and update_okr get OKR feeds with the tool actor', () => {
        const block = between(helper, "case 'create_okr':", "case 'update_user_memory':")
        expect(block).toMatch(/getAssistantFeedUserForTool\(/)
        expect(block).toMatch(/buildOkrToolFeeds\(\{ db, projectId: project.id, feedUser, userId: creatorId \}\)/)
        expect(block).toMatch(/await run\(\{[^}]*\bfeeds \}\)/)
    })

    test('the wiki tools record a source change with the tool actor', () => {
        const block = between(helper, 'recordWikiSourceChange: async', "if (toolName === 'highlight_workspace')")
        expect(block).toMatch(/getAssistantFeedUserForTool\(/)
        expect(block).toMatch(/publishWikiSourceFeed\(/)
    })

    test("an OKR's privacy change reaches its entries on the project", () => {
        const index = read('index.js')
        const trigger = between(
            index,
            'exports.onUpdateOkrAccessProjectionSecondGen',
            'exports.onCreateProjectFeedAccessProjectionSecondGen'
        )
        expect(trigger).toMatch(/reconcileOkrFeedPrivacy\(event\)/)
        expect(trigger).toMatch(/reconcileOkrFeedPrivacyOnUpdate\(/)
    })
})
