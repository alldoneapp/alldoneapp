/**
 * This file contains the constants that represent
 * each Navigation Tab in Detail Views
 */

/**
 * Root View
 * ['Tasks', 'Notes', 'Goals', 'Contacts', 'Updates']
 */

export const DV_TAB_ROOT_TASKS = 'ROOT_TASKS'
export const DV_TAB_ROOT_NOTES = 'ROOT_NOTES'
export const DV_TAB_ROOT_GOALS = 'ROOT_GOALS'
export const DV_TAB_ROOT_CONTACTS = 'ROOT_CONTACTS'
export const DV_TAB_ROOT_CHATS = 'ROOT_CHATS'
export const DV_TAB_ROOT_UPDATES = 'ROOT_UPDATES'

export const ROOT_ROUTES = [
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_UPDATES,
]

/**
 * Task Detailed View
 * ['Properties', 'Backlinks', 'Estimations', 'TaskUpdates']
 */

export const DV_TAB_TASK_PROPERTIES = 'TASK_PROPERTIES'
export const DV_TAB_TASK_CHAT = 'TASK_CHAT'
export const DV_TAB_TASK_BACKLINKS = 'TASK_BACKLINKS'
export const DV_TAB_TASK_ESTIMATIONS = 'TASK_ESTIMATIONS'
export const DV_TAB_TASK_UPDATES = 'TASK_UPDATES'
export const DV_TAB_TASK_SUBTASKS = 'TASK_SUBTASKS'
export const DV_TAB_TASK_NOTE = 'TASK_NOTE'

/**
 * Project Detailed View
 * ['Properties', 'Project members', 'ProjectUpdates']
 */

export const DV_TAB_PROJECT_PROPERTIES = 'PROJECT_PROPERTIES'
export const DV_TAB_PROJECT_STATISTICS = 'PROJECT_STATISTICS'
export const DV_TAB_PROJECT_BACKLINKS = 'PROJECT_BACKLINKS'
export const DV_TAB_PROJECT_TEAM_MEMBERS = 'PROJECT_TEAM_MEMBERS'
export const DV_TAB_PROJECT_WORKSTREAMS = 'PROJECT_WORKSTREAMS'
export const DV_TAB_PROJECT_UPDATES = 'PROJECT_UPDATES'
export const DV_TAB_PROJECT_ASSISTANTS = 'PROJECT_ASSISTANTS'
export const DV_TAB_PROJECT_CONTACT_STATUSES = 'PROJECT_CONTACT_STATUSES'

/**
 * User Detailed View
 * ['Properties', 'Backlinks', 'Workflow', 'Statistics', 'ContactUpdates']
 */

export const DV_TAB_USER_PROPERTIES = 'USER_PROPERTIES'
export const DV_TAB_USER_PROFILE = 'USER_PROFILE'
export const DV_TAB_USER_BACKLINKS = 'USER_BACKLINKS'
export const DV_TAB_USER_WORKFLOW = 'USER_WORKFLOW'
export const DV_TAB_USER_STATISTICS = 'USER_STATISTICS'
export const DV_TAB_USER_UPDATES = 'USER_UPDATES'
export const DV_TAB_USER_CHAT = 'USER_CHAT'
export const DV_TAB_USER_NOTE = 'USER_NOTE'

/**
 * Contact Detailed View
 * ['Properties', 'Backlinks', 'ContactUpdates']
 */

export const DV_TAB_CONTACT_PROPERTIES = 'CONTACT_PROPERTIES'
export const DV_TAB_CONTACT_BACKLINKS = 'CONTACT_BACKLINKS'
export const DV_TAB_CONTACT_UPDATES = 'CONTACT_UPDATES'
export const DV_TAB_CONTACT_CHAT = 'CONTACT_CHAT'
export const DV_TAB_CONTACT_NOTE = 'CONTACT_NOTE'

/**
 * Note Detailed View
 * ['Note', 'Properties', 'Backlinks']
 */

export const DV_TAB_NOTE_EDITOR = 'NOTE_EDITOR'
export const DV_TAB_NOTE_PROPERTIES = 'NOTE_PROPERTIES'
export const DV_TAB_NOTE_BACKLINKS = 'NOTE_BACKLINKS'
export const DV_TAB_NOTE_UPDATES = 'NOTE_UPDATES'
export const DV_TAB_NOTE_CHAT = 'NOTE_CHAT'

/**
 * Chats Detailed View
 * ['Chat', 'Properties', 'Backlinks', 'Updates']
 */
export const DV_TAB_CHAT_BOARD = 'CHAT_BOARD'
export const DV_TAB_CHAT_PROPERTIES = 'CHAT_PROPERTIES'
export const DV_TAB_CHAT_NOTE = 'CHAT_NOTE'

/**
 * Goal Detailed View
 * ['Properties', 'Backlinks', 'Updates']
 */

export const DV_TAB_GOAL_PROPERTIES = 'GOAL_PROPERTIES'
export const DV_TAB_GOAL_UPDATES = 'GOAL_UPDATES'
export const DV_TAB_GOAL_BACKLINKS = 'GOAL_BACKLINKS'
export const DV_TAB_GOAL_CHAT = 'GOAL_CHAT'
export const DV_TAB_GOAL_LINKED_TASKS = 'DV_TAB_GOAL_LINKED_TASKS'
export const DV_TAB_GOAL_NOTE = 'DV_TAB_GOAL_NOTE'

/**
 * Assistant Detailed View
 * ['Customizations', 'Backlinks']
 */

export const DV_TAB_ASSISTANT_CUSTOMIZATIONS = 'ASSISTANT_CUSTOMIZATIONS'
export const DV_TAB_ASSISTANT_BACKLINKS = 'ASSISTANT_BACKLINKS'
export const DV_TAB_ASSISTANT_NOTE = 'ASSISTANT_NOTE'
export const DV_TAB_ASSISTANT_CHAT = 'ASSISTANT_CHAT'
export const DV_TAB_ASSISTANT_UPDATES = 'ASSISTANT_UPDATES'

/**
 * Skill Detailed View
 */

export const DV_TAB_SKILL_PROPERTIES = 'SKILL_PROPERTIES'
export const DV_TAB_SKILL_UPDATES = 'SKILL_UPDATES'
export const DV_TAB_SKILL_BACKLINKS = 'SKILL_BACKLINKS'
export const DV_TAB_SKILL_CHAT = 'SKILL_CHAT'
export const DV_TAB_SKILL_NOTE = 'DV_TAB_SKILL_NOTE'

/**
 * Admin Panel View
 * ['User']
 */

export const DV_TAB_ADMIN_PANEL_USER = 'ADMIN_PANEL_USER'
export const DV_TAB_ADMIN_PANEL_ASSISTANTS = 'DV_TAB_ADMIN_PANEL_ASSISTANTS'

/**
 * Settings Detailed View
 * ['User', 'Projects', 'Archived projects', 'Invitations', 'Statistics', 'Shortcuts']
 */

export const DV_TAB_SETTINGS_PROFILE = 'SETTINGS_PROFILE'
export const DV_TAB_SETTINGS_CUSTOMIZATIONS = 'SETTINGS_CUSTOMIZATIONS'
export const DV_TAB_SETTINGS_PROJECTS = 'SETTINGS_PROJECTS'
export const DV_TAB_SETTINGS_INVITATIONS = 'SETTINGS_INVITATIONS'
export const DV_TAB_SETTINGS_STATISTICS = 'SETTINGS_STATISTICS'
export const DV_TAB_SETTINGS_SHORTCUTS = 'SETTINGS_SHORTCUTS'
export const DV_TAB_SETTINGS_PREMIUM = 'SETTINGS_PREMIUM'
export const DV_TAB_SETTINGS_EXPORT = 'SETTINGS_EXPORT'

/**
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 */

/**
 * Mapping of Navigation Bar Items
 * This is helpful to show the real Tab text in Navbar
 */

export const NAVBAR_ITEM_MAP = {
    // Root
    [DV_TAB_ROOT_TASKS]: 'Tasks',
    [DV_TAB_ROOT_NOTES]: 'Notes',
    [DV_TAB_ROOT_GOALS]: 'Goals',
    [DV_TAB_ROOT_CONTACTS]: 'Contacts',
    [DV_TAB_ROOT_CHATS]: 'Chats',
    [DV_TAB_ROOT_UPDATES]: 'Updates',
    // Tasks
    [DV_TAB_TASK_PROPERTIES]: 'Properties',
    [DV_TAB_TASK_BACKLINKS]: 'Backlinks',
    [DV_TAB_TASK_ESTIMATIONS]: 'Estimations',
    [DV_TAB_TASK_CHAT]: 'Chat',
    [DV_TAB_TASK_UPDATES]: 'Updates',
    [DV_TAB_TASK_SUBTASKS]: 'Subtasks',
    [DV_TAB_TASK_NOTE]: 'Note',
    // Project
    [DV_TAB_PROJECT_PROPERTIES]: 'Properties',
    [DV_TAB_PROJECT_STATISTICS]: 'Statistics',
    [DV_TAB_PROJECT_BACKLINKS]: 'Backlinks',
    [DV_TAB_PROJECT_TEAM_MEMBERS]: 'Project members',
    [DV_TAB_PROJECT_WORKSTREAMS]: 'Workstreams',
    [DV_TAB_PROJECT_ASSISTANTS]: 'AI Assistants',
    [DV_TAB_PROJECT_CONTACT_STATUSES]: 'Contact Statuses',
    [DV_TAB_PROJECT_UPDATES]: 'Updates',
    // User
    [DV_TAB_USER_PROPERTIES]: 'Properties',
    [DV_TAB_USER_PROFILE]: 'Profile',
    [DV_TAB_USER_BACKLINKS]: 'Backlinks',
    [DV_TAB_USER_WORKFLOW]: 'Workflow',
    [DV_TAB_USER_STATISTICS]: 'Statistics',
    [DV_TAB_USER_UPDATES]: 'Updates',
    [DV_TAB_USER_CHAT]: 'Chat',
    [DV_TAB_USER_NOTE]: 'Note',
    // Contact
    [DV_TAB_CONTACT_PROPERTIES]: 'Properties',
    [DV_TAB_CONTACT_BACKLINKS]: 'Backlinks',
    [DV_TAB_CONTACT_UPDATES]: 'Updates',
    [DV_TAB_CONTACT_CHAT]: 'Chat',
    [DV_TAB_CONTACT_NOTE]: 'Note',
    // Note
    [DV_TAB_NOTE_EDITOR]: 'Note',
    [DV_TAB_NOTE_PROPERTIES]: 'Properties',
    [DV_TAB_NOTE_BACKLINKS]: 'Backlinks',
    [DV_TAB_NOTE_UPDATES]: 'Updates',
    [DV_TAB_NOTE_CHAT]: 'Chat',
    // Goal
    [DV_TAB_GOAL_PROPERTIES]: 'Properties',
    [DV_TAB_GOAL_UPDATES]: 'Updates',
    [DV_TAB_GOAL_BACKLINKS]: 'Backlinks',
    [DV_TAB_GOAL_CHAT]: 'Chat',
    [DV_TAB_GOAL_LINKED_TASKS]: 'Tasks',
    [DV_TAB_GOAL_NOTE]: 'Note',
    // AI Assistant
    [DV_TAB_ASSISTANT_CUSTOMIZATIONS]: 'Customizations',
    [DV_TAB_ASSISTANT_BACKLINKS]: 'Backlinks',
    [DV_TAB_ASSISTANT_NOTE]: 'Note',
    [DV_TAB_ASSISTANT_CHAT]: 'Chat',
    [DV_TAB_ASSISTANT_UPDATES]: 'Updates',
    // Skill
    [DV_TAB_SKILL_PROPERTIES]: 'Properties',
    [DV_TAB_SKILL_UPDATES]: 'Updates',
    [DV_TAB_SKILL_BACKLINKS]: 'Backlinks',
    [DV_TAB_SKILL_CHAT]: 'Chat',
    [DV_TAB_SKILL_NOTE]: 'Note',
    // AdminPanel
    [DV_TAB_ADMIN_PANEL_USER]: 'User',
    [DV_TAB_ADMIN_PANEL_ASSISTANTS]: 'AI Assistants',
    // Settings
    [DV_TAB_SETTINGS_CUSTOMIZATIONS]: 'Customizations',
    [DV_TAB_SETTINGS_PROFILE]: 'Profile',
    [DV_TAB_SETTINGS_PROJECTS]: 'Projects',
    [DV_TAB_SETTINGS_INVITATIONS]: 'Invitations',
    [DV_TAB_SETTINGS_STATISTICS]: 'Statistics',
    [DV_TAB_SETTINGS_SHORTCUTS]: 'Shortcuts',
    [DV_TAB_SETTINGS_PREMIUM]: 'Premium',
    [DV_TAB_SETTINGS_EXPORT]: 'Export',
    // Chat
    [DV_TAB_CHAT_BOARD]: 'Chat',
    [DV_TAB_CHAT_PROPERTIES]: 'Properties',
    [DV_TAB_CHAT_NOTE]: 'Note',
}
