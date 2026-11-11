/**
 * Builds the sized E2B templates the VM runner starts sandboxes from (Build System 2.0, no Docker).
 *
 * E2B fixes a sandbox's RAM and vCPU count when its template is built, and its managed
 * `claude` / `codex` templates come with 1 GB, which OOM-kills dependency installs and builds.
 * Each sized template is the managed one unchanged, plus memory. The agent CLIs are still kept
 * current at runtime by the runner, so these templates never need a rebuild for a CLI release.
 *
 * Names and sizes come from ../Assistant/vmTemplates.js, the same module the runner reads.
 * Build them in EVERY E2B team the functions use (staging and production keys may differ)
 * before deploying a runner that selects them; until then the runner falls back to the managed
 * 1 GB templates and logs an error.
 *
 * Run with tsx (NOT raw node — e2b v2's bundle needs tsx's ESM/`node:` interop):
 *   cd functions/e2b-template
 *   npm ci
 *   E2B_API_KEY=e2b_*** npm run build            # both agents
 *   E2B_API_KEY=e2b_*** npm run build -- codex   # one agent
 */
import 'dotenv/config'
import { Template } from 'e2b'
import vmTemplates from '../Assistant/vmTemplates.js'

const { VM_AGENT_TEMPLATES, VM_SANDBOX_MEMORY_MB, VM_SANDBOX_CPU_COUNT } = vmTemplates as {
    VM_AGENT_TEMPLATES: Record<string, { sized: string; managed: string }>
    VM_SANDBOX_MEMORY_MB: number
    VM_SANDBOX_CPU_COUNT: number
}

// A cheap step that also proves the managed CLI is present in the base before the build is kept.
const CLI_CHECKS: Record<string, string> = {
    claude: 'claude --version',
    codex: 'codex --version',
}

if (!process.env.E2B_API_KEY) {
    console.error('❌ E2B_API_KEY is required. Set it in functions/e2b-template/.env or the shell.')
    process.exit(1)
}

const requested = process.argv.slice(2)
const agents = requested.length > 0 ? requested : Object.keys(VM_AGENT_TEMPLATES)
for (const agent of agents) {
    if (!VM_AGENT_TEMPLATES[agent]) {
        console.error(`❌ Unknown agent "${agent}". Known: ${Object.keys(VM_AGENT_TEMPLATES).join(', ')}`)
        process.exit(1)
    }
}

for (const agent of agents) {
    const { sized, managed } = VM_AGENT_TEMPLATES[agent]
    const template = Template().fromTemplate(managed).runCmd(CLI_CHECKS[agent])

    console.log(
        `🏗️  Building "${sized}" from managed "${managed}" (${VM_SANDBOX_CPU_COUNT} vCPU / ${VM_SANDBOX_MEMORY_MB} MB)…`
    )
    const info = await Template.build(template, sized, {
        cpuCount: VM_SANDBOX_CPU_COUNT,
        memoryMB: VM_SANDBOX_MEMORY_MB,
        onBuildLogs: (entry: any) => console.log(entry?.message ?? entry),
    })
    console.log(`✅ Built "${sized}":`, info)
}
