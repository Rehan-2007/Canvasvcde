export const PALETTE = [
  '#ffffff', // Pure White
  '#d4d4d8', // Light Gray
  '#a1a1aa', // Medium Gray
  '#52525b', // Dark Gray
  '#27272a', // Charcoal
  '#09090b', // Pitch Black
  '#ef4444', // Crimson Red
  '#ea580c', // Burnt Orange
  '#eab308', // Warm Gold
  '#10b981', // Emerald Green
  '#06b6d4', // Cyan
  '#3b82f6', // Steel Blue
  '#6366f1', // Indigo
  '#a855f7', // Purple
];

export const BRUSH_SIZES = [2, 4, 8, 12, 18, 28, 48, 72];

export const AVATAR_COLORS = [
  '#38bdf8', // Sky
  '#34d399', // Mint
  '#818cf8', // Indigo
  '#a78bfa', // Lavender
  '#fb923c', // Amber
  '#e2e8f0', // Silver
  '#2dd4bf', // Teal
  '#f59e0b', // Gold
  '#94a3b8', // Slate
];

const ADJECTIVES = [
  'Astral',
  'Silent',
  'Obsidian',
  'Lunar',
  'Mystic',
  'Kinetic',
  'Silver',
  'Echo',
  'Prism',
  'Velvet',
  'Cosmic',
  'Shadow',
  'Zenith',
  'Vesper',
  'Cobalt',
  'Apex',
];

const ANIMALS = [
  'Fox',
  'Falcon',
  'Lynx',
  'Hawk',
  'Wolf',
  'Otter',
  'Crane',
  'Heron',
  'Panther',
  'Badger',
  'Raven',
  'Viper',
  'Owl',
  'Tiger',
  'Eagle',
  'Panda',
];

export function generateAnonymousUser(): { userId: string; username: string; userColor: string } {
  // Check localStorage for existing user credentials
  try {
    const saved = localStorage.getItem('collab_canvas_user');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.userId && parsed.username && parsed.userColor) {
        return parsed;
      }
    }
  } catch (e) {
    // ignore
  }

  const userId = 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const num = Math.floor(10 + Math.random() * 89);
  const username = `${adj} ${animal} ${num}`;
  const userColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

  const userData = { userId, username, userColor };
  try {
    localStorage.setItem('collab_canvas_user', JSON.stringify(userData));
  } catch (e) {
    // ignore
  }

  return userData;
}

export function saveUsername(username: string): void {
  try {
    const saved = localStorage.getItem('collab_canvas_user');
    if (saved) {
      const parsed = JSON.parse(saved);
      parsed.username = username;
      localStorage.setItem('collab_canvas_user', JSON.stringify(parsed));
    }
  } catch (e) {
    // ignore
  }
}
