const path = require('path')

// Approval strictness presets for interactive VM runs.
//
//   strict      - pause on every publishing, deployment or outbound-write operation.
//                 This is the original behaviour and stays available as a per-run override
//                 for sensitive work.
//   balanced    - the default. Auto-approve the operations the platform itself instructs the
//                 agent to perform (push a feature branch, open an MR/PR), read-shaped API calls
//                 and local Git housekeeping, while still pausing for anything that lands on the
//                 base branch, merges, deployments, secrets and destructive operations.
//   permissive  - Claude Code's Auto-Mode, minus a small hard-danger list. Everything that only
//                 affects the ephemeral sandbox runs unattended: `rm -rf` anywhere inside the VM,
//                 force-pushing a FEATURE branch, `sudo`, workspace env/credential files such as
//                 the `.env` the test suite needs, writes outside the checkout, MR/PR merge and
//                 close, and tools the policy does not recognise (including MCP tools).
//
// What still pauses at EVERY level, because it reaches beyond the sandbox or destroys something
// that cannot be recreated from the repository:
//   - pushing, force-pushing or deleting a branch on the remote base branch,
//   - deployments and cloud infrastructure mutation (firebase/gcloud/kubectl/terraform/aws/az),
//   - publishing a package or image, external database mutation, `mkfs`/`dd of=`,
//   - remote shell access (`ssh`/`scp`/`sftp`) to another machine,
//   - downloading and executing a remote script (`curl … | bash`) - never allowlistable,
//   - reading or writing a real credential store (`~/.ssh`, `~/.aws`, `~/.config/gcloud`,
//     `~/.codex/auth.json`, service-account keys, `.netrc`, `.git-credentials`, private keys),
//   - deleting a protected root (`/`, `$HOME`, `/etc`, the checkout itself, …),
//   - writing into a system directory (`/etc`, `/usr`, `/bin`, …).
//
// AT-2343: "Permissive" used to be almost indistinguishable from "balanced", because only three
// rules consulted the level at all (git push analysis, MR/PR merge, outbound HTTP) - every other
// escalation was level-independent, so choosing the most permissive preset changed almost nothing.
// On top of that the risky-pattern matching ran over the RAW command string, so heredoc bodies and
// quoted data were scanned as if they were code: a commit message mentioning `.env`, a
// `python3 - <<'PY'` block writing documentation that contains the word "secrets", or
// `git check-ignore -v .env` each paused an interactive run. Production interaction records were
// dominated by exactly those false positives. Three structural changes fix it: heredoc bodies are
// stdin DATA unless the reader executes stdin as a program (the same rule AT-2235 introduced for
// pipes), secret detection matches real PATH OPERANDS instead of any occurrence of the word
// "secret" anywhere on the command line, and every rule now carries an `allowedFrom` level.
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
const LEVEL_RANK = { strict: 0, balanced: 1, permissive: 2 }

// `null` means "no level auto-approves this"; a level name means "auto-approved from this level
// up". Keeping these as named constants puts the whole product decision in one readable table
// instead of scattering it across the rules.
const NEVER_AUTO_APPROVED = null
const LOCAL_GIT_HISTORY_ALLOWED_FROM = 'balanced' // git reset --hard / clean -fd / branch -D
const SANDBOX_DELETE_ALLOWED_FROM = 'permissive' // rm -r outside the workspace but inside the VM
const WORKSPACE_SECRET_ALLOWED_FROM = 'permissive' // .env & friends inside the checkout
const ELEVATED_SHELL_ALLOWED_FROM = 'permissive' // sudo / su - inside the sandbox
const FEATURE_BRANCH_FORCE_PUSH_ALLOWED_FROM = 'permissive'
const MERGE_REQUEST_WRITE_ALLOWED_FROM = 'permissive' // merging / closing an MR or PR
const UNRECOGNIZED_TOOL_ALLOWED_FROM = 'permissive' // MCP tools and future built-ins
const WRITE_OUTSIDE_WORKSPACE_ALLOWED_FROM = 'permissive'
const OUTBOUND_HTTP_WRITE_ALLOWED_FROM = 'permissive'

const HOME_DIR = '/home/user'

function isValidApprovalPolicyLevel(level) {
    return APPROVAL_POLICY_LEVELS.includes(level)
}

function levelAllows(level, allowedFrom) {
    if (!allowedFrom) return false
    return LEVEL_RANK[level] >= LEVEL_RANK[allowedFrom]
}

// The built-in Claude Code tool surface. Anything missing from this set escalated on every single
// call, which is why background shells (`BashOutput`, `KillShell`), skills and slash commands
// paused runs that had already been told to work autonomously.
const SAFE_CLAUDE_TOOLS = new Set([
    'Read',
    'Glob',
    'Grep',
    'LS',
    'Edit',
    'Write',
    'MultiEdit',
    'NotebookRead',
    'NotebookEdit',
    'WebFetch',
    'WebSearch',
    'Task',
    'TaskOutput',
    'TaskStop',
    'TodoRead',
    'TodoWrite',
    'BashOutput',
    'KillShell',
    'KillBash',
    'SlashCommand',
    'Skill',
    'ListMcpResources',
    'ReadMcpResource',
    'ExitPlanMode',
    'AskUserQuestion',
])

const MCP_TOOL_PATTERN = /^mcp__/
const FILE_MUTATION_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Real credential stores. Reading one is an exfiltration risk at any level, so these pause even on
// `permissive` (the user can still grant "Allow for this run").
const CREDENTIAL_STORE_PATTERNS = [
    /(^|\/)\.ssh(\/|$)/i,
    /(^|\/)\.aws(\/|$)/i,
    /(^|\/)\.gnupg(\/|$)/i,
    /(^|\/)\.config\/gcloud(\/|$)/i,
    /(^|\/)\.codex\/auth\.json$/i,
    /(^|\/)\.claude\/\.credentials\.json$/i,
    /(^|\/)\.netrc$/i,
    /(^|\/)\.git-credentials$/i,
    /(^|\/)\.npmrc$/i,
    /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
    /(^|\/)(?:serviceaccountkey|serv_account_key[^/]*|service[-_]account[^/]*)\.json$/i,
    /(^|\/)[^/]*\.(?:pem|p12|pfx)$/i,
]

// Secret-shaped files that live inside the checkout. The repo's own test suite needs a local
// `.env` (`node ci/writeTestEnv.js`), so pausing on these made `permissive` unusable for ordinary
// work - while the sandbox is ephemeral, per-user, and holds no shared secrets.
const WORKSPACE_SECRET_PATTERNS = [
    /(^|\/)\.env(?:\.[A-Za-z0-9_.-]+)?$/i,
    // A bare word must not count: `grep -rn secrets functions/` is a search, not file access, so a
    // directory operand has to be written as a path (`config/secrets`) to match.
    /\/(?:credentials?|secrets?)\/?$/i,
    /(^|\/)(?:credentials?|secrets?)\.(?:json|ya?ml|env|txt|ini|cfg|conf|toml|properties|js|ts|key)$/i,
    /(^|\/)service_accounts?(\/|$)/i,
]

// Deleting one of these is not "cleaning up a scratch directory" - it is destroying the run.
const PROTECTED_DELETE_PATHS = [
    '/',
    '/home',
    HOME_DIR,
    '/tmp',
    '/var',
    '/var/tmp',
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/opt',
    '/boot',
    '/root',
    '/dev',
    '/proc',
    '/sys',
]

// System roots that stay read-only even on `permissive`.
const PROTECTED_WRITE_ROOTS = [
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/boot',
    '/root',
    '/proc',
    '/sys',
    '/dev',
]

// Where a recursive delete or a file write is unremarkable at `balanced`.
const WORKSPACE_ROOTS = ['/home/user/output', '/tmp', '/var/tmp']

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
// `allowedFrom` is the level at which the operation stops pausing.
const RISKY_COMMAND_RULES = [
    {
        key: 'remote_shell',
        pattern: /\bssh\b|\bscp\b|\bsftp\b/i,
        reason: 'shell access to another machine',
        allowedFrom: NEVER_AUTO_APPROVED,
    },
    {
        key: 'shell_access',
        pattern: /\bsudo\b|\bsu\s+-/i,
        reason: 'elevated shell access',
        allowedFrom: ELEVATED_SHELL_ALLOWED_FROM,
    },
    {
        // `rm` itself is analysed per target by `analyzeRecursiveDelete`; this catches the other
        // broad-deletion shapes.
        key: 'destructive_delete',
        pattern: /\bfind\b[^\n]*\s-delete\b|\bxargs\b[^\n]*\brm\s+-[a-z]*r/i,
        reason: 'recursive or broad deletion',
        allowedFrom: SANDBOX_DELETE_ALLOWED_FROM,
    },
    {
        key: 'package_publish',
        pattern: /\b(?:npm|pnpm|yarn)\s+publish\b|\bdocker\s+push\b|\btwine\s+upload\b/i,
        reason: 'publishing a package or image',
        allowedFrom: NEVER_AUTO_APPROVED,
    },
    {
        key: 'deployment',
        pattern:
            /\b(?:firebase|vercel|netlify|wrangler)\s+deploy\b|\bgcloud\b[^\n]*\b(?:deploy|delete|create|update|set-iam-policy|add-iam-policy-binding)\b|\bkubectl\s+(?:apply|create|delete|patch|replace|rollout|scale)\b|\bterraform\s+(?:apply|destroy|import)\b/i,
        reason: 'deployment or cloud infrastructure mutation',
        allowedFrom: NEVER_AUTO_APPROVED,
    },
    {
        key: 'cloud_mutation',
        pattern:
            /\baws\b[^\n]*\b(?:create|delete|put|update|terminate|run-instances|s3\s+(?:cp|mv|rm|sync))\b|\baz\b[^\n]*\b(?:create|delete|update|deployment)\b/i,
        reason: 'cloud infrastructure or storage mutation',
        allowedFrom: NEVER_AUTO_APPROVED,
    },
    {
        key: 'data_mutation',
        pattern: /\b(?:psql|mysql|mongosh?|redis-cli)\b[^\n]*\b(?:drop|delete|truncate|update|insert|flushall)\b/i,
        reason: 'external data mutation',
        allowedFrom: NEVER_AUTO_APPROVED,
    },
    {
        key: 'destructive_system',
        pattern: /\bmkfs(?:\.|\s)|\bdd\s+[^\n]*\bof=|:\(\)\s*\{\s*:\|:&\s*\};:/i,
        reason: 'destructive system operation',
        allowedFrom: NEVER_AUTO_APPROVED,
    },
]

// Git operations that rewrite or discard history. They only touch the sandbox checkout - what
// reaches the remote is governed by the push rules, which keep the base branch protected at every
// level - so from `balanced` up they run unattended.
const DESTRUCTIVE_GIT_PATTERN = /\bgit\s+(?:reset\s+--hard\b|clean\s+-[a-z]*f|branch\s+-D\b|filter-branch\b)/i

const HEREDOC_MARKER_PATTERN = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g

/**
 * Pull heredoc bodies out of a command line.
 *
 * A heredoc body is the standard input of the command, not part of the command line, but the raw
 * text used to be scanned as if it were: `git commit -F - <<'EOF' … EOF` escalated whenever the
 * commit MESSAGE mentioned `.env`, `ssh` or "deploy", and `splitCommandPipeline` even chopped the
 * message into fake command segments at every `|` or `;` it contained. Bodies are returned
 * separately so the caller can re-attach them only where they really are the program
 * (`bash <<'EOF'`, `python3 - <<'PY'`).
 */
function extractHeredocs(command) {
    const lines = String(command || '').split('\n')
    const bodies = new Map()
    const kept = []
    const queue = []
    let active = null

    const finish = heredoc => bodies.set(heredoc.delimiter, heredoc.lines.join('\n'))

    for (const line of lines) {
        if (active) {
            const terminator = active.dashed ? line.trim() : line.replace(/\s+$/, '')
            if (terminator === active.delimiter) {
                finish(active)
                active = queue.shift() || null
                continue
            }
            active.lines.push(line)
            continue
        }
        kept.push(line)
        HEREDOC_MARKER_PATTERN.lastIndex = 0
        let match
        while ((match = HEREDOC_MARKER_PATTERN.exec(line)) !== null) {
            queue.push({ delimiter: match[2], dashed: match[0].startsWith('<<-'), lines: [] })
        }
        if (!active && queue.length > 0) active = queue.shift()
    }

    if (active) finish(active)
    for (const pending of queue) finish(pending)
    return { text: kept.join('\n'), bodies }
}

function heredocDelimitersIn(text) {
    const delimiters = []
    HEREDOC_MARKER_PATTERN.lastIndex = 0
    let match
    while ((match = HEREDOC_MARKER_PATTERN.exec(text)) !== null) delimiters.push(match[2])
    return delimiters
}

/**
 * Blank out the CONTENT of quoted arguments while keeping the structure of the command line.
 *
 * Quoted text is data unless the program is an interpreter that was handed inline code, so a JSON
 * request body, a `-m` commit message or a `grep` pattern can no longer trip the risky-command
 * rules. Path operands are matched on tokens instead (see `classifySecretPathAccess`), so quoted
 * paths such as `cat "$HOME/.ssh/id_rsa"` are still caught.
 */
function stripQuotedData(text) {
    let out = ''
    let quote = null
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i]
        if (quote) {
            if (char === quote && text[i - 1] !== '\\') {
                quote = null
                out += ' '
            }
            continue
        }
        if (char === '"' || char === "'") {
            quote = char
            out += ' '
            continue
        }
        out += char
    }
    return out
}

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
        // Redirections are not the program: `bash <<'EOF'` still executes stdin.
        if (/^[0-9]?(?:<|>)/.test(arg)) continue
        hasScriptOperand = true
    }

    if (readsStdinExplicitly) return true
    if (hasInlineCode && INLINE_CODE_EVALUATES_STDIN_PATTERN.test(segment)) return true
    return !hasInlineCode && !hasScriptOperand
}

// Programs whose QUOTED argument is the operation rather than data - a SQL statement, a remote
// command. Blanking quoted text for these would hide the very thing the rules look for
// (`psql -c "delete from users"`).
const QUOTED_PAYLOAD_PROGRAMS = new Set(['psql', 'mysql', 'mongo', 'mongosh', 'redis-cli', 'sqlite3', 'ssh'])

function interpreterRunsInlineProgram(tokens) {
    const family = interpreterFamily(path.basename(tokens[0] || ''))
    if (!family) return false
    const inlineFlags = INTERPRETER_INLINE_CODE_FLAGS[family] || []
    return tokens
        .slice(1)
        .some(
            arg =>
                inlineFlags.includes(arg) ||
                inlineFlags.some(flag => arg.startsWith(`${flag}=`)) ||
                inlineFlags.some(flag => flag.length === 2 && arg.length > 2 && arg.startsWith(flag))
        )
}

function isInterpreterInvocation(tokens) {
    const program = path.basename(tokens[0] || '')
    return interpreterFamily(program) !== null || program === 'eval' || program === 'source' || program === '.'
}

/**
 * Split a command into segments enriched with everything the rules need:
 *   text     - the segment as written, heredoc bodies removed
 *   scanText - text plus any heredoc body that is genuinely the program being executed
 *   riskText - scanText with quoted DATA blanked out, so a commit message or a JSON payload cannot
 *              trip a risky-command pattern (kept intact for `bash -c "…"`, which is code)
 *   tokens   - quote-stripped tokens with env assignments removed
 *   bare     - tokens with `sudo`/`nohup`/… removed, so `sudo git push` is analysed as a push
 */
function analyzeCommandSegments(command) {
    const { text, bodies } = extractHeredocs(command)
    return splitCommandPipeline(text).map(segment => {
        const tokens = stripEnvPrefix(tokenize(segment.text))
        const bare = stripPrivilegePrefix(tokens)
        const delimiters = heredocDelimitersIn(segment.text)
        const executesStdin = delimiters.length > 0 && interpreterExecutesStdin(bare, segment.text)
        const attachedBody = executesStdin
            ? delimiters
                  .map(delimiter => bodies.get(delimiter) || '')
                  .filter(Boolean)
                  .join('\n')
            : ''
        const scanText = attachedBody ? `${segment.text}\n${attachedBody}` : segment.text
        return {
            ...segment,
            tokens,
            bare,
            program: path.basename(bare[0] || ''),
            scanText,
            riskText:
                interpreterRunsInlineProgram(bare) || QUOTED_PAYLOAD_PROGRAMS.has(path.basename(bare[0] || ''))
                    ? scanText
                    : stripQuotedData(scanText),
        }
    })
}

function splitCommandSegments(command) {
    return analyzeCommandSegments(command).map(segment => segment.text)
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
    for (const { scanText, separatorBefore, bare } of analyzeCommandSegments(command)) {
        if (bare.length === 0) continue
        const pipedIn = separatorBefore === '|' && carriesRemoteContent

        if (pipedIn && interpreterExecutesStdin(bare, scanText)) return true
        if (isInterpreterInvocation(bare) && REMOTE_SUBSTITUTION_PATTERN.test(scanText)) return true

        carriesRemoteContent = (separatorBefore === '|' && carriesRemoteContent) || REMOTE_FETCH_PATTERN.test(scanText)
    }
    return false
}

/**
 * Turn a token into the path it refers to, or '' when it is not a path operand.
 *
 * This is the heart of the AT-2343 secrets fix: only operands that actually LOOK like a filename
 * are matched against the secret patterns, so `git commit -m "drop the old credentials"` is prose
 * while `cat .env` and `cat "$HOME/.ssh/id_rsa"` are still file access.
 */
function toPathOperand(token) {
    let value = String(token || '').trim()
    if (!value || /\s/.test(value) || value.length > 512) return ''
    value = value.replace(/^[0-9]?(?:>>|<<|>|<)/, '')
    const equals = value.indexOf('=')
    if (equals >= 0) value = value.slice(equals + 1)
    value = value.replace(/[,;)]+$/, '').replace(/^['"]|['"]$/g, '')
    if (!value || value.startsWith('-')) return ''
    if (value.startsWith('~')) value = `${HOME_DIR}${value.slice(1)}`
    return value.replace(/\\/g, '/')
}

function classifyPath(candidate) {
    if (!candidate) return ''
    if (CREDENTIAL_STORE_PATTERNS.some(pattern => pattern.test(candidate))) return 'credential_store'
    if (WORKSPACE_SECRET_PATTERNS.some(pattern => pattern.test(candidate))) return 'workspace_secret'
    return ''
}

function classifySecretPathAccess(tokens) {
    let workspace = ''
    for (const token of tokens) {
        const verdict = classifyPath(toPathOperand(token))
        if (verdict === 'credential_store') return 'credential_store'
        if (verdict === 'workspace_secret') workspace = verdict
    }
    return workspace
}

function resolveCommandPath(value, cwd) {
    const candidate = toPathOperand(value)
    if (!candidate) return ''
    // An unexpanded variable could point anywhere - treat it as unknown rather than as safe.
    if (/\$\{?[A-Za-z_]/.test(candidate)) return ''
    return path.resolve(cwd || HOME_DIR, candidate)
}

function isPathWithin(candidate, root) {
    if (!candidate || !root) return false
    const relative = path.relative(path.resolve(root), path.resolve(candidate))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * `rm -rf` inside an ephemeral sandbox is housekeeping, not danger: production runs paused on
 * `rm -rf /tmp/mastercheck`, `rm -rf browser-tests/at2236` and `rm -rf node_modules`. What still
 * matters is the TARGET, so the rule became path-aware instead of level-independent.
 */
function analyzeRecursiveDelete(tokens, context) {
    const args = tokens.slice(1)
    const recursive = args.some(arg => /^-[a-zA-Z]*[rR]/.test(arg) || arg === '--recursive')
    if (!recursive) return { risky: false }

    const targets = args.filter(arg => !arg.startsWith('-'))
    if (targets.length === 0) return { risky: false }

    const workspaceRoots = [context.cwd, ...WORKSPACE_ROOTS, ...context.writableRoots]
    const roots = levelAllows(context.level, SANDBOX_DELETE_ALLOWED_FROM)
        ? [...workspaceRoots, HOME_DIR]
        : workspaceRoots

    for (const target of targets) {
        const resolved = resolveCommandPath(target, context.cwd)
        if (!resolved) {
            return {
                risky: true,
                key: 'destructive_delete_unknown',
                reason: 'a recursive deletion whose target could not be resolved',
                allowedFrom: NEVER_AUTO_APPROVED,
            }
        }
        if (PROTECTED_DELETE_PATHS.includes(resolved) || resolved === path.resolve(context.cwd)) {
            return {
                risky: true,
                key: 'destructive_delete_protected',
                reason: `a recursive deletion of ${resolved}`,
                allowedFrom: NEVER_AUTO_APPROVED,
            }
        }
        if (!roots.some(root => isPathWithin(resolved, root))) {
            return {
                risky: true,
                key: 'destructive_delete',
                reason: 'recursive or broad deletion',
                allowedFrom: SANDBOX_DELETE_ALLOWED_FROM,
            }
        }
    }
    return { risky: false }
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

    if (deleteFlag) {
        return {
            risky: true,
            key: 'git_push_delete',
            reason: 'deleting a remote branch',
            allowedFrom: NEVER_AUTO_APPROVED,
        }
    }

    // `HEAD` - the shape the platform's own instructions use - resolves to whatever branch the
    // agent is on. Resolve it when we can; when we cannot, pause rather than risk an unnoticed
    // push to the base branch.
    const targets = (refspecs.length > 0 ? refspecs : ['HEAD']).map(ref => {
        const normalized = normalizeBranchRef(ref)
        if (normalized === 'HEAD' || normalized === '') return currentBranch || null
        return normalized
    })

    if (targets.some(target => !target)) {
        return {
            risky: true,
            key: 'git_push_unknown',
            reason: 'a push whose target branch could not be determined',
            allowedFrom: NEVER_AUTO_APPROVED,
        }
    }
    if (baseBranch && targets.some(target => target === baseBranch)) {
        return {
            risky: true,
            key: 'git_push_base',
            reason: `a push to the base branch "${baseBranch}"`,
            allowedFrom: NEVER_AUTO_APPROVED,
        }
    }
    if (forceFlag) {
        // Force-pushing your OWN feature branch after a rebase or an amend is routine; a force push
        // that would land on the base branch is already caught above and stays protected at every
        // level.
        return {
            risky: true,
            key: 'git_push_force',
            reason: 'a force push',
            allowedFrom: FEATURE_BRANCH_FORCE_PUSH_ALLOWED_FROM,
        }
    }
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

function escalation(reason, signature, allowedFrom) {
    return { autoApprove: false, reason, signature, allowedFrom }
}

function assessBashCommand(command, context) {
    const level = context.level

    if (detectRemoteScriptExecution(command)) {
        return {
            autoApprove: false,
            reason: 'downloading and executing a remote script',
            signature: 'bash:remote_execution',
            alwaysEscalate: true,
        }
    }

    for (const segment of analyzeCommandSegments(command)) {
        const { tokens, bare, program, riskText } = segment
        if (bare.length === 0) continue

        const secretAccess = classifySecretPathAccess(tokens)
        if (secretAccess === 'credential_store') {
            return escalation('access to credentials or secret files', 'bash:secrets', NEVER_AUTO_APPROVED)
        }
        if (secretAccess === 'workspace_secret' && !levelAllows(level, WORKSPACE_SECRET_ALLOWED_FROM)) {
            return escalation('access to credentials or secret files', 'bash:secrets', WORKSPACE_SECRET_ALLOWED_FROM)
        }

        if (DESTRUCTIVE_GIT_PATTERN.test(riskText) && !levelAllows(level, LOCAL_GIT_HISTORY_ALLOWED_FROM)) {
            return escalation(
                'a destructive Git history operation',
                'bash:git_destructive',
                LOCAL_GIT_HISTORY_ALLOWED_FROM
            )
        }

        if (program === 'rm') {
            // `strict` keeps the original blanket rule: any recursive delete pauses, wherever it
            // points. From `balanced` up the target decides (see analyzeRecursiveDelete).
            if (level === 'strict' && bare.slice(1).some(arg => /^-[a-zA-Z]*[rR]/.test(arg))) {
                return escalation('recursive or broad deletion', 'bash:destructive_delete', 'balanced')
            }
            const verdict = analyzeRecursiveDelete(bare, context)
            if (verdict.risky && !levelAllows(level, verdict.allowedFrom)) {
                return escalation(verdict.reason, `bash:${verdict.key}`, verdict.allowedFrom)
            }
            continue
        }

        if (program === 'git' && bare.includes('push')) {
            if (level === 'strict') {
                return escalation('publishing or destructive Git operation', 'bash:git_publish', NEVER_AUTO_APPROVED)
            }
            const verdict = analyzeGitPush(bare, context)
            if (verdict.risky && !levelAllows(level, verdict.allowedFrom)) {
                return escalation(verdict.reason, `bash:${verdict.key}`, verdict.allowedFrom)
            }
            continue
        }

        if (program === 'gh' || program === 'glab') {
            const isCreate = bare.includes('create')
            const isMerge = bare.includes('merge')
            const isClose = bare.includes('close')
            if (level === 'strict' && (isCreate || isMerge || isClose)) {
                return escalation('publishing or destructive Git operation', 'bash:git_publish', NEVER_AUTO_APPROVED)
            }
            if (isMerge && !levelAllows(level, MERGE_REQUEST_WRITE_ALLOWED_FROM)) {
                return escalation(
                    'merging a merge/pull request into the base branch',
                    'bash:git_merge_request_merge',
                    MERGE_REQUEST_WRITE_ALLOWED_FROM
                )
            }
            if (isClose && !levelAllows(level, MERGE_REQUEST_WRITE_ALLOWED_FROM)) {
                return escalation(
                    'closing a merge/pull request',
                    'bash:git_merge_request_close',
                    MERGE_REQUEST_WRITE_ALLOWED_FROM
                )
            }
            continue
        }

        if (program === 'curl' || program === 'wget' || program === 'http' || program === 'httpie') {
            if (levelAllows(level, OUTBOUND_HTTP_WRITE_ALLOWED_FROM)) continue
            const http = analyzeHttpCommand(bare)
            if (http.isRead && !http.uploadsFile) {
                if (level === 'strict' && !HTTP_READ_METHODS.has(http.method)) {
                    return escalation(
                        'external HTTP mutation',
                        `bash:http_write:${http.host || 'unknown'}`,
                        OUTBOUND_HTTP_WRITE_ALLOWED_FROM
                    )
                }
                continue
            }
            if (http.isWrite || http.uploadsFile) {
                return escalation(
                    `an outbound HTTP ${http.method} to ${http.host || 'an external host'}`,
                    `bash:http_write:${http.host || 'unknown'}`,
                    OUTBOUND_HTTP_WRITE_ALLOWED_FROM
                )
            }
            continue
        }

        const riskyRule = RISKY_COMMAND_RULES.find(rule => rule.pattern.test(riskText))
        if (riskyRule && !levelAllows(level, riskyRule.allowedFrom)) {
            return escalation(riskyRule.reason, `bash:${riskyRule.key}`, riskyRule.allowedFrom)
        }
    }

    return { autoApprove: true, reason: 'ordinary command inside the isolated VM', signature: '' }
}

function normalizeToolPath(value, cwd) {
    if (typeof value !== 'string' || !value.trim()) return ''
    return path.resolve(cwd || HOME_DIR, value.trim())
}

function findToolPath(toolInput = {}, cwd = HOME_DIR) {
    const value =
        toolInput.file_path ||
        toolInput.filePath ||
        toolInput.notebook_path ||
        toolInput.notebookPath ||
        toolInput.path ||
        ''
    return normalizeToolPath(value, cwd)
}

function assessToolCall(toolName, toolInput, context) {
    const isMcp = MCP_TOOL_PATTERN.test(toolName)
    if (isMcp || !SAFE_CLAUDE_TOOLS.has(toolName)) {
        if (levelAllows(context.level, UNRECOGNIZED_TOOL_ALLOWED_FROM)) {
            return { autoApprove: true, reason: isMcp ? 'a tool from a connected MCP server' : 'a sandboxed tool call' }
        }
        return escalation(
            isMcp ? `a tool from a connected MCP server: ${toolName}` : `unrecognized tool: ${toolName}`,
            `tool:${toolName}`,
            UNRECOGNIZED_TOOL_ALLOWED_FROM
        )
    }

    const toolPath = findToolPath(toolInput, context.cwd)
    const secretAccess = classifyPath(toolPath.replace(/\\/g, '/'))
    if (secretAccess === 'credential_store') {
        return escalation('access to credentials or secret files', 'tool:secrets', NEVER_AUTO_APPROVED)
    }
    if (secretAccess === 'workspace_secret' && !levelAllows(context.level, WORKSPACE_SECRET_ALLOWED_FROM)) {
        return escalation('access to credentials or secret files', 'tool:secrets', WORKSPACE_SECRET_ALLOWED_FROM)
    }

    if (FILE_MUTATION_TOOLS.has(toolName) && toolPath) {
        if (PROTECTED_WRITE_ROOTS.some(root => isPathWithin(toolPath, root))) {
            return escalation('file mutation inside a system directory', 'tool:write_system_path', NEVER_AUTO_APPROVED)
        }
        const writableRoots = [context.cwd, ...WORKSPACE_ROOTS, ...context.writableRoots]
        if (
            !writableRoots.some(root => isPathWithin(toolPath, root)) &&
            !levelAllows(context.level, WRITE_OUTSIDE_WORKSPACE_ALLOWED_FROM)
        ) {
            return escalation(
                'file mutation outside the working directory',
                'tool:write_outside_workspace',
                WRITE_OUTSIDE_WORKSPACE_ALLOWED_FROM
            )
        }
    }

    return { autoApprove: true, reason: 'routine read or workspace operation', signature: '' }
}

function normalizeContext(cwdOrOptions) {
    const options = typeof cwdOrOptions === 'string' || !cwdOrOptions ? { cwd: cwdOrOptions } : cwdOrOptions
    return {
        cwd: options.cwd || HOME_DIR,
        level: isValidApprovalPolicyLevel(options.level) ? options.level : DEFAULT_APPROVAL_POLICY_LEVEL,
        baseBranch: options.baseBranch || '',
        currentBranch: options.currentBranch || '',
        sessionAllowlist: Array.isArray(options.sessionAllowlist) ? options.sessionAllowlist : [],
        // The extra directories the runner mounts as writable (the relocated Git metadata the Codex
        // sandbox needs, for example). Writing there is part of the normal flow, so it must not
        // read as "outside the working directory".
        writableRoots: Array.isArray(options.writableRoots) ? options.writableRoots.filter(Boolean) : [],
    }
}

/**
 * Decide whether a Claude tool call can run without pausing the VM job for user approval.
 *
 * @param {string} toolName
 * @param {object} toolInput
 * @param {string|object} cwdOrOptions legacy cwd string, or
 *        {cwd, level, baseBranch, currentBranch, sessionAllowlist, writableRoots}
 * @returns {{autoApprove: boolean, reason: string, signature?: string}}
 */
function assessClaudeToolApproval(toolName, toolInput = {}, cwdOrOptions = HOME_DIR) {
    const context = normalizeContext(cwdOrOptions)

    const verdict =
        toolName === 'Bash'
            ? assessBashCommand(String(toolInput.command || ''), context)
            : assessToolCall(toolName, toolInput, context)

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
    CREDENTIAL_STORE_PATTERNS,
    WORKSPACE_SECRET_PATTERNS,
    PROTECTED_DELETE_PATHS,
    PROTECTED_WRITE_ROOTS,
    RISKY_COMMAND_RULES,
    REMOTE_EXECUTION_PATTERN,
    REMOTE_SUBSTITUTION_PATTERN,
    READ_ONLY_ENDPOINT_PATTERNS,
    assessClaudeToolApproval,
    detectRemoteScriptExecution,
    extractHeredocs,
    interpreterExecutesStdin,
    isPathWithin,
    splitCommandSegments,
    splitCommandPipeline,
    stripQuotedData,
}
