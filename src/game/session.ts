/** Daily run length. Campaign nights use campaignNightLength(). */
export const NIGHT_LEN = 300;
export const CAMPAIGN_NORMAL_LEN = 300;
export const CAMPAIGN_BOSS_LEN = 600;
export const CAMPAIGN_BOSS_EVERY = 5;
export const CAMPAIGN_BOSS_GAUNTLET_EVERY = 50;
export const CAMPAIGN_BOSS_GAUNTLET_LEN = 300;
export const CAMPAIGN_BOSS_GAUNTLET_MAX_BOSSES = 3;
/** Every 50-Night gauntlet opens with four normal 3-card draft picks before combat begins. */
export const CAMPAIGN_BOSS_GAUNTLET_START_PICKS = 4;
export const CAMPAIGN_POST_BOSS_GRACE = 5;
/** Bosses arrive one second before each five-minute phase boundary. */
export const CAMPAIGN_NORMAL_BOSS_TIMES = [299] as const;
export const CAMPAIGN_BOSS_TIMES = [299, 599] as const;
export const CAMPAIGN_NORMAL_HORDE_TIMES = [150] as const;
export const CAMPAIGN_BOSS_HORDE_TIMES = [150, 450] as const;
export const DAILY_HORDE_TIMES = [150] as const;

export function isCampaignBossNight(nightIndex: number) {
  const n = Math.max(1, Math.trunc(Number(nightIndex) || 1));
  return n % CAMPAIGN_BOSS_EVERY === 0;
}

export function isCampaignBossGauntletNight(nightIndex: number) {
  const n = Math.max(1, Math.trunc(Number(nightIndex) || 1));
  return n % CAMPAIGN_BOSS_GAUNTLET_EVERY === 0;
}

/** Every 50th Night is a five-minute boss-only gauntlet with three active Lords. */
export function campaignBossGauntletConcurrentCap(nightIndex: number) {
  return isCampaignBossGauntletNight(nightIndex) ? CAMPAIGN_BOSS_GAUNTLET_MAX_BOSSES : 0;
}

export function campaignNightLength(nightIndex: number) {
  if (isCampaignBossGauntletNight(nightIndex)) return CAMPAIGN_BOSS_GAUNTLET_LEN;
  return isCampaignBossNight(nightIndex) ? CAMPAIGN_BOSS_LEN : CAMPAIGN_NORMAL_LEN;
}

export function campaignBossTimes(nightIndex: number): readonly number[] {
  // Gauntlets are replenished continuously by NightEngine rather than scheduled
  // at a phase boundary. The sentinel keeps server-side boss-kill validation.
  if (isCampaignBossGauntletNight(nightIndex)) return [0] as const;
  return isCampaignBossNight(nightIndex) ? CAMPAIGN_BOSS_TIMES : CAMPAIGN_NORMAL_BOSS_TIMES;
}

/** Mid-phase mass waves. Every 50th boss gauntlet is deliberately excluded. */
export function campaignHordeTimes(nightIndex: number): readonly number[] {
  if (isCampaignBossGauntletNight(nightIndex)) return [];
  return isCampaignBossNight(nightIndex) ? CAMPAIGN_BOSS_HORDE_TIMES : CAMPAIGN_NORMAL_HORDE_TIMES;
}

export type HudSummon = {
  id: string;
  label: string;
  current: number;
  max: number;
  status?: string;
};

export type Hud = {
  hp: number;
  maxHp: number;
  time: number;
  duration: number;
  endless?: boolean;
  buildMaxed?: boolean;
  xp: number;
  need: number;
  level: number;
  gold: number;
  kills: number;
  combo: number;
  boss: boolean;
  bossHp: number;
  bossMax: number;
  sickles: number;
  orbits: number;
  threat: number;
  banner: string;
  decreeCd: number;
  decreeMax: number;
  overdriveCd: number;
  overdriveMax: number;
  overdriveT: number;
  overdriveDuration: number;
  fireCd: number;
  fireMax: number;
  fireStacks: number;
  chainCd: number;
  chainMax: number;
  chainStacks: number;
  pulseCd: number;
  pulseMax: number;
  pulseStacks: number;
  stormCount: number;
  stormStability: number;
  stormMaxStability: number;
  stormRespawn: number;
  stormRespawnMax: number;
  /** Every active life-bearing summon gets its own compact HUD entry. */
  summons: HudSummon[];
  spearCd: number;
  spearMax: number;
  spearStacks: number;
  minesCd: number;
  minesMax: number;
  minesStacks: number;
  chainsCd: number;
  chainsMax: number;
  chainsStacks: number;
  shadowEchoCd: number;
  shadowEchoMax: number;
  shadowEchoStacks: number;
};

export type NightStats = {
  time: number;
  kills: number;
  gold: number;
  level: number;
  won: boolean;
  combo: number;
  bossLeft: number;
  bossSeen: boolean;
  bossKill?: boolean;
  bossRetreated?: boolean;
  hp?: number;
};
