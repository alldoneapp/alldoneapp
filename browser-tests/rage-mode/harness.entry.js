/**
 * Rage mode browser harness — the REAL raid (`components/RageMode/raidArena.js`, three.js and all)
 * over a stand-in app page inside a `#root` like the app's: a paragraph, a task list whose
 * checkboxes COUNT their clicks, an image and a few coloured buttons.
 *
 * jsdom has no WebGL and no layout, so every question this exists for is unanswerable from jest:
 * does the raid render, does the page really slide away and come back, do shots find the task rows
 * on it, can a click ever reach the app underneath, and does leaving put the page back exactly as it
 * was. `window.__rage` exposes what `run.js` asserts on.
 *
 * Open the built page by hand (`node browser-tests/rage-mode/run.js --serve`) to simply play it.
 */
import { startRageArena } from '../../components/RageMode/raidArena'
import { findLaunchPoint, RAGE_LAUNCH_ANCHOR_ID } from '../../components/RageMode/rageLaunchAnchor'
import { buildRageStrings } from '../../components/RageMode/rageStrings'
import { RAGE_WEAPONS } from '../../components/RageMode/rageWeapons'
import en from '../../i18n/translations/en.json'

const PARAGRAPH =
    'A stick figure is a very simple drawing of a person, in which the head is represented by a circle and the limbs and torso by straight lines. Deadlines, overdue reviews and that one task you have postponed eleven times are represented by this paragraph, which you are now free to take apart letter by letter.'

const TASKS = [
    'Reply to the tax advisor about the Q3 numbers',
    'Prepare the board slides (again)',
    'Fix the flaky login test',
    'Book the dentist appointment',
    'Clean up the backlog before Monday',
]
// Below the fold, so the page scrolls and there is more to fly to.
const MORE_TASKS = [
    'Renew the domain before it expires',
    'Answer the partner survey',
    'Plan the team offsite',
    'Update the pricing page',
    'Archive old projects',
    'Review the hiring pipeline',
    'Write the release notes',
    'Call the insurance about the claim',
]

const makeImage = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 160
    const context = canvas.getContext('2d')
    const gradient = context.createLinearGradient(0, 0, 240, 160)
    gradient.addColorStop(0, '#0C66FF')
    gradient.addColorStop(1, '#09D693')
    context.fillStyle = gradient
    context.fillRect(0, 0, 240, 160)
    context.fillStyle = '#FFE36B'
    context.beginPath()
    context.arc(170, 50, 26, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#091540'
    context.beginPath()
    context.moveTo(0, 160)
    context.lineTo(90, 70)
    context.lineTo(160, 160)
    context.fill()
    return canvas.toDataURL()
}

const state = { appClicks: 0, appKeys: 0, arena: null, exited: false, exitCount: 0 }
window.__rage = state

const style = document.createElement('style')
style.textContent = `
  body { margin: 0; font-family: Roboto, Arial, sans-serif; background: #F1F3F4; color: #04142F; }
  .topbar { height: 48px; background: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; border-radius: 0 0 24px 24px; margin: 0 104px; }
  @media (max-width: 600px) { .topbar { margin: 0 8px; padding: 0 12px; } .page { margin: 16px 8px; padding: 16px; } }
  .page { max-width: 900px; margin: 24px auto; background: #fff; border-radius: 16px; padding: 24px 32px; }
  h1 { font-size: 28px; margin: 0 0 12px; }
  p { font-size: 16px; line-height: 26px; }
  .row { display: flex; align-items: center; gap: 12px; height: 40px; border-bottom: 1px solid #E5E8EB; font-size: 15px; }
  .check { width: 20px; height: 20px; border: 2px solid #8C95A8; border-radius: 6px; background: #fff; cursor: pointer; }
  .chip { background: #FFE6C7; color: #A66007; border-radius: 10px; padding: 2px 8px; font-size: 12px; }
  .media { display: flex; flex-wrap: wrap; gap: 24px; align-items: center; margin-top: 16px; }
  img { max-width: 100%; height: auto; }
  .avatar { width: 64px; height: 64px; border-radius: 32px; background-size: cover; }
  .btn { background: #0C66FF; color: #fff; border: none; border-radius: 8px; padding: 10px 18px; font-size: 14px; cursor: pointer; }
  .assistant { font-weight: 600; font-size: 16px; display: flex; align-items: center; gap: 8px; }
  .anna { width: 32px; height: 32px; border-radius: 10px; background: #F7DC96; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; }
  #rage { background: none; border: none; font-size: 18px; color: #8C95A8; cursor: pointer; padding: 0; }
`
document.head.appendChild(style)

const image = makeImage()
document.body.innerHTML = `<div id="root">
  <div class="topbar"><strong>Alldone</strong><span class="assistant"><span class="anna" id="${RAGE_LAUNCH_ANCHOR_ID}">A</span>Anna Alldone: How can I help?<button id="rage" aria-label="Rage mode">⌖</button></span><span></span></div>
  <div class="page" id="page">
    <h1 id="title">Stick figure</h1>
    <p id="paragraph">${PARAGRAPH}</p>
    <div id="tasks">${TASKS.map(
        (task, i) =>
            // The id is the one TaskPresentation renders (nativeID), which is how the arena finds rows.
            `<div class="row" id="task_body_p_t${i}_false"><div class="check" id="check-${i}"></div><span>${task}</span>${
                i % 2 ? '<span class="chip">Overdue</span>' : ''
            }</div>`
    ).join('')}</div>
    <div class="media">
      <img id="image" src="${image}" width="240" height="160" alt="" />
      <div id="avatar" class="avatar" style="background-image:url(${image})"></div>
      <button class="btn" id="primary">Save</button>
      <button class="btn" id="secondary" style="background:#09D693">Done</button>
    </div>
  </div>
  <div class="page" id="more">
    <h1>Later</h1>
    ${MORE_TASKS.map(
        (task, i) => `<div class="row" id="task_body_p_m${i}_false"><div class="check"></div><span>${task}</span></div>`
    ).join('')}
  </div>
</div>`

document.querySelectorAll('.check, .btn:not(#rage)').forEach(node =>
    node.addEventListener('click', () => {
        state.appClicks += 1
    })
)
document.addEventListener('keydown', () => {
    state.appKeys += 1
})

state.pageHtml = document.body.innerHTML

// The real string table, read from en.json the way the app's TranslationService would.
const strings = buildRageStrings(key => en[key] || key)

// Fake services, steered by the query string: ?gold=1500&tasks=3&best=120&owned=all
// &bossAt=2&noWaves=1&shield=10&god=1&seed=7&bossHp=40&pickups=coffee,drones&waves=showcase. `state.calls` records what the arena asked for.
const params = new URLSearchParams(window.location.search)
state.gold = Number(params.get('gold') || 1500)
state.profile = {
    owned: params.get('owned') === 'all' ? RAGE_WEAPONS.map(weapon => weapon.id) : ['blaster'],
    highscore: Number(params.get('best') || 120),
}
state.calls = { purchase: [], submitScore: [] }
const services = {
    loadProfile: () => Promise.resolve({ ...state.profile, progress: serverProgress() }),
    saveProgress: checkpoint => {
        state.calls.saveProgress.push(checkpoint)
        const savedAt = Date.now()
        localStorage.setItem(SERVER_PROGRESS_KEY, JSON.stringify({ checkpoint, savedAt }))
        return Promise.resolve({ ok: true, savedAt, checkpoint })
    },
    purchase: id => {
        state.calls.purchase.push(id)
        const price = RAGE_WEAPONS.find(weapon => weapon.id === id).price
        if (state.gold < price)
            return Promise.resolve({ ok: false, reason: 'insufficient_gold', currentGold: state.gold })
        state.gold -= price
        state.profile.owned = [...state.profile.owned, id]
        return Promise.resolve({ ok: true, owned: state.profile.owned, newBalance: state.gold })
    },
    submitScore: score => {
        state.calls.submitScore.push(score)
        const isNew = score > state.profile.highscore
        if (isNew) state.profile.highscore = score
        return Promise.resolve({ ok: true, isNew, highscore: state.profile.highscore })
    },
    getGold: () => state.gold,
    getOpenTasksToday: () => Number(params.get('tasks') || 3),
    getProjectColor: () => '#7E57C2',
}
const tuning = {
    seed: Number(params.get('seed') || 20261003),
    ...(params.get('bossAt') ? { bossAt: Number(params.get('bossAt')) } : {}),
    ...(params.get('noWaves') ? { noWaves: true } : {}),
    ...(params.get('shield') ? { startShield: Number(params.get('shield')) } : {}),
    ...(params.get('god') ? { invincible: true } : {}),
    ...(params.get('bossHp') ? { bossHp: Number(params.get('bossHp')) } : {}),
    ...(params.get('pickups') ? { pickups: params.get('pickups').split(',') } : {}),
    // ?waves=showcase flies every new member of the cast within a few seconds.
    ...(params.get('waves') === 'showcase'
        ? {
              waves: [
                  { at: 0.5, pattern: 'zigzag', type: 'chat', count: 3, spacing: 0.5 },
                  { at: 1, pattern: 'swarm', type: 'ping', count: 4, spacing: 0.4 },
                  { at: 1.5, pattern: 'drift', type: 'note', count: 2, spacing: 0.6 },
                  { at: 1.8, pattern: 'drift', type: 'mine', count: 3, spacing: 0.5 },
                  { at: 2, pattern: 'hover', type: 'meeting', count: 2, spacing: 0, y: 0.2, hold: 6 },
                  { at: 2.5, pattern: 'single', type: 'deadline', count: 1, spacing: 0, y: 0.3, hold: 9 },
                  {
                      at: 3,
                      pattern: 'sweep',
                      type: 'carrier',
                      count: 1,
                      spacing: 0,
                      y: 0.15,
                      side: 'left',
                      duration: 6,
                  },
              ],
          }
        : {}),
}

// Progress is remembered per scope, in the browser AND on the (fake) server, which keeps its copy
// in its own localStorage key so it survives a reload — standing in for "another device".
// ?fresh=1 wipes both; ?newDevice=1 wipes only the browser's copy.
const SERVER_PROGRESS_KEY = 'harness.server.progress'
if (params.get('fresh')) {
    localStorage.removeItem('alldone.rageMode.progress.harness')
    localStorage.removeItem(SERVER_PROGRESS_KEY)
}
if (params.get('newDevice')) localStorage.removeItem('alldone.rageMode.progress.harness')
const serverProgress = () => {
    try {
        return JSON.parse(localStorage.getItem(SERVER_PROGRESS_KEY))
    } catch (error) {
        return null
    }
}
state.calls.saveProgress = []

state.start = () => {
    state.exited = false
    state.arena = startRageArena({
        strings,
        services,
        tuning,
        from: findLaunchPoint(document.getElementById('rage')),
        progressScope: 'harness',
        onExit: () => {
            state.exited = true
            state.exitCount += 1
            state.arena = null
        },
    })
}

document.getElementById('rage').addEventListener('click', () => state.start())
