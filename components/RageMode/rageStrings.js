import { RAGE_WEAPONS } from './rageWeapons'
import { HANGAR_ITEMS } from './raidRun'
import { PICKUP_IDS } from './raidPickups'

/**
 * Every string the arena shows, from one `translate(key)` function: the button passes the app's
 * TranslationService, `browser-tests/rage-mode` passes a lookup into en.json. One table, so the two
 * can never disagree about which keys exist.
 */
export const buildRageStrings = translate => ({
    title: translate('Rage mode'),
    exitHint: translate('Esc to exit'),
    desktopHelp: translate('Raid desktop help'),
    touchHelp: translate('Raid touch help'),
    mute: translate('Mute'),
    unmute: translate('Unmute'),
    exit: translate('Exit rage mode'),
    score: translate('Score'),
    best: translate('Best'),
    shield: translate('Shield'),
    bomb: translate('Mega bomb'),
    bombs: translate('Mega bombs'),
    credits: translate('Credits'),
    mission: translate('Mission {n}'),
    missionStart: translate('Mission {n}: take off!'),
    missionComplete: translate('Mission {n} complete!'),
    debrief: translate('{kills} destroyed · +{credits} credits'),
    hangar: translate('Hangar'),
    launchMission: translate('Launch mission {n}'),
    goldWeapons: translate('Special weapons'),
    maxed: translate('Maxed'),
    notEnoughCredits: translate('Not enough credits'),
    continueAt: translate('Continuing at mission {n}'),
    startOver: translate('Start over'),
    startOverConfirm: translate('Sure? Start over'),
    confirmStartOver: translate('Press ↺ again to start over from mission 1'),
    greet: translate('Say hi'),
    combo: translate('Combo'),
    enemies: Object.fromEntries(
        ['chat', 'ping', 'note', 'mine', 'meeting', 'deadline', 'carrier'].map(id => [
            id,
            { name: translate(`Raid enemy ${id}`), hint: translate(`Raid enemy ${id} hint`) },
        ])
    ),
    pickups: Object.fromEntries(PICKUP_IDS.map(id => [id, translate(`Raid pickup ${id}`)])),
    greetings: [1, 2, 3, 4].map(n => translate(`Rage mode greeting ${n}`)),
    hangarItems: Object.fromEntries(
        HANGAR_ITEMS.map(item => [
            item.id,
            {
                name: translate(`Raid hangar ${item.id}`),
                description: translate(`Raid hangar ${item.id} description`),
            },
        ])
    ),
    shop: translate('Weapon shop'),
    shopTitle: translate('Weapon shop'),
    gold: translate('Gold'),
    close: translate('Close'),
    equipped: translate('Equipped'),
    equip: translate('Equip'),
    buying: translate('Buying…'),
    confirmBuy: translate('Buy for {price} Gold?'),
    cancel: translate('Cancel'),
    bought: translate('Yours! Equipped.'),
    notEnoughGold: translate('Not enough Gold yet'),
    purchaseFailed: translate('That did not work, please try again'),
    offline: translate('The shop needs an internet connection'),
    shopUnavailable: translate('The shop is not available here'),
    gameOver: translate('Game over'),
    newHighscore: translate('New highscore!'),
    playAgain: translate('Play again'),
    bossName: translate("Today's open tasks: {count}"),
    bossCaption: translate('open today'),
    bossIncoming: translate('Boss: your open tasks for today!'),
    bossDefeated: translate('Boss defeated!'),
    bosses: Object.fromEntries(
        ['backlog', 'inbox', 'calendar', 'bell', 'clock'].map(id => [id, translate(`Raid boss ${id}`)])
    ),
    weapons: Object.fromEntries(
        RAGE_WEAPONS.map(weapon => [
            weapon.id,
            {
                name: translate(`Rage weapon ${weapon.id}`),
                description: translate(`Rage weapon ${weapon.id} description`),
            },
        ])
    ),
})
