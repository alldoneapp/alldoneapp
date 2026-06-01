const admin = require('firebase-admin')
const { getEnvFunctions } = require('../envFunctionsHelper')
const {
    VM_JOB_GOLD_SOURCE,
    VM_JOB_GOLD_REFUND_SOURCE,
    VM_GOLD_PER_MINUTE,
    VM_TOKENS_PER_GOLD,
    getAgentLabel,
} = require('./vmJob')

// Hard ceiling on a single VM run. The worker is an onTaskDispatched function capped
// at 30 min total (timeoutSeconds 1800 = the Cloud Tasks dispatch-deadline max). We cap
// the agent runtime at 25 min so there's always ~5 min of headroom AFTER the run to
// finalize within that window — upload artifacts, charge Gold, post the result — and so
// a hung agent fails (and refunds) before the function itself is killed.
const MAX_VM_RUNTIME_MS = 25 * 60 * 1000 // 25 minutes
// Don't refresh the live status comment more often than this (Firestore write rate).
const PROGRESS_UPDATE_INTERVAL_MS = 3000
// Runtime Gold is charged while the VM is running. The interval can fire twice per
// billable minute; only newly accrued whole-minute charges are deducted.
const VM_GOLD_MONITOR_INTERVAL_MS = 30 * 1000
const VM_GOLD_EXHAUSTED_FAILURE_REASON = 'insufficient_gold'
const VM_GOLD_EXHAUSTED_TEXT =
    '🛑 VM task stopped because you ran out of Gold. Add Gold and start a new VM task to continue.'

// Persistent per-thread VM session: after a run we PAUSE the sandbox (snapshotting its
// filesystem + the agent's session store) and save its id on a vmSessions doc keyed by the
// chat thread, so the next run in that thread resumes it and the agent continues. Paused
// sandboxes are deleted after this idle window. (e2b@1.x has no pause() method, so we call
// the pause + resume REST endpoints directly (connect alone won't resume a paused sandbox),
// then Sandbox.connect() to attach; cleanup is Sandbox.kill().)
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days idle before a paused session is deleted
const E2B_API_BASE = 'https://api.e2b.dev'

// Keep-alive: after a run we leave the sandbox RUNNING (not paused) for a grace window so
// back-to-back tasks in a thread hit a live VM (instant, no resume). The `pauseIdleVmSessions`
// scheduler pauses sessions idle longer than the grace window. The sandbox's own self-kill
// timeout is set comfortably ABOVE the grace window + scheduler interval so the pauser always
// pauses (preserving state) before E2B would kill the idle VM.
const KEEP_ALIVE_GRACE_MS = 10 * 60 * 1000 // pause after 10 min idle
const KEEP_ALIVE_KILL_MS = 15 * 60 * 1000 // sandbox self-kill timeout (> grace + 2-min pauser interval)

// Per-task-type guidance prepended to the agent's objective.
const TASK_TYPE_PROFILES = {
    research:
        'You are an autonomous research agent. Do thorough multi-source web research and produce a clear, well-structured written report with sources.',
    document:
        'You are an autonomous agent that produces polished documents. Generate the requested deliverable (document, spreadsheet, or slides) and summarize what you produced.',
    prototype:
        'You are an autonomous coding agent. Write working code / a small prototype to satisfy the objective, then explain what you built and how to run it.',
    data:
        'You are an autonomous data agent. Acquire, clean and analyze the relevant data, then report the findings with any key figures.',
}

// --- Git repository integration (optional, per-project; GitLab or GitHub) ---
// When the project has a repo connected AND the requesting user has stored a token, a coding
// ("prototype") task runs inside an authenticated checkout of that repo and opens a Merge
// Request (GitLab) / Pull Request (GitHub). SECURITY: the token is passed to the sandbox ONLY
// as a per-command env var (the e2b `envs` option) — never written to disk, prompt.txt, or the
// paused-session snapshot. The git credential helper we configure stores only a reference to
// $GIT_TOKEN, not the token itself, so resuming a paused sandbox never leaks it.
const REPO_DIR = '/home/user/repo'
const REPO_DEPENDENCY_INSTALL_TIMEOUT_MS = 7 * 60 * 1000

// Static setup script. ALL dynamic values arrive via env vars (so nothing untrusted is
// interpolated into the script text — no shell injection). The credential helper is
// single-quoted so $GIT_TOKEN is resolved by git at push time from the live env, not baked
// into ~/.gitconfig (GitLab auths as oauth2:<token>, GitHub as x-access-token:<token>). Fresh
// start: clone + checkout the base branch. On a resumed thread the repo already exists, so we
// only fetch (and leave the agent's working state intact) so a conversational follow-up
// continues on the same branch the agent left.
//
// git is ensured at RUNTIME (not via the E2B template): the worker runs on E2B's prebuilt
// `claude`/`codex` templates by default — our custom template (functions/e2b-template) is only
// used if E2B_*_TEMPLATE overrides point at it — so we can't assume git is baked in. This
// mirrors the per-agent installGuard pattern. (gh is NOT ensured here: the GitHub PR step has a
// REST-API-via-curl fallback in the prompt, so it works whether or not gh is present.)
const GIT_SETUP_SCRIPT = `set -e
if ! command -v git >/dev/null 2>&1; then
  (sudo apt-get update && sudo apt-get install -y git) >/dev/null 2>&1 || (apt-get update && apt-get install -y git) >/dev/null 2>&1 || true
fi
command -v git >/dev/null 2>&1 || { echo "git is not available in this sandbox and could not be installed automatically" >&2; exit 3; }
git config --global credential.helper '!f() { echo "username=$GIT_CRED_USERNAME"; echo "password=$GIT_TOKEN"; }; f'
git config --global user.name "$GIT_USER_NAME"
git config --global user.email "$GIT_USER_EMAIL"
git config --global advice.detachedHead false
if [ -d "${REPO_DIR}/.git" ]; then
  cd "${REPO_DIR}"
  git remote set-url origin "$GIT_REPO_URL"
  git fetch origin --prune
else
  git clone "$GIT_REPO_URL" "${REPO_DIR}"
  cd "${REPO_DIR}"
  git checkout "$GIT_BASE_BRANCH" 2>/dev/null || true
fi
echo "GIT_SETUP_OK $(git rev-parse --abbrev-ref HEAD)"
`

// Best-effort dependency install for JavaScript/TypeScript repos. Without this, scripts like
// `npm run lint` can fail with `eslint: not found` because npm resolves eslint from
// node_modules/.bin, not from the base VM image. The install is intentionally non-fatal: private
// registries or large monorepos should not prevent the agent from attempting the requested change.
const REPO_DEPENDENCY_SETUP_SCRIPT = `set -e
cd "${REPO_DIR}"
if [ -d .git/info ]; then
  grep -qxF "node_modules/" .git/info/exclude 2>/dev/null || printf "\\nnode_modules/\\n" >> .git/info/exclude
fi
if [ ! -f package.json ]; then
  echo "DEPENDENCY_SETUP_SKIPPED no package.json"
  exit 0
fi
if [ -d node_modules ]; then
  echo "DEPENDENCY_SETUP_SKIPPED node_modules exists"
  exit 0
fi
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi
if [ -f pnpm-lock.yaml ]; then
  command -v pnpm >/dev/null 2>&1 || npm install -g pnpm >/dev/null 2>&1
  pnpm install --frozen-lockfile
elif [ -f yarn.lock ]; then
  command -v yarn >/dev/null 2>&1 || npm install -g yarn >/dev/null 2>&1
  yarn install --frozen-lockfile
elif [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then
  npm ci
else
  npm install --no-package-lock
fi
echo "DEPENDENCY_SETUP_OK"
`

// Build the provider-specific context from a project's repo config + a user token doc.
// GitLab auths git as oauth2:<token> and opens MRs; GitHub auths as x-access-token:<token>
// and opens PRs (via the gh CLI / REST API).
function buildProviderContext(provider, repoUrl, project, tokenData) {
    if (provider === 'github') {
        const login = tokenData.username || ''
        return {
            enabled: true,
            provider: 'github',
            repoUrl,
            baseBranch: (project.githubBaseBranch || 'main').trim() || 'main',
            token: tokenData.token,
            credentialUsername: 'x-access-token',
            identityName: login || 'Alldone Assistant',
            identityEmail: tokenData.email || (login ? `${login}@users.noreply.github.com` : 'assistant@alldone.app'),
            apiBase: project.githubApiBase || 'https://api.github.com',
            repoSlug: tokenData.repoSlug || '',
        }
    }
    return {
        enabled: true,
        provider: 'gitlab',
        repoUrl,
        baseBranch: (project.gitlabBaseBranch || 'main').trim() || 'main',
        token: tokenData.token,
        credentialUsername: 'oauth2',
        identityName: tokenData.username || 'Alldone Assistant',
        identityEmail: tokenData.email || 'assistant@alldone.app',
    }
}

// Read the project's connected repo (GitHub or GitLab) + the requesting user's token. Returns
// an { enabled: true, provider, ... } context only when a repo is connected AND the user has a
// token for it; { enabled: false, repoConnectedButNoToken: true } when a repo is connected but
// the user hasn't linked a token; otherwise null. Best-effort — never throws. GitHub is
// preferred if both providers happen to be connected on the same project.
async function loadRepoContext(vmJob) {
    try {
        const db = admin.firestore()
        const projectSnap = await db.doc(`projects/${vmJob.projectId}`).get()
        if (!projectSnap.exists) return null
        const project = projectSnap.data() || {}
        const userId = vmJob.requestUserId
        if (!userId) return null

        const providers = [
            { name: 'github', url: (project.githubRepoUrl || '').trim() },
            { name: 'gitlab', url: (project.gitlabRepoUrl || '').trim() },
        ].filter(p => p.url)
        if (!providers.length) return null

        for (const p of providers) {
            const tokenSnap = await db.doc(`users/${userId}/private/${p.name}Auth_${vmJob.projectId}`).get()
            const tokenData = tokenSnap.exists ? tokenSnap.data() || {} : {}
            if (tokenData.token) {
                tokenSnap.ref.set({ lastUsed: Date.now() }, { merge: true }).catch(() => {})
                return buildProviderContext(p.name, p.url, project, tokenData)
            }
        }
        // A repo is connected for the project, but THIS user hasn't linked their own token.
        return { enabled: false, repoConnectedButNoToken: true }
    } catch (error) {
        console.warn('🖥️ VM JOB: failed loading repo context', {
            correlationId: vmJob.correlationId,
            error: error.message,
        })
        return null
    }
}

// The per-command env carrying the git credentials + identity into the sandbox.
function buildGitEnv(gitContext) {
    const env = {
        GIT_TOKEN: gitContext.token,
        GIT_CRED_USERNAME: gitContext.credentialUsername || 'oauth2',
        GIT_REPO_URL: gitContext.repoUrl,
        GIT_BASE_BRANCH: gitContext.baseBranch,
        GIT_USER_NAME: gitContext.identityName,
        GIT_USER_EMAIL: gitContext.identityEmail,
        GIT_TERMINAL_PROMPT: '0',
    }
    if (gitContext.provider === 'github') {
        // Let the gh CLI / curl calls authenticate without re-plumbing the token.
        env.GH_TOKEN = gitContext.token
        env.GITHUB_TOKEN = gitContext.token
        env.GH_API = gitContext.apiBase || 'https://api.github.com'
        env.GH_REPO = gitContext.repoSlug || ''
        if (gitContext.apiBase && gitContext.apiBase !== 'https://api.github.com') {
            env.GH_HOST = gitContext.apiBase.replace(/^https?:\/\//, '').replace(/\/api\/v3$/, '')
        }
    }
    return env
}

// Clone (or refresh, on resume) the repo and configure git auth before the agent runs.
// Throws a user-facing error on failure so the job fails+refunds instead of running blind.
async function setupGitRepo(sandbox, gitContext, correlationId) {
    await sandbox.files.write('/home/user/git-setup.sh', GIT_SETUP_SCRIPT)
    let stderr = ''
    let stdout = ''
    try {
        await sandbox.commands.run('bash /home/user/git-setup.sh', {
            envs: buildGitEnv(gitContext),
            timeoutMs: 5 * 60 * 1000,
            onStdout: d => {
                stdout += d
            },
            onStderr: d => {
                stderr += d
            },
        })
    } catch (err) {
        // git error text won't contain the token (the credential helper output is not echoed).
        const detail = (stderr || err.message || '').substring(0, 300)
        throw new Error(`Could not prepare the connected GitLab repository. ${detail}`)
    }
    console.log('🖥️ VM JOB: git repo ready', {
        correlationId,
        head: ((stdout || '').match(/GIT_SETUP_OK (\S+)/) || [])[1] || null,
    })
}

async function setupRepoDependencies(sandbox, correlationId) {
    await sandbox.files.write('/home/user/repo-dependencies-setup.sh', REPO_DEPENDENCY_SETUP_SCRIPT)
    let stderr = ''
    let stdout = ''
    try {
        await sandbox.commands.run('bash /home/user/repo-dependencies-setup.sh', {
            timeoutMs: REPO_DEPENDENCY_INSTALL_TIMEOUT_MS,
            onStdout: d => {
                stdout += d
            },
            onStderr: d => {
                stderr += d
            },
        })
        const status = ((stdout || '').match(/DEPENDENCY_SETUP_(OK|SKIPPED[^\n]*)/) || [])[0] || null
        console.log('🖥️ VM JOB: repo dependency setup finished', {
            correlationId,
            status,
        })
    } catch (error) {
        console.warn('🖥️ VM JOB: repo dependency setup failed; continuing', {
            correlationId,
            error: error.message,
            stderrPreview: stderr ? stderr.substring(0, 500) : '',
        })
    }
}

/**
 * Update the single live status comment in place (created when the job started).
 * Falls back to creating a new comment if no commentId was recorded.
 */
async function writeStatusComment(pendingWebhook, text, { isFinal = false, output = null, mediaContext = null } = {}) {
    const { projectId, objectType = 'tasks', objectId, assistantId, statusCommentId } = pendingWebhook
    const db = admin.firestore()
    const commentPathBase = `chatComments/${projectId}/${objectType}/${objectId}/comments`

    const commentId = statusCommentId || Date.now().toString() + '-' + Math.random().toString(36).substring(2, 10)
    const commentPayload = {
        creatorId: assistantId,
        commentText: text,
        originalContent: text,
        commentType: 'STAYWARD_COMMENT',
        lastChangeDate: admin.firestore.Timestamp.now(),
        fromAssistant: true,
    }
    if (Array.isArray(mediaContext) && mediaContext.length) {
        commentPayload.mediaContext = mediaContext
    }
    if (isFinal && output != null) {
        commentPayload.webhookData = { output, correlationId: pendingWebhook.correlationId, kind: 'vm_job' }
        // The live VM status comment is created before the assistant's "started" reply.
        // When it becomes the final answer, move it to completion time so chronological
        // chat views show: user request -> VM started confirmation -> VM result.
        commentPayload.created = Date.now()
    }

    try {
        if (statusCommentId) {
            await db.doc(`${commentPathBase}/${commentId}`).set(commentPayload, { merge: true })
        } else {
            commentPayload.created = Date.now()
            await db.doc(`${commentPathBase}/${commentId}`).set(commentPayload)
        }
    } catch (error) {
        console.warn('🖥️ VM JOB: Failed writing status comment', {
            correlationId: pendingWebhook.correlationId,
            error: error.message,
        })
        return
    }

    // Keep the chat object / parent object comment preview in sync.
    if (isFinal) {
        try {
            const chatRef = db.doc(`chatObjects/${projectId}/chats/${objectId}`)
            const chatDoc = await chatRef.get()
            if (chatDoc.exists) {
                const current = chatDoc.data().commentsData || { amount: 0 }
                await chatRef.update({
                    commentsData: {
                        lastCommentOwnerId: assistantId,
                        lastComment: text.substring(0, 100),
                        lastCommentType: 'STAYWARD_COMMENT',
                        amount: current.amount || 0,
                    },
                    lastEditionDate: Date.now(),
                    lastEditorId: assistantId,
                })
            }
        } catch (error) {
            console.warn('🖥️ VM JOB: Failed updating chat object on finalize', {
                correlationId: pendingWebhook.correlationId,
                error: error.message,
            })
        }
    }
}

/**
 * Build the prompt fed to Claude Code inside the sandbox.
 */
function buildAgentPrompt(vmJob, gitContext = null) {
    const profile = TASK_TYPE_PROFILES[vmJob.taskType] || TASK_TYPE_PROFILES.research
    const parts = [profile, '', `# Objective`, vmJob.objective]
    if (vmJob.deliverable) {
        parts.push('', `# Expected deliverable`, vmJob.deliverable)
    }
    if (vmJob.packagedContext) {
        parts.push(
            '',
            `# Background context (provided from the app — also written to /home/user/context.md)`,
            vmJob.packagedContext
        )
    }
    if (vmJob.threadContext) {
        parts.push(
            '',
            '# Originating chat thread context (also written to /home/user/context.md)',
            'Context from the Alldone chat thread this task was created in — who the user is, the project, ' +
                'your assistant persona, the conversation so far, files shared in the thread, and the ' +
                "user's date/time and language. Use it to ground your work and match the intent and language " +
                'already established; do not ask for details already provided here.',
            vmJob.threadContext
        )
    }
    if (gitContext && gitContext.enabled) {
        const base = gitContext.baseBranch
        const isGithub = gitContext.provider === 'github'
        const providerName = isGithub ? 'GitHub' : 'GitLab'
        const reqName = isGithub ? 'Pull Request' : 'Merge Request'
        parts.push(
            '',
            '# Connected Git repository',
            `You are working inside a Git checkout of the project's connected ${providerName} repository at ${REPO_DIR} ` +
                `(already cloned and authenticated, with the base branch "${base}" checked out). This is your working directory — make your code changes there.`,
            `Only deliver the work as a ${providerName} ${reqName} when you actually changed repository files. Do NOT push to the base branch directly:`,
            `1. Create a new branch off "${base}": git checkout -b ai/<short-descriptive-slug>`,
            '2. Make your edits.',
            '3. Before committing, run git status --short and/or git diff --quiet. If there is no repository diff, do NOT commit, push, or open a Pull/Merge Request; just explain the answer or why no code change was needed in your final message.',
            '4. If there are actual repository changes, commit them with clear, conventional commit messages.',
            'The runner has already performed a best-effort dependency install for JavaScript/TypeScript repos. If a lint/test/build script still reports a missing local tool such as eslint, install the repo dependencies with its package manager and rerun the validation before giving up.'
        )
        if (isGithub) {
            parts.push(
                '5. Push the branch: git push -u origin HEAD',
                `6. Open the Pull Request with the GitHub CLI (already authenticated via $GH_TOKEN): gh pr create --base ${base} --head <your-branch> --title "<concise title>" --body "<summary of the change>"`,
                '   The gh command prints the Pull Request URL. If gh is not installed, instead POST to the GitHub REST API with curl: ' +
                    `curl -sS -X POST "$GH_API/repos/$GH_REPO/pulls" -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -d '{"title":"<title>","head":"<your-branch>","base":"${base}","body":"<summary>"}'  (read the "html_url" field from the JSON response).`,
                '7. Copy the Pull Request URL into your final message so the user can review it.'
            )
        } else {
            parts.push(
                '5. Push the branch AND open the Merge Request in a single command:',
                `   git push -u origin HEAD -o merge_request.create -o merge_request.target=${base} -o merge_request.title="<concise title>" -o merge_request.remove_source_branch`,
                '6. GitLab prints the Merge Request URL on stderr right after the push — copy that URL into your final message so the user can review it.'
            )
        }
        parts.push(
            'If git push, gh pr create, or the REST API call fails with a transient network or DNS error, wait briefly and retry before reporting failure.',
            'Authentication is already configured via a git credential helper. Do NOT change git remotes, credentials, or config, and never print, echo, or commit any tokens. ' +
                `If a direct push to the base branch is rejected because it is protected, that is expected — open a ${reqName} instead.`,
            `If you made repository changes, your final message MUST include the ${reqName} URL (or, if you genuinely could not open one, a clear explanation of why). If you made no repository changes, your final message MUST say that no ${reqName} was opened because no code change was needed.`
        )
    }
    parts.push(
        '',
        'Work autonomously to completion. Your final message will be delivered verbatim to the user as the result, so make it a complete, self-contained answer.',
        'IMPORTANT: Do not create an output file just to return a normal text/chat answer. Put the answer directly in your final message unless the user asked for a file or you genuinely produced an artifact.',
        'If you produce any deliverable files (documents, HTML, spreadsheets, images, datasets, etc.) that are NOT part of the repository, SAVE them into the /home/user/output/ directory (an absolute path). Every file there is uploaded back to the user and attached to your result in the chat. Do not paste large file contents into your final message — put them in /home/user/output/ instead.'
    )
    return parts.join('\n')
}

// --- Generated-file (artifact) return ---

const ARTIFACT_DIR = '/home/user/output'
const MAX_ARTIFACTS = 10
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024 // 20 MB per file
const MAX_ARTIFACTS_TOTAL_BYTES = 40 * 1024 * 1024 // 40 MB total

// Chat attachment token — mirrors ATTACHMENT_TRIGGER in components/Feeds/Utils/HelperFunctions.js.
// Embedding `${T}{url}${T}{name}${T}false` as a space-delimited word in the comment text makes the
// chat render an inline, downloadable FileDownloadableTag. (The mediaContext array alone does NOT
// produce the inline download; without a token a bare filename gets auto-linkified to a bogus URL.)
const ATTACHMENT_TRIGGER = 'EbDsQTD14ahtSR5'

// Build the space-delimited attachment tokens for the comment text from uploaded files.
function buildAttachmentTokens(mediaContext) {
    return mediaContext
        .map(m => {
            const name = (m.fileName || 'file').replace(/\s+/g, '_') // tokens must be whitespace-free
            return `${ATTACHMENT_TRIGGER}${m.storageUrl}${ATTACHMENT_TRIGGER}${name}${ATTACHMENT_TRIGGER}false`
        })
        .join(' ')
}

function buildVmFinalCommentText(output, mediaContext) {
    const message = String(output || '').trim()
    if (!Array.isArray(mediaContext) || !mediaContext.length) return message

    return `${buildAttachmentTokens(mediaContext)}\n\n${message}`
}

const MIME_BY_EXT = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    json: 'application/json',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
}

function mimeForFile(name) {
    const ext = (name.split('.').pop() || '').toLowerCase()
    return MIME_BY_EXT[ext] || 'application/octet-stream'
}

// Pull deliverable files the agent wrote to /home/user/output out of the sandbox.
// Best-effort: returns [] on any failure so a file hiccup never fails the whole job.
async function collectArtifacts(sandbox, correlationId, sinceMs = 0) {
    try {
        let entries
        try {
            entries = await sandbox.files.list(ARTIFACT_DIR, { depth: 5 })
        } catch (_) {
            return [] // dir missing / empty
        }
        // On a resumed session, only collect files written/modified during THIS run, so we
        // don't re-attach deliverables from previous runs that are still in /home/user/output.
        const skewMs = 5000
        const files = (entries || []).filter(e => {
            if (!((e.type === 'file' || e.type === undefined) && e.size > 0)) return false
            if (!sinceMs) return true
            const mt = e.modifiedTime ? new Date(e.modifiedTime).getTime() : 0
            return mt === 0 || mt >= sinceMs - skewMs
        })
        const artifacts = []
        let totalBytes = 0
        for (const entry of files) {
            if (artifacts.length >= MAX_ARTIFACTS) break
            if (entry.size > MAX_ARTIFACT_BYTES) {
                console.warn('🖥️ VM JOB: skipping oversized artifact', {
                    correlationId,
                    name: entry.name,
                    size: entry.size,
                })
                continue
            }
            if (totalBytes + entry.size > MAX_ARTIFACTS_TOTAL_BYTES) break
            try {
                const data = await sandbox.files.read(entry.path, { format: 'bytes' })
                const buffer = Buffer.from(data)
                totalBytes += buffer.length
                artifacts.push({ fileName: entry.name, mimeType: mimeForFile(entry.name), bytes: buffer })
            } catch (error) {
                console.warn('🖥️ VM JOB: failed reading artifact', {
                    correlationId,
                    name: entry.name,
                    error: error.message,
                })
            }
        }
        if (artifacts.length) {
            console.log('🖥️ VM JOB: collected artifacts', {
                correlationId,
                count: artifacts.length,
                names: artifacts.map(a => a.fileName),
            })
        }
        return artifacts
    } catch (error) {
        console.warn('🖥️ VM JOB: collectArtifacts failed', { correlationId, error: error.message })
        return []
    }
}

// --- Live activity feed from agent stream events ---

const MAX_ACTIVITY_LINES = 15

function truncate(value, n) {
    const s = String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
    return s.length > n ? s.substring(0, n) + '…' : s
}

// Map a Claude Code tool_use block to a friendly, human-readable activity line.
function claudeToolLabel(name, input) {
    const i = input || {}
    switch (name) {
        case 'WebSearch':
            return `🔍 Searching the web${i.query ? `: "${truncate(i.query, 80)}"` : '…'}`
        case 'WebFetch':
            return `🌐 Reading ${truncate(i.url || '', 80)}`
        case 'Bash':
            return `💻 ${truncate(i.command || 'running a command', 100)}`
        case 'Read':
            return `📄 Reading ${truncate(i.file_path || i.path || '', 80)}`
        case 'Write':
            return `✍️ Writing ${truncate(i.file_path || i.path || '', 80)}`
        case 'Edit':
        case 'MultiEdit':
            return `✏️ Editing ${truncate(i.file_path || i.path || '', 80)}`
        case 'Glob':
        case 'Grep':
            return `🔎 Searching files${i.pattern ? `: ${truncate(i.pattern, 60)}` : '…'}`
        case 'TodoWrite':
            return '🗒️ Planning the work…'
        default:
            return `🔧 ${name || 'tool'}`
    }
}

// Claude Code stream-json event → mutate state { activity[], finalResult, assistantText }.
// Final answer comes from the terminal `result` event.
function appendClaudeActivity(evt, state) {
    if (!evt || typeof evt !== 'object') return
    if (evt.type === 'result') {
        if (typeof evt.result === 'string') state.finalResult = evt.result
        if (evt.usage) {
            const u = evt.usage
            const cache = (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
            const input = u.input_tokens || 0
            const output = u.output_tokens || 0
            state.usage = {
                inputTokens: input,
                outputTokens: output,
                cacheTokens: cache,
                totalTokens: input + output + cache,
                costUsd: typeof evt.total_cost_usd === 'number' ? evt.total_cost_usd : null,
            }
        }
        return
    }
    if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
        for (const b of evt.message.content) {
            if (b && b.type === 'text' && b.text) {
                state.assistantText += b.text
                if (b.text.trim()) state.activity.push(`💬 ${truncate(b.text, 200)}`)
            } else if (b && b.type === 'tool_use') {
                state.activity.push(claudeToolLabel(b.name, b.input))
            }
        }
    }
}

// OpenAI Codex `exec --json` event → mutate state. There is no `result` event; the
// final answer is the last `agent_message` item's text.
function appendCodexActivity(evt, state) {
    if (!evt || typeof evt !== 'object') return
    if (evt.type === 'error') {
        state.activity.push(`⚠️ ${truncate(evt.message || evt.error || 'error', 160)}`)
        return
    }
    if (evt.type === 'turn.completed') {
        const u = evt.usage || {}
        const input = u.input_tokens || 0
        const output = u.output_tokens || 0
        const cache = u.cached_input_tokens || 0
        state.usage = {
            inputTokens: input,
            outputTokens: output,
            cacheTokens: cache,
            totalTokens: u.total_tokens || input + output + cache,
            costUsd: null,
        }
        return
    }
    const item = evt.item
    if (!item || typeof item !== 'object') return
    const completed = evt.type === 'item.completed' || evt.type === 'item.done'
    switch (item.type) {
        case 'agent_message':
            if (typeof item.text === 'string' && item.text) {
                state.assistantText = item.text // last agent message is the final answer
                if (completed && item.text.trim()) state.activity.push(`💬 ${truncate(item.text, 200)}`)
            }
            break
        case 'reasoning':
            if (completed && item.text) state.activity.push(`💭 ${truncate(item.text, 160)}`)
            break
        case 'command_execution':
            if (completed) state.activity.push(`💻 ${truncate(item.command || 'command', 100)}`)
            break
        case 'web_search':
            if (completed) state.activity.push(`🔍 Searching${item.query ? `: "${truncate(item.query, 80)}"` : '…'}`)
            break
        case 'file_change':
            if (completed) state.activity.push('✏️ Editing files')
            break
        case 'mcp_tool_call':
            if (completed) state.activity.push(`🔧 ${truncate(item.tool || item.name || 'tool', 60)}`)
            break
        case 'todo_list':
        case 'plan_update':
            if (completed) state.activity.push('🗒️ Planning the work…')
            break
        default:
            break
    }
}

function renderVmWorkingHeader(agentLabel) {
    return `🖥️ Working with ${agentLabel} in a VM…`
}

function renderActivityLog(lines, agentLabel) {
    return `${renderVmWorkingHeader(agentLabel)}\n\n${lines.slice(-MAX_ACTIVITY_LINES).join('\n')}`
}

// Per-agent configuration. The assistant picks the agent per task; we map it to the
// matching E2B prebuilt template, API key, sandbox env, headless command, and parser.
// E2B_*_TEMPLATE env vars are optional overrides — they default to E2B's prebuilt names.
const AGENT_CONFIGS = {
    claude: {
        label: 'Claude Code',
        displayName: 'Claude',
        defaultTemplate: 'claude',
        templateEnvKey: 'E2B_CLAUDE_TEMPLATE',
        apiKeyField: 'ANTHROPIC_API_KEY',
        installGuard: '(command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code >/dev/null 2>&1)',
        // On resume, `--continue` continues the most recent session in the working dir.
        buildRun: isResume =>
            `claude -p ${
                isResume ? '--continue ' : ''
            }"$(cat /home/user/prompt.txt)" --output-format stream-json --verbose --dangerously-skip-permissions </dev/null`,
        // `apiKey` is the real key in direct mode, or a short-lived per-job proxy token in proxy
        // mode; when `baseUrl` is set, Claude Code is pointed at the proxy and the real key stays
        // server-side (see vmLlmProxy.js).
        sandboxEnv: ({ apiKey, baseUrl }) => ({
            ANTHROPIC_API_KEY: apiKey,
            ...(baseUrl ? { ANTHROPIC_BASE_URL: `${baseUrl}/anthropic` } : {}),
            CI: 'true',
            DISABLE_AUTOUPDATER: '1',
            DISABLE_TELEMETRY: '1',
            DISABLE_ERROR_REPORTING: '1',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        }),
        handleEvent: appendClaudeActivity,
    },
    codex: {
        label: 'Codex',
        displayName: 'Codex',
        defaultTemplate: 'codex',
        templateEnvKey: 'E2B_CODEX_TEMPLATE',
        apiKeyField: 'OPEN_AI_KEY', // reuse the existing OpenAI key
        installGuard: '(command -v codex >/dev/null 2>&1 || npm install -g @openai/codex >/dev/null 2>&1)',
        // On resume, `codex exec resume --last` continues the most recent thread.
        // Codex has its own command sandbox inside the E2B sandbox. `--full-auto` maps to
        // workspace-write and does not grant outbound network by itself, so enable network
        // explicitly for package installs, git push, and PR creation.
        buildRun: isResume =>
            isResume
                ? `codex exec resume --last --ask-for-approval never --sandbox workspace-write -c sandbox_workspace_write.network_access=true --skip-git-repo-check --json "$(cat /home/user/prompt.txt)" </dev/null`
                : `codex exec --ask-for-approval never --sandbox workspace-write -c sandbox_workspace_write.network_access=true --skip-git-repo-check --json "$(cat /home/user/prompt.txt)" </dev/null`,
        // `apiKey` is the real key in direct mode, or a short-lived per-job proxy token in proxy
        // mode; when `baseUrl` is set, Codex is pointed at the proxy via OPENAI_BASE_URL and the
        // real key stays server-side (see vmLlmProxy.js).
        sandboxEnv: ({ apiKey, baseUrl }) => ({
            CODEX_API_KEY: apiKey,
            OPENAI_API_KEY: apiKey,
            ...(baseUrl ? { OPENAI_BASE_URL: `${baseUrl}/openai/v1` } : {}),
            CI: 'true',
        }),
        handleEvent: appendCodexActivity,
    },
}

const DEFAULT_AGENT = 'claude'

class VmGoldExhaustedError extends Error {
    constructor(message = VM_GOLD_EXHAUSTED_TEXT, runtimeGoldCharged = 0) {
        super(message)
        this.name = 'VmGoldExhaustedError'
        this.code = VM_GOLD_EXHAUSTED_FAILURE_REASON
        this.runtimeGoldCharged = runtimeGoldCharged
    }
}

function isVmGoldExhaustedError(error) {
    return error && error.code === VM_GOLD_EXHAUSTED_FAILURE_REASON
}

function calculateAccruedRuntimeGold(runtimeMs) {
    const elapsedMinutes = Math.floor(Math.max(0, Number(runtimeMs) || 0) / 60000)
    return elapsedMinutes * VM_GOLD_PER_MINUTE
}

function calculateCompletionGoldCharges({ runtimeMs, usage, runtimeGoldCharged = 0 }) {
    const minutes = Math.max(1, Math.ceil(Math.max(0, Number(runtimeMs) || 0) / 60000))
    const totalTokens = usage && usage.totalTokens ? usage.totalTokens : 0
    const runtimeGoldTotal = minutes * VM_GOLD_PER_MINUTE
    const runtimeGoldRemaining = Math.max(0, runtimeGoldTotal - (Number(runtimeGoldCharged) || 0))
    const tokenGold = Math.round(totalTokens / VM_TOKENS_PER_GOLD)
    return {
        minutes,
        totalTokens,
        runtimeGoldTotal,
        runtimeGoldRemaining,
        runtimeGoldCharged: Number(runtimeGoldCharged) || 0,
        tokenGold,
        topup: runtimeGoldRemaining + tokenGold,
    }
}

async function getUserGoldBalance(userId) {
    try {
        const snap = await admin.firestore().doc(`users/${userId}`).get()
        if (!snap.exists) return 0
        return Number(snap.data()?.gold) || 0
    } catch (error) {
        console.warn('🖥️ VM JOB: failed reading user Gold balance', { userId, error: error.message })
        throw error
    }
}

function buildVmGoldContext(pendingWebhook, vmJob, note) {
    return {
        source: VM_JOB_GOLD_SOURCE,
        channel: 'assistant',
        projectId: pendingWebhook.projectId,
        objectId: pendingWebhook.objectId,
        objectType: pendingWebhook.objectType,
        note: note || `VM ${vmJob.agent || 'claude'} runtime`,
    }
}

async function killCommandForGold(commandHandle, runtimeGoldCharged) {
    const error = new VmGoldExhaustedError(VM_GOLD_EXHAUSTED_TEXT, runtimeGoldCharged)
    if (commandHandle && typeof commandHandle.kill === 'function') {
        commandHandle.kill().catch(killError => {
            console.warn('🖥️ VM JOB: failed killing command after Gold exhaustion', { error: killError.message })
        })
    }
    throw error
}

async function checkAndChargeVmRuntimeGold({
    pendingWebhook,
    pendingRef,
    commandHandle,
    runStartMs,
    runtimeGoldCharged = 0,
    vmJob,
    now = Date.now,
    getCurrentGold = getUserGoldBalance,
    deductGoldFn = null,
}) {
    const currentGold = await getCurrentGold(pendingWebhook.userId)
    if (currentGold <= 0) {
        await killCommandForGold(commandHandle, runtimeGoldCharged)
    }

    const accruedGold = calculateAccruedRuntimeGold(now() - runStartMs)
    const chargeDue = Math.max(0, accruedGold - runtimeGoldCharged)
    if (chargeDue <= 0) return runtimeGoldCharged

    const amountToCharge = Math.min(chargeDue, currentGold)
    const deductGold = deductGoldFn || require('../Gold/goldHelper').deductGold
    const context = buildVmGoldContext(
        pendingWebhook,
        vmJob,
        `VM ${vmJob.agent || 'claude'} runtime charge (${accruedGold} accrued Gold)`
    )

    let charged = 0
    let balanceAfter = currentGold
    let result
    try {
        result = await deductGold(pendingWebhook.userId, amountToCharge, context)
    } catch (error) {
        error.runtimeGoldCharged = runtimeGoldCharged
        throw error
    }
    if (result && result.success) {
        charged = Number(result.amount) || amountToCharge
        balanceAfter = typeof result.newBalance === 'number' ? result.newBalance : currentGold - charged
    } else if (result && typeof result.currentGold === 'number' && result.currentGold > 0) {
        const fallbackAmount = Math.min(chargeDue, result.currentGold)
        let fallback
        try {
            fallback = await deductGold(pendingWebhook.userId, fallbackAmount, context)
        } catch (error) {
            error.runtimeGoldCharged = runtimeGoldCharged
            throw error
        }
        if (fallback && fallback.success) {
            charged = Number(fallback.amount) || fallbackAmount
            balanceAfter = typeof fallback.newBalance === 'number' ? fallback.newBalance : result.currentGold - charged
        }
    }

    const updatedRuntimeGoldCharged = runtimeGoldCharged + charged
    if (charged > 0 && pendingRef && typeof pendingRef.update === 'function') {
        await pendingRef.update({ runtimeGoldCharged: updatedRuntimeGoldCharged }).catch(() => {})
    }

    if (charged < chargeDue || balanceAfter <= 0) {
        await killCommandForGold(commandHandle, updatedRuntimeGoldCharged)
    }

    return updatedRuntimeGoldCharged
}

function startVmRuntimeGoldMonitor({
    pendingWebhook,
    pendingRef,
    commandHandle,
    runStartMs,
    vmJob,
    initialRuntimeGoldCharged = 0,
    intervalMs = VM_GOLD_MONITOR_INTERVAL_MS,
}) {
    let runtimeGoldCharged = Number(initialRuntimeGoldCharged) || 0
    let stopped = false
    let checking = false
    let timer = null
    let rejectMonitor
    const promise = new Promise((_, reject) => {
        rejectMonitor = reject
    })

    const tick = async () => {
        if (stopped || checking) return
        checking = true
        try {
            const nextRuntimeGoldCharged = await checkAndChargeVmRuntimeGold({
                pendingWebhook,
                pendingRef,
                commandHandle,
                runStartMs,
                runtimeGoldCharged,
                vmJob,
            })
            if (!stopped) runtimeGoldCharged = nextRuntimeGoldCharged
        } catch (error) {
            if (stopped) return
            stopped = true
            if (timer) clearInterval(timer)
            if (typeof error.runtimeGoldCharged !== 'number') error.runtimeGoldCharged = runtimeGoldCharged
            rejectMonitor(error)
        } finally {
            checking = false
        }
    }

    timer = setInterval(tick, intervalMs)
    return {
        promise,
        stop: () => {
            stopped = true
            if (timer) clearInterval(timer)
        },
        getRuntimeGoldCharged: () => runtimeGoldCharged,
    }
}

// One persistent VM session per chat thread.
function vmSessionDocId(vmJob) {
    return `${vmJob.projectId}__${vmJob.objectId}`
}

// Pause an E2B sandbox via the REST API (e2b@1.x exposes no pause() method). The paused
// sandbox keeps its full state and is resumable later via Sandbox.connect(sandboxId).
async function pauseE2bSandbox(sandboxId, e2bApiKey) {
    const resp = await fetch(`${E2B_API_BASE}/sandboxes/${sandboxId}/pause`, {
        method: 'POST',
        headers: { 'X-API-KEY': e2bApiKey, 'Content-Type': 'application/json' },
    })
    if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        throw new Error(`E2B pause ${resp.status}: ${body.substring(0, 200)}`)
    }
}

// Resume a PAUSED sandbox back to running. e2b@1.x's Sandbox.connect only attaches to a
// RUNNING sandbox — it does NOT auto-resume a paused one (operations 404 otherwise), so a
// paused session must be resumed via this REST call first. `timeout` is the new TTL (seconds).
async function resumeE2bSandbox(sandboxId, e2bApiKey, timeoutSec) {
    const resp = await fetch(`${E2B_API_BASE}/sandboxes/${sandboxId}/resume`, {
        method: 'POST',
        headers: { 'X-API-KEY': e2bApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: timeoutSec, autoPause: false }),
    })
    if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        throw new Error(`E2B resume ${resp.status}: ${body.substring(0, 200)}`)
    }
}

// After a run, KEEP the sandbox running for the keep-alive grace window (so back-to-back
// tasks hit a live VM) and record the session as 'running'. The scheduled pauser pauses it
// once idle. If keep-alive can't be set, fall back to pausing now; if that also fails, kill.
async function keepVmSessionAlive(sessionRef, sandbox, vmJob, e2bApiKey) {
    const sandboxId = sandbox.sandboxId || sandbox.id
    const baseDoc = {
        sandboxId,
        agent: vmJob.agent || DEFAULT_AGENT,
        projectId: vmJob.projectId,
        objectId: vmJob.objectId,
        lastUsedAt: Date.now(),
    }
    try {
        await sandbox.setTimeout(KEEP_ALIVE_KILL_MS) // stays alive ~15 min unless reused/paused
        await sessionRef.set({ ...baseDoc, status: 'running' }, { merge: true })
        console.log('🖥️ VM JOB: session kept alive (running)', {
            correlationId: vmJob.correlationId,
            sandboxId,
            graceMs: KEEP_ALIVE_GRACE_MS,
        })
    } catch (error) {
        console.warn('🖥️ VM JOB: keep-alive failed — pausing instead', {
            correlationId: vmJob.correlationId,
            error: error.message,
        })
        try {
            await pauseE2bSandbox(sandboxId, e2bApiKey)
            await sessionRef.set({ ...baseDoc, status: 'paused' }, { merge: true })
        } catch (e2) {
            try {
                await sandbox.kill()
            } catch (_) {}
            await sessionRef.delete().catch(() => {})
        }
    }
}

// Scheduled pauser: pause running sandboxes that have been idle past the keep-alive window,
// so we stop paying compute while preserving state for a later resume.
async function pauseIdleVmSessions() {
    const e2bApiKey = getEnvFunctions().E2B_API_KEY
    if (!e2bApiKey) return
    const cutoff = Date.now() - KEEP_ALIVE_GRACE_MS
    // Single-field query (no composite index); filter to running in code.
    const snap = await admin.firestore().collection('vmSessions').where('lastUsedAt', '<', cutoff).get()
    const running = snap.docs.filter(d => (d.data().status || 'paused') === 'running' && d.data().sandboxId)
    console.log('💤 VM SESSIONS PAUSER: idle running sessions', { count: running.length })
    for (const doc of running) {
        const s = doc.data()
        try {
            await pauseE2bSandbox(s.sandboxId, e2bApiKey)
            await doc.ref.set({ status: 'paused', pausedAt: Date.now() }, { merge: true })
            console.log('💤 VM SESSIONS PAUSER: paused', { sandboxId: s.sandboxId })
        } catch (error) {
            // Likely already killed (kill timeout) — clear so the thread starts fresh next time.
            console.warn('💤 VM SESSIONS PAUSER: pause failed, clearing session', {
                sandboxId: s.sandboxId,
                error: error.message,
            })
            await doc.ref.delete().catch(() => {})
        }
    }
}

// Scheduled cleanup: delete paused sandboxes (and their session docs) idle longer than the TTL.
async function cleanupIdleVmSessions() {
    const { Sandbox } = require('e2b')
    const e2bApiKey = getEnvFunctions().E2B_API_KEY
    const cutoff = Date.now() - SESSION_TTL_MS
    const snap = await admin.firestore().collection('vmSessions').where('lastUsedAt', '<', cutoff).get()
    console.log('🧹 VM SESSIONS CLEANUP: idle sessions found', { count: snap.size })
    for (const doc of snap.docs) {
        const s = doc.data()
        if (s.sandboxId && e2bApiKey) {
            try {
                await Sandbox.kill(s.sandboxId, { apiKey: e2bApiKey })
            } catch (error) {
                console.warn('🧹 VM SESSIONS CLEANUP: kill failed', { sandboxId: s.sandboxId, error: error.message })
            }
        }
        await doc.ref.delete().catch(() => {})
    }
}

/**
 * Run the selected agent (Claude Code or Codex) headless in an E2B sandbox and return its
 * final output. Resumes the chat thread's paused sandbox if one exists (so the agent
 * continues with prior files + conversation), else starts fresh. Parses the agent's JSON
 * event stream to surface live activity via onActivity(text), and pauses the sandbox on
 * completion so the session can be resumed later.
 */
async function runAgentInSandbox(
    vmJob,
    config,
    apiKey,
    e2bApiKey,
    onActivity,
    gitContext = null,
    pendingWebhook = null,
    pendingRef = null
) {
    const { Sandbox } = require('e2b')
    const env = getEnvFunctions()
    const agentLabel = config.displayName || config.label || getAgentLabel(vmJob.agent || DEFAULT_AGENT)
    // Template defaults to E2B's prebuilt name for this agent; the env var is an optional override.
    const template = env[config.templateEnvKey] || process.env[config.templateEnvKey] || config.defaultTemplate
    const sessionRef = admin.firestore().doc(`vmSessions/${vmSessionDocId(vmJob)}`)

    // Resume the thread's paused sandbox (same agent) if there is one; else create fresh.
    let sandbox = null
    let isResume = false
    let runtimeGoldCharged = Number(pendingWebhook?.runtimeGoldCharged) || 0
    try {
        const sessSnap = await sessionRef.get()
        const sess = sessSnap.exists ? sessSnap.data() : null
        if (sess && sess.sandboxId && sess.agent === (vmJob.agent || DEFAULT_AGENT)) {
            try {
                // A paused sandbox must be explicitly resumed first (connect alone won't
                // auto-resume it on e2b@1.x); a still-running one (keep-alive) just connects.
                if (sess.status !== 'running') {
                    await resumeE2bSandbox(sess.sandboxId, e2bApiKey, Math.ceil(MAX_VM_RUNTIME_MS / 1000))
                }
                sandbox = await Sandbox.connect(sess.sandboxId, { apiKey: e2bApiKey, allowInternetAccess: true })
                await sandbox.setTimeout(MAX_VM_RUNTIME_MS).catch(() => {})
                isResume = true
                console.log('🖥️ VM JOB: resumed session', {
                    correlationId: vmJob.correlationId,
                    sandboxId: sess.sandboxId,
                    wasPaused: sess.status !== 'running',
                })
            } catch (error) {
                console.warn('🖥️ VM JOB: resume failed, starting fresh', {
                    correlationId: vmJob.correlationId,
                    error: error.message,
                })
                await sessionRef.delete().catch(() => {})
            }
        }
    } catch (error) {
        console.warn('🖥️ VM JOB: session lookup failed', { correlationId: vmJob.correlationId, error: error.message })
    }

    if (!sandbox) {
        const createOpts = { apiKey: e2bApiKey, timeoutMs: MAX_VM_RUNTIME_MS, allowInternetAccess: true }
        console.log('🖥️ VM JOB: creating sandbox', {
            correlationId: vmJob.correlationId,
            agent: config.label,
            template,
            timeoutMs: MAX_VM_RUNTIME_MS,
        })
        sandbox = template ? await Sandbox.create(template, createOpts) : await Sandbox.create(createOpts)
    }
    console.log('🖥️ VM JOB: sandbox ready', {
        correlationId: vmJob.correlationId,
        sandboxId: sandbox.sandboxId || sandbox.id || null,
        resume: isResume,
    })

    try {
        const prompt = buildAgentPrompt(vmJob, gitContext)
        await sandbox.files.write('/home/user/prompt.txt', prompt)
        const contextFileContent = [vmJob.packagedContext, vmJob.threadContext].filter(Boolean).join('\n\n---\n\n')
        await sandbox.files.write('/home/user/context.md', contextFileContent)

        // Clone/refresh the connected GitLab repo and configure auth before the agent runs.
        if (gitContext && gitContext.enabled) {
            if (typeof onActivity === 'function') {
                onActivity(
                    `${renderVmWorkingHeader(agentLabel)}\n\n📥 ${
                        isResume ? 'Refreshing' : 'Cloning'
                    } the connected repository…`
                )
            }
            await setupGitRepo(sandbox, gitContext, vmJob.correlationId)
            if (typeof onActivity === 'function') {
                onActivity(`${renderVmWorkingHeader(agentLabel)}\n\n📦 Installing repository dependencies when needed…`)
            }
            await setupRepoDependencies(sandbox, vmJob.correlationId)
        }

        const state = { activity: [], finalResult: '', assistantText: '', usage: null }
        let stdoutBuf = ''
        let stderr = ''

        // The agent emits one JSON event per line. Parse complete lines, let the
        // agent-specific handler update activity + capture the final answer, and push
        // a fresh activity log to the chat whenever a new line is added.
        const handleLine = rawLine => {
            const line = rawLine.trim()
            if (!line) return
            let evt
            try {
                evt = JSON.parse(line)
            } catch (_) {
                return // non-JSON noise (e.g. stray install output) — ignore
            }
            const before = state.activity.length
            config.handleEvent(evt, state)
            if (state.activity.length > before && typeof onActivity === 'function') {
                onActivity(renderActivityLog(state.activity, agentLabel))
            }
        }
        const handleStdout = data => {
            stdoutBuf += data
            let idx
            while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
                handleLine(stdoutBuf.slice(0, idx))
                stdoutBuf = stdoutBuf.slice(idx + 1)
            }
        }
        const handleStderr = data => {
            stderr += data
        }

        // Run the agent headless. The prompt is passed as a positional argument (NOT piped
        // via stdin — reading stdin can hang non-interactively), and stdin is from /dev/null
        // so any unexpected interactive read gets EOF instead of blocking until the timeout.
        // For a git-enabled coding task the working dir is the cloned repo; deliverable files
        // still go to the absolute /home/user/output. Git credentials are injected per-command
        // via envs (never persisted to disk).
        const workdir = gitContext && gitContext.enabled ? REPO_DIR : '/home/user'
        // Keep the real Anthropic/OpenAI key OUT of the sandbox when the proxy is configured: the
        // agent gets a short-lived per-job token + the proxy base URL instead, and the real key is
        // swapped in server-side by vmLlmProxy. Falls back to the real key if the proxy is unset.
        const { buildVmAgentCredentials } = require('./vmLlmProxy')
        const agentCredentials = buildVmAgentCredentials({
            vmJob,
            agent: vmJob.agent || DEFAULT_AGENT,
            realApiKey: apiKey,
            ttlMs: MAX_VM_RUNTIME_MS + 5 * 60 * 1000,
        })
        console.log('🖥️ VM JOB: agent credential mode', {
            correlationId: vmJob.correlationId,
            mode: agentCredentials.mode,
        })
        const agentEnv = config.sandboxEnv(agentCredentials)
        const runEnvs = gitContext && gitContext.enabled ? { ...agentEnv, ...buildGitEnv(gitContext) } : agentEnv
        const command = `mkdir -p /home/user/output && cd ${workdir} && ${config.installGuard} && ${config.buildRun(
            isResume
        )}`

        const runStartMs = Date.now()
        console.log('🖥️ VM JOB: running agent command', {
            correlationId: vmJob.correlationId,
            agent: config.label,
            resume: isResume,
        })
        let result
        try {
            const commandHandle = await sandbox.commands.run(`bash -lc '${command.replace(/'/g, `'\\''`)}'`, {
                envs: runEnvs,
                timeoutMs: MAX_VM_RUNTIME_MS,
                background: true,
                onStdout: handleStdout,
                onStderr: handleStderr,
            })
            const commandPromise = commandHandle.wait()
            const monitor =
                pendingWebhook && pendingRef
                    ? startVmRuntimeGoldMonitor({
                          pendingWebhook,
                          pendingRef,
                          commandHandle,
                          runStartMs,
                          vmJob,
                          initialRuntimeGoldCharged: runtimeGoldCharged,
                      })
                    : null

            try {
                result = await Promise.race([commandPromise, monitor ? monitor.promise : new Promise(() => {})])
            } catch (error) {
                if (isVmGoldExhaustedError(error)) {
                    runtimeGoldCharged = error.runtimeGoldCharged || runtimeGoldCharged
                    await commandPromise.catch(() => {})
                }
                throw error
            } finally {
                if (monitor) {
                    monitor.stop()
                    runtimeGoldCharged = monitor.getRuntimeGoldCharged()
                }
            }
        } catch (runError) {
            // The command was killed (e.g. timeout) before returning — log whatever it
            // produced so we can see where the agent got stuck, then rethrow.
            console.error('🖥️ VM JOB: command errored/terminated', {
                correlationId: vmJob.correlationId,
                agent: config.label,
                error: runError.message,
                events: state.activity.length,
                lastActivity: state.activity.slice(-3),
                stdoutBufLen: stdoutBuf.length,
                stderrLen: stderr.length,
                stderrPreview: stderr ? stderr.substring(0, 800) : '',
                runtimeGoldCharged,
            })
            if (typeof runError.runtimeGoldCharged !== 'number') runError.runtimeGoldCharged = runtimeGoldCharged
            throw runError
        }
        if (stdoutBuf.trim()) handleLine(stdoutBuf) // flush any trailing partial line
        console.log('🖥️ VM JOB: command finished', {
            correlationId: vmJob.correlationId,
            agent: config.label,
            exitCode: result?.exitCode,
            events: state.activity.length,
            finalResultLen: (state.finalResult || state.assistantText).length,
            stderrLen: stderr.length,
            stderrPreview: stderr ? stderr.substring(0, 300) : '',
        })

        const output = (state.finalResult || state.assistantText || '').trim()
        if (!output) {
            const detail = ` exitCode=${result?.exitCode}${stderr ? `: ${stderr.substring(0, 500)}` : ''}`
            throw new Error(`Agent produced no output.${detail}`)
        }
        // Collect deliverable files written during THIS run (while the sandbox is still alive).
        const artifacts = await collectArtifacts(sandbox, vmJob.correlationId, runStartMs)
        // Keep the sandbox alive (grace window) + record the session so the thread can resume it.
        await keepVmSessionAlive(sessionRef, sandbox, vmJob, e2bApiKey)
        return { output, usage: state.usage, artifacts, runtimeGoldCharged }
    } catch (err) {
        // Preserve the session on failure too, so prior work in the thread isn't lost.
        await keepVmSessionAlive(sessionRef, sandbox, vmJob, e2bApiKey).catch(() => {})
        if (typeof err.runtimeGoldCharged !== 'number') err.runtimeGoldCharged = runtimeGoldCharged
        throw err
    }
}

/**
 * Refund the Gold charged for a job that failed before producing a result.
 */
async function refundVmJob(pendingWebhook, reason, extraGold = 0) {
    const amount = (Number(pendingWebhook.goldCharged) || 0) + (Number(extraGold) || 0)
    if (!amount) return
    try {
        const { refundGold } = require('../Gold/goldHelper')
        await refundGold(pendingWebhook.userId, amount, {
            source: VM_JOB_GOLD_REFUND_SOURCE,
            channel: 'assistant',
            projectId: pendingWebhook.projectId,
            objectId: pendingWebhook.objectId,
            objectType: pendingWebhook.objectType,
            note: reason || 'VM task failed',
        })
    } catch (error) {
        console.error('🖥️ VM JOB: Failed to refund Gold', {
            correlationId: pendingWebhook.correlationId,
            error: error.message,
        })
    }
}

/**
 * Upload the agent's generated files to Firebase Storage and build the `mediaContext`
 * array the chat uses for attachments (same shape as user-uploaded chat files).
 */
async function uploadArtifacts(pendingWebhook, artifacts) {
    if (!Array.isArray(artifacts) || !artifacts.length) return []
    const { v4: uuidv4 } = require('uuid')
    const bucket = admin.storage().bucket()
    const commentId = pendingWebhook.statusCommentId || pendingWebhook.correlationId
    const mediaContext = []
    for (const artifact of artifacts) {
        try {
            const token = uuidv4()
            const storagePath = `attachments/${commentId}/${artifact.fileName}`
            await bucket.file(storagePath).save(artifact.bytes, {
                resumable: false,
                contentType: artifact.mimeType,
                metadata: { metadata: { firebaseStorageDownloadTokens: token } },
            })
            const storageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
                storagePath
            )}?alt=media&token=${token}`
            const isImage = artifact.mimeType.startsWith('image/')
            mediaContext.push({
                kind: isImage ? 'image' : 'file',
                fileName: artifact.fileName,
                mimeType: artifact.mimeType,
                storageUrl,
                previewUrl: isImage ? storageUrl : '',
                extractedText: '',
                extractionStatus: '',
            })
        } catch (error) {
            console.warn('🖥️ VM JOB: failed uploading artifact', {
                correlationId: pendingWebhook.correlationId,
                name: artifact.fileName,
                error: error.message,
            })
        }
    }
    return mediaContext
}

/**
 * Charge the metered Gold top-up after a successful run: per-minute (E2B compute) +
 * per-token (LLM usage). The base reserve was already charged up-front in startVmJob.
 * If the user can't cover the full amount, charge whatever balance remains.
 */
async function chargeVmTopup(
    pendingWebhook,
    vmJob,
    { topup, minutes, totalTokens, costUsd, runtimeGoldAlreadyCharged = 0, runtimeGoldRemaining = 0, tokenGold = 0 }
) {
    if (!topup || topup <= 0) return
    const { deductGold } = require('../Gold/goldHelper')
    const note =
        `VM ${vmJob.agent || 'claude'} metered: ${minutes} min ` +
        `(${runtimeGoldAlreadyCharged} runtime Gold already charged, ${runtimeGoldRemaining} runtime Gold remaining) ` +
        `+ ${totalTokens} tokens (${tokenGold} Gold)` +
        (typeof costUsd === 'number' ? ` (~$${costUsd.toFixed(2)})` : '')
    const ctx = {
        source: VM_JOB_GOLD_SOURCE,
        channel: 'assistant',
        projectId: pendingWebhook.projectId,
        objectId: pendingWebhook.objectId,
        objectType: pendingWebhook.objectType,
        note,
    }
    const result = await deductGold(pendingWebhook.userId, topup, ctx).catch(() => null)
    // Run already completed — if the user lacks enough Gold, take what's left.
    if (result && result.success === false && typeof result.currentGold === 'number' && result.currentGold > 0) {
        await deductGold(pendingWebhook.userId, result.currentGold, ctx).catch(() => {})
    }
}

function isWhatsAppTriggeredVmJob(pendingWebhook) {
    return (
        pendingWebhook?.triggerChannel === 'whatsapp' &&
        typeof pendingWebhook?.whatsappTo === 'string' &&
        pendingWebhook.whatsappTo.trim().length > 0
    )
}

function buildWhatsAppVmResultMessage(output, { artifactCount = 0 } = {}) {
    const message = String(output || '').trim() || 'The VM task completed.'
    if (!artifactCount) return message

    const suffix =
        artifactCount === 1
            ? 'Generated file is attached in the Alldone thread.'
            : 'Generated files are attached in the Alldone thread.'
    return `${message}\n\n${suffix}`
}

async function sendWhatsAppVmResultNotification(
    pendingWebhook,
    output,
    { artifactCount = 0, pendingRef = null, notificationType = 'completed' } = {}
) {
    if (!isWhatsAppTriggeredVmJob(pendingWebhook)) return null

    const attemptedAt = Date.now()
    const baseLog = {
        correlationId: pendingWebhook.correlationId,
        projectId: pendingWebhook.projectId,
        objectId: pendingWebhook.objectId,
        objectType: pendingWebhook.objectType || 'tasks',
        notificationType,
    }

    try {
        const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
        const whatsappService = new TwilioWhatsAppService()
        const message = buildWhatsAppVmResultMessage(output, { artifactCount })
        const result = await whatsappService.sendWhatsAppMessageWithConversationLink(
            pendingWebhook.whatsappTo,
            message,
            {
                projectId: pendingWebhook.projectId,
                objectId: pendingWebhook.objectId,
                objectType: pendingWebhook.objectType || 'tasks',
            }
        )

        const notificationData = {
            type: notificationType,
            attemptedAt,
            success: result?.success === true,
            sid: result?.sid || null,
            status: result?.status || null,
            error: result?.success === true ? null : result?.error || result?.message || 'WhatsApp send failed',
        }
        if (pendingRef) {
            await pendingRef.update({ whatsappNotification: notificationData }).catch(() => {})
        }

        if (notificationData.success) {
            console.log('🖥️ VM JOB: WhatsApp result notification sent', {
                ...baseLog,
                sid: notificationData.sid,
            })
        } else {
            console.warn('🖥️ VM JOB: WhatsApp result notification failed', {
                ...baseLog,
                error: notificationData.error,
            })
        }
        return notificationData
    } catch (error) {
        const notificationData = {
            type: notificationType,
            attemptedAt,
            success: false,
            sid: null,
            status: null,
            error: error.message,
        }
        if (pendingRef) {
            await pendingRef.update({ whatsappNotification: notificationData }).catch(() => {})
        }
        console.warn('🖥️ VM JOB: WhatsApp result notification errored', {
            ...baseLog,
            error: error.message,
        })
        return notificationData
    }
}

/**
 * Worker entry point: run a queued VM job to completion and post the result back
 * into the conversation. Invoked by the runVmJob onTaskDispatched function.
 */
async function runVmJobByCorrelationId(correlationId) {
    console.log('🖥️ VM JOB RUNNER: Starting', { correlationId })
    const db = admin.firestore()
    const pendingRef = db.doc(`pendingWebhooks/${correlationId}`)

    const [pendingDoc, jobDoc] = await Promise.all([pendingRef.get(), db.doc(`vmJobs/${correlationId}`).get()])
    if (!pendingDoc.exists || !jobDoc.exists) {
        console.error('🖥️ VM JOB RUNNER: Job records missing', { correlationId })
        return
    }
    const pendingWebhook = pendingDoc.data()
    const vmJob = jobDoc.data()

    // Idempotency: don't re-run a job that already settled.
    if (pendingWebhook.status === 'completed' || pendingWebhook.status === 'failed') {
        console.warn('🖥️ VM JOB RUNNER: Already settled, skipping', { correlationId, status: pendingWebhook.status })
        return
    }

    await pendingRef.update({ status: 'initiated', initiatedAt: Date.now() }).catch(() => {})

    const env = getEnvFunctions()
    const e2bApiKey = env.E2B_API_KEY
    // Resolve the agent the assistant chose (defaults to Claude) and its config.
    const config = AGENT_CONFIGS[vmJob.agent] || AGENT_CONFIGS[DEFAULT_AGENT]
    const agentLabel = config.displayName || config.label || getAgentLabel(vmJob.agent || DEFAULT_AGENT)
    const apiKey = env[config.apiKeyField]
    if (!apiKey || !e2bApiKey) {
        const message = `VM task could not run: ${config.label} sandbox credentials are not configured.`
        const failureText = `❌ ${message}`
        await writeStatusComment(pendingWebhook, failureText)
        await sendWhatsAppVmResultNotification(pendingWebhook, failureText, {
            pendingRef,
            notificationType: 'failed',
        })
        await pendingRef.update({ status: 'failed', error: message, failedAt: Date.now() }).catch(() => {})
        await refundVmJob(pendingWebhook, 'Missing sandbox credentials')
        return
    }

    // Throttled live-activity updates to the single status comment. The worker passes
    // a fully-rendered activity log; we just rate-limit the Firestore writes.
    let lastProgressAt = 0
    const onActivity = text => {
        const now = Date.now()
        if (now - lastProgressAt < PROGRESS_UPDATE_INTERVAL_MS) return
        lastProgressAt = now
        writeStatusComment(pendingWebhook, text).catch(() => {})
    }

    // For a coding ("prototype") task, surface the project's connected repo (GitHub or GitLab)
    // so the agent works inside it and opens a Pull/Merge Request. Other task types unaffected.
    let gitContext = null
    if (vmJob.taskType === 'prototype') {
        gitContext = await loadRepoContext(vmJob)
        if (gitContext && gitContext.enabled) {
            console.log('🖥️ VM JOB RUNNER: repo connected for coding task', {
                correlationId,
                provider: gitContext.provider,
                baseBranch: gitContext.baseBranch,
            })
        } else if (gitContext && gitContext.repoConnectedButNoToken) {
            console.log('🖥️ VM JOB RUNNER: repo connected but requesting user has no token', {
                correlationId,
            })
        }
    }

    try {
        await writeStatusComment(pendingWebhook, renderVmWorkingHeader(agentLabel))
        const { output, usage, artifacts, runtimeGoldCharged = 0 } = await runAgentInSandbox(
            vmJob,
            config,
            apiKey,
            e2bApiKey,
            onActivity,
            gitContext && gitContext.enabled ? gitContext : null,
            pendingWebhook,
            pendingRef
        )

        // Upload any generated files and attach them to the result comment as real chat
        // attachment tokens (render as inline downloadable FileDownloadableTags). Keep the
        // tokens on their own first line so generated artifacts are visible before the VM answer.
        const mediaContext = await uploadArtifacts(pendingWebhook, artifacts)
        const finalText = buildVmFinalCommentText(output, mediaContext)

        // Auto-presentation: the agent's final message (+ attachments) becomes the comment.
        await writeStatusComment(pendingWebhook, finalText, { isFinal: true, output: finalText, mediaContext })
        await sendWhatsAppVmResultNotification(pendingWebhook, output, {
            artifactCount: mediaContext.length,
            pendingRef,
            notificationType: 'completed',
        })

        // Metered Gold top-up from actual usage: per-minute (VM compute) + per-token (LLM).
        const runtimeMs = Date.now() - (vmJob.createdAt || Date.now())
        const { minutes, totalTokens, runtimeGoldRemaining, tokenGold, topup } = calculateCompletionGoldCharges({
            runtimeMs,
            usage,
            runtimeGoldCharged,
        })
        await chargeVmTopup(pendingWebhook, vmJob, {
            topup,
            minutes,
            totalTokens,
            costUsd: usage?.costUsd,
            runtimeGoldAlreadyCharged: runtimeGoldCharged,
            runtimeGoldRemaining,
            tokenGold,
        })

        await pendingRef
            .update({
                status: 'completed',
                completedAt: Date.now(),
                runtimeMs,
                usage: usage || null,
                goldTopup: runtimeGoldCharged + topup,
                runtimeGoldCharged,
                artifactCount: mediaContext.length,
            })
            .catch(() => {})
        console.log('🖥️ VM JOB RUNNER: Completed', {
            correlationId,
            outputLength: output.length,
            artifacts: mediaContext.length,
            minutes,
            totalTokens,
            runtimeGoldCharged,
            runtimeGoldRemaining,
            tokenGold,
            topup,
            costUsd: usage?.costUsd ?? null,
        })
    } catch (error) {
        console.error('🖥️ VM JOB RUNNER: Failed', { correlationId, error: error.message, stack: error.stack })
        const runtimeGoldCharged = Number(error.runtimeGoldCharged) || 0
        if (isVmGoldExhaustedError(error)) {
            await writeStatusComment(pendingWebhook, VM_GOLD_EXHAUSTED_TEXT)
            await sendWhatsAppVmResultNotification(pendingWebhook, VM_GOLD_EXHAUSTED_TEXT, {
                pendingRef,
                notificationType: 'failed',
            })
            await pendingRef
                .update({
                    status: 'failed',
                    error: VM_GOLD_EXHAUSTED_TEXT,
                    failureReason: VM_GOLD_EXHAUSTED_FAILURE_REASON,
                    interruptedAt: Date.now(),
                    runtimeGoldCharged,
                })
                .catch(() => {})
            return
        }

        const message = `The VM task could not be completed: ${error.message}`
        const failureText = `❌ ${message}`
        await writeStatusComment(pendingWebhook, failureText)
        await sendWhatsAppVmResultNotification(pendingWebhook, failureText, {
            pendingRef,
            notificationType: 'failed',
        })
        await pendingRef
            .update({ status: 'failed', error: error.message, failedAt: Date.now(), runtimeGoldCharged })
            .catch(() => {})
        await refundVmJob(pendingWebhook, 'VM task failed during execution', runtimeGoldCharged)
    }
}

module.exports = {
    runVmJobByCorrelationId,
    pauseIdleVmSessions,
    cleanupIdleVmSessions,
    MAX_VM_RUNTIME_MS,
    __private__: {
        buildAgentPrompt,
        renderActivityLog,
        renderVmWorkingHeader,
        calculateAccruedRuntimeGold,
        calculateCompletionGoldCharges,
        checkAndChargeVmRuntimeGold,
        refundVmJob,
        VmGoldExhaustedError,
        isVmGoldExhaustedError,
        buildWhatsAppVmResultMessage,
        isWhatsAppTriggeredVmJob,
        sendWhatsAppVmResultNotification,
        buildAttachmentTokens,
        buildVmFinalCommentText,
    },
}
