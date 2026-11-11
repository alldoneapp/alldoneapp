// E2B templates the VM runner starts sandboxes from.
//
// E2B fixes a sandbox's RAM and vCPU count when its template is BUILT; Sandbox.create cannot
// change them. E2B's managed `claude` / `codex` templates come with 1 GB, which OOM-kills
// dependency installs and builds. So each agent has a sized template of our own, built FROM the
// managed one (functions/e2b-template/build.ts), that adds only memory. The managed template is
// the fallback when the sized one does not exist in the E2B team behind the key in use, so a
// missing build degrades to the old size instead of failing every VM job.
//
// The sized templates must be built in every E2B team the functions use (staging and
// production may use different keys) BEFORE a deploy that selects them: a fallback start is
// recorded under the managed name, so a resumed thread would be discarded and started cold again
// on its next job until the sized template exists.

const VM_SANDBOX_MEMORY_MB = 4096
const VM_SANDBOX_CPU_COUNT = 2

const VM_AGENT_TEMPLATES = {
    claude: { sized: 'alldone-claude-4gb', managed: 'claude' },
    codex: { sized: 'alldone-codex-4gb', managed: 'codex' },
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
 * Create a sandbox from an agent's sized template (`templates` is a VM_AGENT_TEMPLATES entry),
 * falling back to the managed one only when the sized template does not exist. Any other error
 * is thrown unchanged. Returns { sandbox, template, fellBack } with the template actually used.
 */
async function createAgentSandbox(Sandbox, templates, createOpts, { log = console } = {}) {
    const { sized, managed } = templates
    try {
        const sandbox = await Sandbox.create(sized, createOpts)
        return { sandbox, template: sized, fellBack: false }
    } catch (error) {
        if (!isTemplateNotFoundError(error)) throw error
        log.error('🖥️ VM: sized E2B template missing, using the 1 GB managed template', {
            template: sized,
            fallbackTemplate: managed,
            error: error.message,
        })
        const sandbox = await Sandbox.create(managed, createOpts)
        return { sandbox, template: managed, fellBack: true }
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
