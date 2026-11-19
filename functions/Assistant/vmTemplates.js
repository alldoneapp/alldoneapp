// E2B templates the VM runner starts sandboxes from.
//
// E2B fixes a sandbox's RAM and vCPU count when its template is BUILT; Sandbox.create cannot
// change them. E2B's managed `claude` / `codex` templates come with 1 GB, which OOM-kills
// dependency installs and builds. So each agent has a sized template of our own, built FROM the
// managed one (functions/e2b-template/build.ts), with memory and patched Node.
//
// Size history: 2 vCPU / 4 GB (`alldone-*-4gb`, 2026-11-11) still OOM-killed some jobs, so since
// 2026-11-19 it is 4 vCPU / 8 GB (`alldone-*-8gb`), the largest size E2B offers without support.
// When the sized template does not exist in the E2B team behind the key in use, the runner tries
// the `previous` sized templates (newest first), then the managed one, so a missing build
// degrades to the last size that was built instead of failing every VM job.
//
// The sized templates must be built in every E2B team the functions use (staging and
// production may use different keys) BEFORE a deploy that selects them: a fallback start is
// recorded under the template actually used, so a resumed thread would be discarded and started
// cold again on each job until the sized template exists. Switching sizes also discards every
// thread paused on the old template once, on its next job.

const VM_SANDBOX_MEMORY_MB = 8192
const VM_SANDBOX_CPU_COUNT = 4

const VM_AGENT_TEMPLATES = {
    claude: { sized: 'alldone-claude-8gb', previous: ['alldone-claude-4gb'], managed: 'claude' },
    codex: { sized: 'alldone-codex-8gb', previous: ['alldone-codex-4gb'], managed: 'codex' },
}

function getAgentTemplates(agent) {
    return VM_AGENT_TEMPLATES[agent] || VM_AGENT_TEMPLATES.claude
}

// e2b@1.x turns any non-429 API error on POST /sandboxes into `SandboxError("<status>: <msg>")`,
// so an unknown template shows up as a 404 in the message.
function isTemplateNotFoundError(error) {
    const message = String((error && error.message) || '')
    return /^404\b/.test(message) || /template\b.*\bnot found/i.test(message)
}

/**
 * Create a sandbox from an agent's sized template (`templates` is a VM_AGENT_TEMPLATES entry).
 * Only when a template does not exist does it try the next one: the `previous` sized templates,
 * then the managed one. Any other error is thrown unchanged. Returns
 * { sandbox, template, fellBack } with the template actually used.
 */
async function createAgentSandbox(Sandbox, templates, createOpts, { log = console } = {}) {
    const { sized, managed } = templates
    const candidates = [sized, ...(templates.previous || []), managed]
    for (let i = 0; i < candidates.length; i++) {
        const template = candidates[i]
        try {
            const sandbox = await Sandbox.create(template, createOpts)
            return { sandbox, template, fellBack: template !== sized }
        } catch (error) {
            const next = candidates[i + 1]
            if (!next || !isTemplateNotFoundError(error)) throw error
            log.error('🖥️ VM: sized E2B template missing, using the next smaller template', {
                template,
                fallbackTemplate: next,
                error: error.message,
            })
        }
    }
}

module.exports = {
    VM_SANDBOX_MEMORY_MB,
    VM_SANDBOX_CPU_COUNT,
    VM_AGENT_TEMPLATES,
    getAgentTemplates,
    isTemplateNotFoundError,
    createAgentSandbox,
}
