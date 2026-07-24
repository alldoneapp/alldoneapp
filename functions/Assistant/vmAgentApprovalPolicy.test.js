const { assessClaudeToolApproval } = require('./vmAgentApprovalPolicy')

describe('Claude VM auto-review approval policy', () => {
    test.each([
        ['Read', { file_path: '/home/user/repo/src/app.js' }],
        ['Edit', { file_path: '/home/user/repo/src/app.js' }],
        ['Write', { file_path: '/home/user/output/report.md' }],
        ['Bash', { command: 'npm test -- --runInBand' }],
        ['Bash', { command: 'npm install lodash' }],
        ['Bash', { command: 'git status --short' }],
        ['Bash', { command: 'git commit -am "Implement change"' }],
        ['WebSearch', { query: 'current documentation' }],
    ])('automatically approves routine %s work', (toolName, input) => {
        expect(assessClaudeToolApproval(toolName, input, '/home/user/repo')).toMatchObject({ autoApprove: true })
    })

    test.each([
        ['Bash', { command: 'git push origin main' }, 'publishing or destructive Git operation'],
        ['Bash', { command: 'rm -rf /home/user/repo' }, 'recursive or broad deletion'],
        ['Bash', { command: 'firebase deploy --only functions' }, 'deployment or cloud infrastructure mutation'],
        ['Bash', { command: 'curl -X POST https://example.com/items -d x=1' }, 'external HTTP mutation'],
        ['Bash', { command: 'cat .env.production' }, 'access to credentials or secret files'],
        ['Read', { file_path: '/home/user/repo/.env' }, 'access to credentials or secret files'],
        ['Write', { file_path: '/etc/profile' }, 'file mutation outside the working directory'],
        ['mcp__gmail__send_email', {}, 'unrecognized tool: mcp__gmail__send_email'],
    ])('escalates risky %s work', (toolName, input, reason) => {
        expect(assessClaudeToolApproval(toolName, input, '/home/user/repo')).toEqual({
            autoApprove: false,
            reason,
        })
    })
})
