/**
 * Rage mode browser harness — the REAL arena (`components/RageMode/rageArena.js`, three.js and all)
 * over a stand-in app page: a wrapped paragraph, a task list whose checkboxes COUNT their clicks, an
 * image, a background-image avatar and a few coloured buttons.
 *
 * jsdom has no WebGL, no `caretRangeFromPoint` and no layout, so every question this exists for is
 * unanswerable from jest: does the arena render, do bolts actually find letters and images through
 * the input layer, can a click ever reach the app underneath, and does leaving put the page back
 * exactly as it was. `window.__rage` exposes what `run.js` asserts on.
 *
 * Open the built page by hand (`node browser-tests/rage-mode/run.js --serve`) to simply play it.
 */
import { startRageArena } from '../../components/RageMode/rageArena'

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

const state = { appClicks: 0, appKeys: 0, arena: null, exited: false }
window.__rage = state

const style = document.createElement('style')
style.textContent = `
  body { margin: 0; font-family: Roboto, Arial, sans-serif; background: #F1F3F4; color: #04142F; }
  .topbar { height: 48px; background: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; border-radius: 0 0 24px 24px; margin: 0 104px; }
  .page { max-width: 900px; margin: 24px auto; background: #fff; border-radius: 16px; padding: 24px 32px; }
  h1 { font-size: 28px; margin: 0 0 12px; }
  p { font-size: 16px; line-height: 26px; }
  .row { display: flex; align-items: center; gap: 12px; height: 40px; border-bottom: 1px solid #E5E8EB; font-size: 15px; }
  .check { width: 20px; height: 20px; border: 2px solid #8C95A8; border-radius: 6px; background: #fff; cursor: pointer; }
  .chip { background: #FFE6C7; color: #A66007; border-radius: 10px; padding: 2px 8px; font-size: 12px; }
  .media { display: flex; gap: 24px; align-items: center; margin-top: 16px; }
  .avatar { width: 64px; height: 64px; border-radius: 32px; background-size: cover; }
  .btn { background: #0C66FF; color: #fff; border: none; border-radius: 8px; padding: 10px 18px; font-size: 14px; cursor: pointer; }
  .assistant { font-weight: 600; font-size: 16px; display: flex; align-items: center; gap: 8px; }
  #rage { background: none; border: none; font-size: 18px; color: #8C95A8; cursor: pointer; padding: 0; }
`
document.head.appendChild(style)

const image = makeImage()
document.body.innerHTML = `
  <div class="topbar"><strong>Alldone</strong><span class="assistant">Anna Alldone: How can I help?<button id="rage" aria-label="Rage mode">⌖</button></span><span></span></div>
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
`

document.querySelectorAll('.check, .btn:not(#rage)').forEach(node =>
    node.addEventListener('click', () => {
        state.appClicks += 1
    })
)
document.addEventListener('keydown', () => {
    state.appKeys += 1
})

state.pageHtml = document.body.innerHTML

const strings = {
    title: 'Rage mode',
    exitHint: 'Esc to exit',
    destroyed: 'destroyed',
    desktopHelp: 'WASD or arrow keys to fly · click to shoot · Space to say hi · Esc puts everything back',
    touchHelp: 'Tap and hold to shoot · 👋 to say hi · ✕ puts everything back',
    mute: 'Mute',
    unmute: 'Unmute',
    exit: 'Exit rage mode',
    greet: 'Say hi',
    greetings: ['Hi! 👋', 'Hello there!', "You've got this!", 'Nice aim!'],
}

state.start = () => {
    const rect = document.getElementById('rage').getBoundingClientRect()
    state.exited = false
    state.arena = startRageArena({
        strings,
        from: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        onExit: () => {
            state.exited = true
            state.arena = null
        },
    })
}

document.getElementById('rage').addEventListener('click', () => state.start())
