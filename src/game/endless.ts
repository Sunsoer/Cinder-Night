import { threatFromNights } from "./content";

export const ENDLESS_BOSS_EVERY_S = 300;
export const ENDLESS_FIRST_BOSS_AT_S = 4 * 60 + 49; // 4:49
export const ENDLESS_SECOND_BOSS_AT_S = 9 * 60 + 59; // 9:59
export const ENDLESS_MIN_SUBMIT_S = 5;

function endlessMinutes(timeS: number) {
  return Math.max(0, Number(timeS) || 0) / 60;
}

function smooth01(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/**
 * Endless is a standardized survival ranking, so its curve must eventually
 * overtake even the complete 166-pick in-run build. These multipliers are
 * Endless-only: Campaign, Daily, Meta, Legacy and Ascension remain untouched.
 *
 * The opening is noticeably firmer without being a wall. After ten minutes the
 * quadratic durability curve becomes the main pressure, preventing maxed
 * screen-wide builds from deleting every spawn forever.
 */
export function endlessDurabilityMultiplier(timeS: number) {
  const minutes = endlessMinutes(timeS);
  const late = Math.max(0, minutes - 10);
  return 1.05 * Math.pow(1 + late / 20, 2.2);
}

/** Bosses need an additional late layer or a complete build erases each Lord. */
export function endlessBossDurabilityMultiplier(timeS: number) {
  const minutes = endlessMinutes(timeS);
  const late = Math.max(0, minutes - 20);
  return endlessDurabilityMultiplier(timeS) * Math.pow(1 + late / 45, 1.5);
}

/**
 * Damage rises more gently than durability so difficulty comes from sustained
 * pressure before it becomes lethal. It remains uncapped, guaranteeing that an
 * Endless run cannot become permanently immortal.
 */
export function endlessDamageMultiplier(timeS: number) {
  const minutes = endlessMinutes(timeS);
  const late = Math.max(0, minutes - 10);
  return 1.04 * Math.pow(1 + late / 35, 1.7);
}

/** Gradually makes late enemies faster while retaining readable telegraphs. */
export function endlessSpeedMultiplier(timeS: number) {
  const minutes = endlessMinutes(timeS);
  return 1.02 + 0.16 * smooth01(minutes / 60);
}

/** Denser packets, with the existing fixed pools still protecting mobile performance. */
export function endlessSpawnIntervalMultiplier(timeS: number) {
  const minutes = endlessMinutes(timeS);
  return 0.97 - 0.29 * smooth01(minutes / 45);
}

/** More late elites create pressure without increasing the 95-enemy pool. */
export function endlessEliteBonus(timeS: number) {
  const minutes = endlessMinutes(timeS);
  return 0.01 + 0.29 * smooth01(Math.max(0, minutes - 10) / 60);
}

export function endlessEliteChanceCap(timeS: number) {
  const minutes = endlessMinutes(timeS);
  return 0.35 + 0.27 * smooth01(Math.max(0, minutes - 10) / 60);
}

/**
 * A full build has 10.5 passive HP/s plus 30% life steal on every area hit.
 * Without late healing pressure, incoming damage can never stick. Healing stays
 * useful, but it can no longer refill the King instantly forever.
 */
export function endlessHealingMultiplier(timeS: number) {
  const minutes = endlessMinutes(timeS);
  const late = Math.max(0, minutes - 10);
  return Math.max(0.12, 1 / Math.pow(1 + late / 20, 1.15));
}

/** Shorter global hit immunity lets sustained late pressure matter. */
export function endlessPlayerHitIFrame(timeS: number) {
  const minutes = endlessMinutes(timeS);
  const late = Math.max(0, minutes - 10);
  return 0.68 - 0.38 * smooth01(late / 65);
}

/**
 * Endless starts around early-campaign pressure, then advances about five
 * campaign Nights per minute. That keeps the first minutes readable while
 * making 15–30 minute runs genuinely difficult without a hard time limit.
 */

/**
 * Endless has no round timer, but spawn pacing still needs a readable ramp.
 * This maps elapsed time onto the normal 110-second pressure phase without
 * ever resetting it. Around minute 13 the temporal part reaches its cap;
 * after that difficulty continues through threat, composition and bosses.
 */
export function endlessPhaseTime(timeS: number) {
  const t = Math.max(0, Number(timeS) || 0);
  return Math.min(110, 15 + t * 0.12);
}

export function endlessEquivalentNight(timeS: number) {
  const t = Math.max(0, Number(timeS) || 0);
  return Math.max(5, 5 + Math.floor(t / 60) * 5);
}

export function endlessThreat(timeS: number) {
  return threatFromNights(Math.max(0, endlessEquivalentNight(timeS) - 1));
}

/** One-based Endless boss schedule: 4:49, 9:59, 14:59, 19:59, ... */
export function endlessBossSpawnTime(bossNumber: number) {
  const n = Math.max(1, Math.trunc(Number(bossNumber) || 1));
  if (n === 1) return ENDLESS_FIRST_BOSS_AT_S;
  return ENDLESS_SECOND_BOSS_AT_S + (n - 2) * ENDLESS_BOSS_EVERY_S;
}

/** Number of Lords whose scheduled arrival time has been reached. */
export function endlessBossNumber(timeS: number) {
  const t = Math.max(0, Number(timeS) || 0);
  if (t < ENDLESS_FIRST_BOSS_AT_S) return 0;
  if (t < ENDLESS_SECOND_BOSS_AT_S) return 1;
  return 2 + Math.floor((t - ENDLESS_SECOND_BOSS_AT_S) / ENDLESS_BOSS_EVERY_S);
}

/**
 * Stable procedural seed lane for Endless bosses. The 25-Night spacing keeps
 * boss power close to the pre-existing Endless curve while making identity
 * depend only on encounter ordinal, never on local RNG or device state.
 */
export function endlessBossNightForNumber(bossNumber: number) {
  const n = Math.max(1, Math.trunc(Number(bossNumber) || 1));
  return n * 25;
}

export function endlessBossNight(timeS: number) {
  return endlessBossNightForNumber(Math.max(1, endlessBossNumber(timeS)));
}

export function plausibleEndlessResult(input: {
  timeS: number;
  kills: number;
  sessionAgeMs: number;
}) {
  const timeS = Math.max(0, Math.floor(Number(input.timeS) || 0));
  const kills = Math.max(0, Math.floor(Number(input.kills) || 0));
  const ageS = Math.max(0, Number(input.sessionAgeMs) / 1000);
  if (timeS < ENDLESS_MIN_SUBMIT_S || !Number.isSafeInteger(timeS)) return false;
  // Client simulation time can lag wall time during hit-stop/card choices, but
  // it must never materially exceed the authenticated server session age.
  if (timeS > ageS + 12) return false;
  // Wide anti-cheat ceiling: enough for extreme late-game density without
  // accepting obviously fabricated kill totals.
  if (kills > 100 + timeS * 18) return false;
  return true;
}

export function formatEndlessTime(timeS: number) {
  const s = Math.max(0, Math.floor(timeS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
