const path = require('path')

// Approval strictness presets for interactive VM runs.
//
//   strict      - pause on every publishing, deployment or outbound-write operation.
//                 This is the original behaviour and stays available as a per-run override
//                 for sensitive work.
//   balanced    - the default. Auto-approve the operations the platform itself instructs the
//                 agent to perform (push a feature branch, open an MR/PR) and read-shaped API
//                 calls, while still pausing for anything that lands on the base branch,
//                 merges, deployments, secrets and destructive operations.
//   permissive  - balanced, plus merging an MR/PR and arbitrary outbound HTTP. Secrets,
//                 pushing the base branch, deployments and destructive system operations
//                 still pause.
//
// Regardless of level, downloading and executing a remote script always pauses - that means the
// fetched bytes actually becoming the running program (`curl … | bash`, `bash -c "$(curl …)"`),
// not merely piping a fetch into a tool. Piping a download into an interpreter that was given its
// own inline program (`curl … | python3 -c '…'`) is data handling and follows the level.
//
// Deployment note: this module does NOT run in the Firebase Functions runtime. It is copied
// verbatim into the sandbox as `approval-policy.cjs` by `prepareVmAgentBridge` and evaluated in
// the Agent SDK's `canUseTool` hook, so it ships inside the `vm-job-runner` Cloud Run image.
// A change here only takes effect once `deploy:cloud:runner:production` has rebuilt that image --
// deploying functions alone leaves the old policy live. Both CI jobs are gated on
// `changes: functions/**/*`, so a pipeline cancelled before the deploy stage (for example when a
// later merge supersedes it) silently leaves this file merged but not deployed; verify the runner
// job actually ran rather than trusting the merge.
const APPROVAL_POLICY_LEVELS = ['strict', 'balanced', 'permissive']
const DEFAULT_APPROVAL_POLICY_LEVEL = 'balanced'

function isValidApprovalPolicyLevel(level) {
    return APPROVAL_POLICY_LEVELS.includes(level)
}

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
const SENSITIVE_PATH_PATTERN =
    /(^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$)|\.aws(?:\/|$)|\.config\/gcloud(?:\/|$)|service_accounts?(?:\/|$)|credentials?(?:\.|\/|$)|secrets?(?:\.|\/|$)|auth\.json$)/i
const SENSITIVE_COMMAND_PATH_PATTERN =
    /(?:^|[\s'"=])(?:\.env(?:\.[^\s'"]*)?|~?\/\.ssh(?:\/|\s|$)|~?\/\.aws(?:\/|\s|$)|~?\/\.config\/gcloud(?:\/|\s|$)|service_accounts?(?:\/|\s|$)|credentials?(?:\.|\/|\s|$)|secrets?(?:\.|\/|\s|$)|auth\.json\b)/i

// Fetch-and-execute in a single pipeline. Previously auto-approved: the old policy only looked
// for HTTP *mutation* flags, so `curl -fsSL https://x/y.sh | bash` - remote code execution -
// passed while reading your own Cloud Logging paused. Always escalates, at every level.
//
// AT-2235: matching the *shape* `curl … | <interpreter>` was too blunt. What makes this remote
// code execution is that the fetched bytes become the program. When the interpreter is handed its
// own inline program (`python3 -c …`, `node -e …`, `jq`-style filtering, `bash -c …`) or a local
// script file, the downloaded bytes are ordinary stdin *data* and nothing remote is executed - yet
// `curl "…/pipelines/123" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])"`
// escalated on a `permissive` run, which cannot be overridden because this rule always escalates.
// Detection is therefore structural (`detectRemoteScriptExecution`): a pipeline segment counts
// only when the interpreter would actually read its program from stdin. The pattern below is kept
// as the cheap pre-filter for the pipe shape, and the structural pass decides.
const REMOTE_EXECUTION_PATTERN =
    /\b(?:curl|wget)\b[^;&\n]*\|\s*[^|;&\n]*\b(?:bash|sh|zsh|fish|dash|ksh|ash|python[0-9.]*|node|nodejs|bun|deno|perl|ruby|php)\b/i

// Command/process substitution feeding an interpreter - `bash -c "$(curl …)"`, `eval $(curl …)`,
// `bash <(curl …)`, `source /dev/stdin`. Real remote code execution with no pipe in sight, so the
// old pipe-only pattern never saw it. Escalates at every level, like the pipe form.
const REMOTE_SUBSTITUTION_PATTERN = /(?:\$\(|<\(|`)\s*(?:sudo\s+)?(?:curl|wget)\b/i

// Interpreters that execute their standard input as a program when they are not given one.
const INTERPRETER_FAMILY_PATTERNS = [
    [/^(?:bash|sh|zsh|fish|dash|ksh|ash)$/i, 'shell'],
    [/^python[0-9.]*$/i, 'python'],
    [/^(?:node|nodejs|bun|deno)$/i, 'node'],
    [/^perl[0-9.]*$/i, 'perl'],
    [/^ruby[0-9.]*$/i, 'ruby'],
    [/^php[0-9.]*$/i, 'php'],
]

// Flags that supply the program inline, i.e. the fetched bytes are data, not code.
const INTERPRETER_INLINE_CODE_FLAGS = {
    shell: ['-c'],
    python: ['-c', '-m'],
    node: ['-e', '--eval', '-p', '--print'],
    perl: ['-e', '-E'],
    ruby: ['-e'],
    php: ['-r'],
}

// An inline program can still hand stdin to an evaluator (`python3 -c 'exec(sys.stdin.read())'`,
// `bash -c 'source /dev/stdin'`). That is fetch-and-execute again, so it keeps escalating.
const INLINE_CODE_EVALUATES_STDIN_PATTERN =
    /\b(?:eval|exec|execfile|system|source|compile|Function)\b[^\n]{0,160}?(?:\bstdin\b|\/dev\/stdin|\bcat\b|<&\s*0)|(?:^|[\s;&(])\.\s+\/dev\/stdin\b/i

const REMOTE_FETCH_PATTERN = /\b(?:curl|wget)\b/i

// Read-shaped HTTPS endpoints that must be called with POST + a request body. These are the
// reason the original policy was so noisy: Alldone's own VM prompt instructs the agent to read
// Cloud Logging and Firestore through exactly these, and `-X POST`/`-d` made them look like
// mutations.
const READ_ONLY_ENDPOINT_PATTERNS = [
    /firestore\.googleapis\.com[^\s'"]*:(?:runQuery|runAggregationQuery|listDocuments|listCollectionIds|batchGet)\b/i,
    /logging\.googleapis\.com[^\s'"]*\/entries:list\b/i,
    /monitoring\.googleapis\.com[^\s'"]*\/timeSeries:list\b/i,
]

const HTTP_WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const HTTP_READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Risky command rules that are independent of the Git/HTTP structural analysis below.
const RISKY_COMMAND_RULES = [
    {
        key: 'shell_access',
        pattern: /\bsudo\b|\bsu\s+-|\bssh\b|\bscp\b|\bsftp\b/i,
        reason: 'remote or elevated shell access',
    },
    {
        key: 'destructive_delete',
        pattern: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|\bfind\b[^\n]*\s-delete\b/i,
        reason: 'recursive or broad deletion',
    },
    {
        key: 'package_publish',
        pattern: /\b(?:npm|pnpm|yarn)\s+publish\b|\bdocker\s+push\b|\btwine\s+upload\b/i,
        reason: 'publishing a package or image',
    },
    {
        key: 'deployment',
        pattern:
            /\b(?:firebase|vercel|netlify|wrangler)\s+deploy\b|\bgcloud\b[^\n]*\b(?:deploy|delete|create|update|set-iam-policy|add-iam-policy-binding)\b|\bkubectl\s+(?:apply|create|delete|patch|replace|rollout|scale)\b|\bterraform\s+(?:apply|destroy|import)\b/i,
        reason: 'deployment or cloud infrastructure mutation',
    },
    {
        key: 'cloud_mutation',
        pattern:
            /\baws\b[^\n]*\b(?:create|delete|put|update|terminate|run-instances|s3\s+(?:cp|mv|rm|sync))\b|\baz\b[^\n]*\b(?:create|delete|update|deployment)\b/i,
        reason: 'cloud infrastructure or storage mutation',
    },
    {
        key: 'data_mutation',
        pattern: /\b(?:psql|mysql|mongosh?|redis-cli)\b[^\n]*\b(?:drop|delete|truncate|update|insert|flushall)\b/i,
        reason: 'external data mutation',
    },
    {
        key: 'destructive_system',
        pattern: /\bmkfs(?:\.|\s)|\bdd\s+[^\n]*\bof=|:\(\)\s*\{\s*:\|:&\s*\};:/i,
        reason: 'destructive system operation',
    },
]

// Git operations that rewrite or discard history.
const DESTRUCTIVE_GIT_PATTERN = /\bgit\s+(?:reset\s+--hard\b|clean\s+-[a-z]*f|branch\s+-D\b|filter-branch\b)/i

function splitCommandPipeline(command) {
    // Split on shell separators while keeping quoted sections intact, remembering which separator
    // introduced each segment. This is deliberately approximate: it exists so that a risky-looking
    // token inside an unrelated argument cannot condemn the whole command line (the old policy
    // matched raw substrings over the entire command, so a diagnostic like `node -e "...git
    // push..."` was escalated as a publish), and so that a real pipe - the only separator that
    // makes one command's output another's input - can be told apart from `;`, `&&` and `||`.
    const segments = []
    let current = ''
    let separatorBefore = ''
    let quote = null
    const push = separatorAfter => {
        const text = current.trim()
        if (text) segments.push({ text, separatorBefore })
        current = ''
        separatorBefore = separatorAfter
    }
    for (let i = 0; i < command.length; i += 1) {
        const char = command[i]
        if (quote) {
            current += char
            if (char === quote && command[i - 1] !== '\\') quote = null
            continue
        }
        if (char === '"' || char === "'") {
            quote = char
            current += char
            continue
        }
        if (char === '|' || char === '&') {
            const doubled = command[i + 1] === char
            push(doubled ? `${char}${char}` : char)
            if (doubled) i += 1
            continue
        }
        if (char === ';' || char === '\n') {
            push(char)
            continue
        }
        current += char
    }
    push('')
    return segments
}

function splitCommandSegments(command) {
    return splitCommandPipeline(command).map(segment => segment.text)
}

function tokenize(segment) {
    const tokens = segment.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) || []
    return tokens.map(token => token.replace(/^['"]|['"]$/g, ''))
}

function stripEnvPrefix(tokens) {
    let index = 0
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1
    if (tokens[index] === 'env') index += 1
    return tokens.slice(index)
}

function normalizeBranchRef(ref) {
    if (!ref) return ''
    return String(ref)
        .replace(/^\+/, '')
        .split(':')
        .pop()
        .replace(/^refs\/heads\//, '')
        .trim()
}

// `sudo bash` is still `bash`, and it must be recognised as remote execution rather than fall
// through to the (allowlistable) elevated-shell rule.
function stripPrivilegePrefix(tokens) {
    let index = 0
    while (['sudo', 'command', 'nohup', 'exec', 'stdbuf'].includes(path.basename(tokens[index] || ''))) {
        index += 1
        while (index < tokens.length && tokens[index].startsWith('-')) index += 1
    }
    return tokens.slice(index)
}

function interpreterFamily(program) {
    const match = INTERPRETER_FAMILY_PATTERNS.find(([pattern]) => pattern.test(program))
    return match ? match[1] : null
}

/**
 * Would this interpreter invocation read the program it runs from standard input?
 *
 * `python3 -c "..."`, `python3 -m json.tool`, `node -e "..."`, `bash -c "..."` and `bash script.sh`
 * all run a program that is already on the machine; anything arriving on stdin is data. A bare
 * `python3`/`bash`/`node`, or an explicit stdin operand (`-`, `bash -s`), executes stdin itself.
 */
function interpreterExecutesStdin(tokens, segment) {
    const family = interpreterFamily(path.basename(tokens[0] || ''))
    if (!family) return false

    const inlineFlags = INTERPRETER_INLINE_CODE_FLAGS[family] || []
    let hasInlineCode = false
    let hasScriptOperand = false
    let readsStdinExplicitly = false

    const args = tokens.slice(1)
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]
        if (arg === '-' || arg === '/dev/stdin') {
            readsStdinExplicitly = true
            continue
        }
        // `bash -s`, `sh -es` - "read the script from standard input".
        if (family === 'shell' && /^-[a-z]*s[a-z]*$/.test(arg)) {
            readsStdinExplicitly = true
            continue
        }
        const exactFlag = inlineFlags.includes(arg)
        if (exactFlag) {
            hasInlineCode = true
            i += 1 // the program text is the next token
            continue
        }
        if (inlineFlags.some(flag => arg.startsWith(`${flag}=`))) {
            hasInlineCode = true
            continue
        }
        // Short flag with the code attached, e.g. `-e'console.log(1)'`.
        if (inlineFlags.some(flag => flag.length === 2 && arg.length > 2 && arg.startsWith(flag))) {
            hasInlineCode = true
            continue
        }
        if (arg.startsWith('-')) continue
        hasScriptOperand = true
    }

    if (readsStdinExplicitly) return true
    if (hasInlineCode && INLINE_CODE_EVALUATES_STDIN_PATTERN.test(segment)) return true
    return !hasInlineCode && !hasScriptOperand
}

function isInterpreterInvocation(tokens) {
    const program = path.basename(tokens[0] || '')
    return interpreterFamily(program) !== null || program === 'eval' || program === 'source' || program === '.'
}

/**
 * Fetch-and-execute detection: remote bytes that become the running program.
 *
 * Walks the pipeline so that "output of a fetch" can be followed through pass-through stages
 * (`curl … | tee /tmp/x | bash`), and resets at separators that are not pipes (`curl … || bash`
 * runs a local shell, it does not execute the download).
 */
function detectRemoteScriptExecution(command) {
    if (!REMOTE_EXECUTION_PATTERN.test(command) && !REMOTE_SUBSTITUTION_PATTERN.test(command)) return false

    let carriesRemoteContent = false
    for (const { text, separatorBefore } of splitCommandPipeline(command)) {
        const tokens = stripPrivilegePrefix(stripEnvPrefix(tokenize(text)))
        if (tokens.length === 0) continue
        const pipedIn = separatorBefore === '|' && carriesRemoteContent

        if (pipedIn && interpreterExecutesStdin(tokens, text)) return true
        if (isInterpreterInvocation(tokens) && REMOTE_SUBSTITUTION_PATTERN.test(text)) return true

        carriesRemoteContent = (separatorBefore === '|' && carriesRemoteContent) || REMOTE_FETCH_PATTERN.test(text)
    }
    return false
}

function analyzeGitPush(tokens, context) {
    const pushIndex = tokens.indexOf('push')
    const args = tokens.slice(pushIndex + 1)
    const forceFlag = args.some(arg => /^(?:-f|--force|--force-with-lease(?:=.*)?|--force-if-includes)$/.test(arg))
    const deleteFlag = args.some(arg => /^(?:-d|--delete|--mirror)$/.test(arg))

    // Positional arguments are <remote> <refspec...>. Everything else is a flag or a flag value.
    // -o/--push-option take a value, and those carry the MR/PR creation directives the platform
    // prompt instructs the agent to use.
    const positionals = []
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]
        if (/^(?:-o|--push-option|--repo|--receive-pack|--exec)$/.test(arg)) {
            i += 1
            continue
        }
        if (arg.startsWith('-')) continue
        positionals.push(arg)
    }

    const refspecs = positionals.slice(1)
    const baseBranch = normalizeBranchRef(context.baseBranch)
    const currentBranch = normalizeBranchRef(context.currentBranch)

    if (deleteFlag) return { risky: true, key: 'git_push_delete', reason: 'deleting a remote branch' }

    // `HEAD` - the shape the platform's own instructions use - resolves to whatever branch the
    // agent is on. Resolve it when we can; when we cannot, pause rather than risk an unnoticed
    // push to the base branch.
    const targets = (refspecs.length > 0 ? refspecs : ['HEAD']).map(ref => {
        const normalized = normalizeBranchRef(ref)
        if (normalized === 'HEAD' || normalized === '') return currentBranch || null
        return normalized
    })

    if (targets.some(target => !target)) {
        return { risky: true, key: 'git_push_unknown', reason: 'a push whose target branch could not be determined' }
    }
    if (baseBranch && targets.some(target => target === baseBranch)) {
        return { risky: true, key: 'git_push_base', reason: `a push to the base branch "${baseBranch}"` }
    }
    if (forceFlag) return { risky: true, key: 'git_push_force', reason: 'a force push' }
    return { risky: false, key: 'git_push_branch' }
}

function analyzeHttpCommand(tokens) {
    const args = tokens.slice(1)
    let method = null
    let hasBody = false
    let uploadsFile = false
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]
        if (/^(?:-X|--request)$/.test(arg)) {
            method = String(args[i + 1] || '').toUpperCase()
            i += 1
            continue
        }
        const inlineMethod = arg.match(/^--request=(.+)$/)
        if (inlineMethod) {
            method = inlineMethod[1].toUpperCase()
            continue
        }
        if (/^(?:-d|--data|--data-raw|--data-binary|--data-urlencode|-F|--form|--post-data|--post-file)$/.test(arg)) {
            hasBody = true
            continue
        }
        if (/^(?:--data|--data-raw|--data-binary|--data-urlencode|--form|--post-data|--post-file)=/.test(arg)) {
            hasBody = true
            continue
        }
        if (/^(?:-T|--upload-file)$/.test(arg) || /^--upload-file=/.test(arg)) {
            uploadsFile = true
            continue
        }
    }

    const urlToken = args.find(arg => /^https?:\/\//i.test(arg)) || ''
    let host = ''
    try {
        host = urlToken ? new URL(urlToken).host : ''
    } catch (error) {
        host = ''
    }

    const effectiveMethod = method || (hasBody || uploadsFile ? 'POST' : 'GET')
    const isReadEndpoint = READ_ONLY_ENDPOINT_PATTERNS.some(pattern => pattern.test(urlToken))
    const isRead = HTTP_READ_METHODS.has(effectiveMethod) || (isReadEndpoint && !uploadsFile)

    return { method: effectiveMethod, host, isRead, uploadsFile, isWrite: HTTP_WRITE_METHODS.has(effectiveMethod) }
}

function assessBashCommand(command, context) {
    const level = context.level
    const normalizedCommand = command.replace(/\\/g, '/')

    if (SENSITIVE_PATH_PATTERN.test(normalizedCommand) || SENSITIVE_COMMAND_PATH_PATTERN.test(normalizedCommand)) {
        return { autoApprove: false, reason: 'access to credentials or secret files', signature: 'bash:secrets' }
    }
    if (detectRemoteScriptExecution(command)) {
        return {
            autoApprove: false,
            reason: 'downloading and executing a remote script',
            signature: 'bash:remote_execution',
            alwaysEscalate: true,
        }
    }

    for (const segment of splitCommandSegments(command)) {
        const tokens = stripEnvPrefix(tokenize(segment))
        if (tokens.length === 0) continue
        const program = path.basename(tokens[0] || '')

        if (DESTRUCTIVE_GIT_PATTERN.test(segment)) {
            return {
                autoApprove: false,
                reason: 'a destructive Git history operation',
                signature: 'bash:git_destructive',
            }
        }

        if (program === 'git' && tokens.includes('push')) {
            if (level === 'strict') {
                return {
                    autoApprove: false,
                    reason: 'publishing or destructive Git operation',
                    signature: 'bash:git_publish',
                }
            }
            const verdict = analyzeGitPush(tokens, context)
            if (verdict.risky) return { autoApprove: false, reason: verdict.reason, signature: `bash:${verdict.key}` }
            continue
        }

        if (program === 'gh' || program === 'glab') {
            const isCreate = tokens.includes('create')
            const isMerge = tokens.includes('merge')
            const isClose = tokens.includes('close')
            if (level === 'strict' && (isCreate || isMerge || isClose)) {
                return {
                    autoApprove: false,
                    reason: 'publishing or destructive Git operation',
                    signature: 'bash:git_publish',
                }
            }
            if (isMerge && level !== 'permissive') {
                return {
                    autoApprove: false,
                    reason: 'merging a merge/pull request into the base branch',
                    signature: 'bash:git_merge_request_merge',
                }
            }
            if (isClose) {
                return {
                    autoApprove: false,
                    reason: 'closing a merge/pull request',
                    signature: 'bash:git_merge_request_close',
                }
            }
            continue
        }

        if (program === 'curl' || program === 'wget' || program === 'http' || program === 'httpie') {
            if (level === 'permissive') continue
            const http = analyzeHttpCommand(tokens)
            if (http.isRead && !http.uploadsFile) {
                if (level === 'strict' && !HTTP_READ_METHODS.has(http.method)) {
                    return {
                        autoApprove: false,
                        reason: 'external HTTP mutation',
                        signature: `bash:http_write:${http.host || 'unknown'}`,
                    }
                }
                continue
            }
            if (http.isWrite || http.uploadsFile) {
                return {
                    autoApprove: false,
                    reason: `an outbound HTTP ${http.method} to ${http.host || 'an external host'}`,
                    signature: `bash:http_write:${http.host || 'unknown'}`,
                }
            }
            continue
        }

        const riskyRule = RISKY_COMMAND_RULES.find(rule => rule.pattern.test(segment))
        if (riskyRule) return { autoApprove: false, reason: riskyRule.reason, signature: `bash:${riskyRule.key}` }
    }

    return { autoApprove: true, reason: 'ordinary command inside the isolated VM', signature: '' }
}

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

function normalizeContext(cwdOrOptions) {
    const options = typeof cwdOrOptions === 'string' || !cwdOrOptions ? { cwd: cwdOrOptions } : cwdOrOptions
    return {
        cwd: options.cwd || '/home/user',
        level: isValidApprovalPolicyLevel(options.level) ? options.level : DEFAULT_APPROVAL_POLICY_LEVEL,
        baseBranch: options.baseBranch || '',
        currentBranch: options.currentBranch || '',
        sessionAllowlist: Array.isArray(options.sessionAllowlist) ? options.sessionAllowlist : [],
    }
}

/**
 * Decide whether a Claude tool call can run without pausing the VM job for user approval.
 *
 * @param {string} toolName
 * @param {object} toolInput
 * @param {string|object} cwdOrOptions legacy cwd string, or
 *        {cwd, level, baseBranch, currentBranch, sessionAllowlist}
 * @returns {{autoApprove: boolean, reason: string, signature?: string}}
 */
function assessClaudeToolApproval(toolName, toolInput = {}, cwdOrOptions = '/home/user') {
    const context = normalizeContext(cwdOrOptions)

    let verdict
    if (toolName === 'Bash') {
        verdict = assessBashCommand(String(toolInput.command || ''), context)
    } else if (!SAFE_CLAUDE_TOOLS.has(toolName)) {
        verdict = { autoApprove: false, reason: `unrecognized tool: ${toolName}`, signature: `tool:${toolName}` }
    } else {
        const toolPath = findToolPath(toolInput, context.cwd)
        if (toolPath && SENSITIVE_PATH_PATTERN.test(toolPath.replace(/\\/g, '/'))) {
            verdict = { autoApprove: false, reason: 'access to credentials or secret files', signature: 'tool:secrets' }
        } else if (
            FILE_MUTATION_TOOLS.has(toolName) &&
            toolPath &&
            ![context.cwd, '/home/user/output', '/tmp'].some(root => isPathWithin(toolPath, root))
        ) {
            verdict = {
                autoApprove: false,
                reason: 'file mutation outside the working directory',
                signature: 'tool:write_outside_workspace',
            }
        } else {
            verdict = { autoApprove: true, reason: 'routine read or workspace operation', signature: '' }
        }
    }

    if (verdict.autoApprove) return { autoApprove: true, reason: verdict.reason }

    // An operation that must always pause reports an EMPTY signature, which is the contract the
    // bridge and the host UI use to hide the "Allow for this run" button. Reporting a real
    // signature here offered the user a button that the allowlist check below then refuses to
    // honour: production job 8f3e8457 ended up with `bash:remote_execution` sitting in its
    // `approvalAllowlist` while the very same operation kept pausing (AT-2235).
    if (verdict.alwaysEscalate) return { autoApprove: false, reason: verdict.reason, signature: '' }

    // "Allow for this run": the user already approved this shape of operation earlier in the
    // same VM job.
    if (verdict.signature && context.sessionAllowlist.includes(verdict.signature)) {
        return { autoApprove: true, reason: 'approved by the user earlier in this run' }
    }

    return { autoApprove: false, reason: verdict.reason, signature: verdict.signature }
}

module.exports = {
    APPROVAL_POLICY_LEVELS,
    DEFAULT_APPROVAL_POLICY_LEVEL,
    isValidApprovalPolicyLevel,
    SAFE_CLAUDE_TOOLS,
    SENSITIVE_PATH_PATTERN,
    SENSITIVE_COMMAND_PATH_PATTERN,
    RISKY_COMMAND_RULES,
    REMOTE_EXECUTION_PATTERN,
    REMOTE_SUBSTITUTION_PATTERN,
    READ_ONLY_ENDPOINT_PATTERNS,
    assessClaudeToolApproval,
    detectRemoteScriptExecution,
    interpreterExecutesStdin,
    isPathWithin,
    splitCommandSegments,
    splitCommandPipeline,
}
