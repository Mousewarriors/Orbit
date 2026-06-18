/**
 * Renderer persistence for Profile + Memory (settings KV; no migration needed).
 * Profile and memory are stored under separate keys and never mixed (spec §18).
 */
import * as native from '../native.js';
import {
  parseMemories,
  parseMemorySettings,
  parseProfile,
  serializeMemories,
  serializeMemorySettings,
  serializeProfile,
  type MemoryRecord,
  type MemorySettings,
  type Profile,
} from '@orbit/profile';

export const PROFILE_SETTING_KEYS = {
  profile: 'profile.facts',
  memories: 'memory.records',
  memorySettings: 'memory.settings',
} as const;

export interface ProfileBundle {
  profile: Profile;
  memories: MemoryRecord[];
  memorySettings: MemorySettings;
}

export async function loadProfileBundle(): Promise<ProfileBundle> {
  if (!native.isTauri()) {
    return { profile: parseProfile(null), memories: [], memorySettings: parseMemorySettings(null) };
  }
  const [p, m, s] = await Promise.all([
    native.getSetting(PROFILE_SETTING_KEYS.profile).catch(() => null),
    native.getSetting(PROFILE_SETTING_KEYS.memories).catch(() => null),
    native.getSetting(PROFILE_SETTING_KEYS.memorySettings).catch(() => null),
  ]);
  return {
    profile: parseProfile(p),
    memories: parseMemories(m),
    memorySettings: parseMemorySettings(s),
  };
}

export async function saveProfile(profile: Profile): Promise<void> {
  if (native.isTauri()) await native.setSetting(PROFILE_SETTING_KEYS.profile, serializeProfile(profile));
}

export async function saveMemories(memories: readonly MemoryRecord[]): Promise<void> {
  if (native.isTauri()) await native.setSetting(PROFILE_SETTING_KEYS.memories, serializeMemories(memories));
}

export async function saveMemorySettings(settings: MemorySettings): Promise<void> {
  if (native.isTauri())
    await native.setSetting(PROFILE_SETTING_KEYS.memorySettings, serializeMemorySettings(settings));
}
