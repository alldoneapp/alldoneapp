const path = require('path')

const SAFE_CLAUDE_TOOLS = new Set([
    'Read',
    'Glob',
    'Grep',
    'LS',
    'Edit',
    'Write',
    'MultiEdit',
    'NotebookEdit',
    'WebFetch',
    'WebSearch',
    'Task',
    'TaskOutput',
    'TodoRead',
    'TodoWrite',
])

const FILE_MUTATION_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SENSITIVE_PATH_PATTERN = /(^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$)|\.aws(?:\/|$)|\.config\/gcloud(?:\/|$)|service_accounts?(?:\/|$)|credentials?(?:\.|\/|$)|secrets?(?:\.|\/|$)|auth\.json$)/i
const SENSITIVE_COMMAND_PATH_PATTERN = /(?:^|[\s'"=])(?:\.env(?:\.[^\s'"]*)?|~?\/\.ssh(?:\/|\s|$)|~?\/\.aws(?:\/|\s|$)|~?\/\.config\/gcloud(?:\/|\s|$)|service_accounts?(?:\/|\s|$)|credentials?(?:\.|\/|\s|$)|secrets?(?:\.|\/|\s|$)|auth\.json\b)/i

const RISKY_COMMAND_RULES = [
    { pattern: /\bsudo\b|\bsu\s+-|\bssh\b|\bscp\b|\bsftp\b/i, reason: 'remote or elevated shell access' },
    {
        pattern: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|\bfind\b[^\n]*\s-delete\b/i,
        reason: 'recursive or broad deletion',
    },
    {
        pattern: /\bgit\s+(?:push\b|reset\s+--hard\b|clean\s+-[a-z]*f|branch\s+-D\b)|\bgh\s+pr\s+(?:create|merge|close)\b|\bglab\s+mr\s+(?:create|merge|close)\b/i,
        reason: 'publishing or destructive Git operation',
    },
    {
        pattern: /\b(?:npm|pnpm|yarn)\s+publish\b|\bdocker\s+push\b|\btwine\s+upload\b/i,
        reason: 'publishing a package or image',
    },
    {
        pattern: /\b(?:firebase|vercel|netlify|wrangler)\s+deploy\b|\bgcloud\b[^\n]*\b(?:deploy|delete|create|update|set-iam-policy|add-iam-policy-binding)\b|\bkubectl\s+(?:apply|create|delete|patch|replace|rollout|scale)\b|\bterraform\s+(?:apply|destroy|import)\b/i,
        reason: 'deployment or cloud infrastructure mutation',
    },
    {
        pattern: /\baws\b[^\n]*\b(?:create|delete|put|update|terminate|run-instances|s3\s+(?:cp|mv|rm|sync))\b|\baz\b[^\n]*\b(?:create|delete|update|deployment)\b/i,
        reason: 'cloud infrastructure or storage mutation',
    },
    {
        pattern: /\bcurl\b[^\n]*(?:(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b|(?:--data(?:-raw|-binary)?|-d|-F|--form|--upload-file|-T)\s)|\bwget\b[^\n]*(?:--post-data|--post-file)\b|\bhttp\s+(?:POST|PUT|PATCH|DELETE)\b/i,
        reason: 'external HTTP mutation',
    },
    {
        pattern: /\b(?:psql|mysql|mongosh?|redis-cli)\b[^\n]*\b(?:drop|delete|truncate|update|insert|flushall)\b/i,
        reason: 'external data mutation',
    },
    {
        pattern: /\bmkfs(?:\.|\s)|\bdd\s+[^\n]*\bof=|:\(\)\s*\{\s*:\|:&\s*\};:/i,
        reason: 'destructive system operation',
    },
]

function normalizeToolPath(value, cwd) {
    if (typeof value !== 'string' || !value.trim()) return ''
    return path.resolve(cwd || '/home/user', value.trim())
}

function findToolPath(toolInput = {}, cwd = '/home/user') {
    const value =
        toolInput.file_path ||
        toolInput.filePath ||
        toolInput.notebook_path ||
        toolInput.notebookPath ||
        toolInput.path ||
        ''
    return normalizeToolPath(value, cwd)
}

function isPathWithin(candidate, root) {
    if (!candidate || !root) return false
    const relative = path.relative(path.resolve(root), path.resolve(candidate))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function assessClaudeToolApproval(toolName, toolInput = {}, cwd = '/home/user') {
    if (toolName === 'Bash') {
        const command = String(toolInput.command || '')
        const normalizedCommand = command.replace(/\\/g, '/')
        if (SENSITIVE_PATH_PATTERN.test(normalizedCommand) || SENSITIVE_COMMAND_PATH_PATTERN.test(normalizedCommand)) {
            return { autoApprove: false, reason: 'access to credentials or secret files' }
        }
        const riskyRule = RISKY_COMMAND_RULES.find(rule => rule.pattern.test(command))
        return riskyRule
            ? { autoApprove: false, reason: riskyRule.reason }
            : { autoApprove: true, reason: 'ordinary command inside the isolated VM' }
    }

    if (!SAFE_CLAUDE_TOOLS.has(toolName)) {
        return { autoApprove: false, reason: `unrecognized tool: ${toolName}` }
    }

    const toolPath = findToolPath(toolInput, cwd)
    if (toolPath && SENSITIVE_PATH_PATTERN.test(toolPath.replace(/\\/g, '/'))) {
        return { autoApprove: false, reason: 'access to credentials or secret files' }
    }
    if (
        FILE_MUTATION_TOOLS.has(toolName) &&
        toolPath &&
        ![cwd, '/home/user/output', '/tmp'].some(root => isPathWithin(toolPath, root))
    ) {
        return { autoApprove: false, reason: 'file mutation outside the working directory' }
    }

    return { autoApprove: true, reason: 'routine read or workspace operation' }
}

module.exports = {
    SAFE_CLAUDE_TOOLS,
    SENSITIVE_PATH_PATTERN,
    SENSITIVE_COMMAND_PATH_PATTERN,
    RISKY_COMMAND_RULES,
    assessClaudeToolApproval,
    isPathWithin,
}
