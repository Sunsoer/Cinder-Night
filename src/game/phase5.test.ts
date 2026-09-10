import assert from "node:assert/strict";
import { test } from "node:test";
import {
  atkScaleFromThreat,
  bossHpFromThreat,
  campaignBalanceSnapshot,
  campaignBossProfile,
  campaignCrownDropChance,
  campaignRunCrownBase,
  endlessPressureFor,
  hpScaleFromThreat,
  spdScaleFromThreat,
} from "./rules.ts";
import { applyFinalize } from "./finalize.ts";
import { defaultSave, nightCrowns, noteEndlessResult } from "./save.ts";
import {
  applyDailyMissionEvolution,
  applyDailyMissionRun,
  claimDailyMissions,
  dailyMissionClaimableCrowns,
  dailyMissionProgress,
  dailyMissionsDone,
  dailyMissionsFor,
} from "./missions.ts";
import {
  ENDLESS_BOSS_EVERY_S,
  ENDLESS_FIRST_BOSS_AT_S,
  ENDLESS_SECOND_BOSS_AT_S,
  endlessBossDurabilityMultiplier,
  endlessBossNightForNumber,
  endlessBossNumber,
  endlessBossSpawnTime,
  endlessDamageMultiplier,
  endlessDurabilityMultiplier,
  endlessEliteBonus,
  endlessEliteChanceCap,
  endlessEquivalentNight,
  endlessHealingMultiplier,
  endlessPhaseTime,
  endlessPlayerHitIFrame,
  endlessSpawnIntervalMultiplier,
  endlessSpeedMultiplier,
  endlessThreat,
  plausibleEndlessResult,
} from "./endless.ts";
import { NightEngine } from "./night.ts";
import {
  POWER_IDS,
  UPGRADES,
  applyMeta,
  crownCost,
  emptyMeta,
  openCards,
  xpToNext,
  type MetaKey,
} from "./content.ts";
import {
  applyLegacyBonuses,
  campaignHoldCrowns,
  progressCrownsBetween,
  progressRewardForNight,
} from "./milestones.ts";
import { sanitizeSave } from "./sanitize.ts";


function endlessBalanceAt(timeS: number) {
  const equivalentNight = endlessEquivalentNight(timeS);
  const threat = endlessThreat(timeS);
  const pressure = endlessPressureFor(equivalentNight);
  return {
    night: equivalentNight,
    threat,
    hp: hpScaleFromThreat(threat),
    speed: spdScaleFromThreat(threat),
    attack: atkScaleFromThreat(threat),
    bossHp: bossHpFromThreat(threat),
    spawnMul: pressure.spawnMul,
  };
}

function fakeCanvas() {
  const ctx = {
    canvas: null as unknown,
    setTransform() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    fillText() {},
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    drawImage() {},
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    shadowBlur: 0,
    shadowColor: "",
  };
  const canvas = {
    width: 390,
    height: 844,
    style: { width: "", height: "" },
    parentElement: null,
    getContext: () => ctx,
    getBoundingClientRect: () => ({
      width: 390,
      height: 844,
      top: 0,
      left: 0,
      right: 390,
      bottom: 844,
    }),
  };
  ctx.canvas = canvas;
  return canvas as unknown as HTMLCanvasElement;
}

test("phase 5 balance audit: every Campaign Night 1-1000 stays finite, paced and readable", () => {
  let previousThreat = -1;
  let previousNormal: ReturnType<typeof campaignBalanceSnapshot> | null = null;
  let previousGauntlet: ReturnType<typeof campaignBalanceSnapshot> | null = null;
  for (let night = 1; night <= 1000; night++) {
    const s = campaignBalanceSnapshot(night);
    const gauntlet = night % 50 === 0;
    for (const value of [
      s.threat,
      s.hp,
      s.speed,
      s.attack,
      s.bossHp,
      s.spawnMul,
      s.eliteCeiling,
      s.behaviorRank,
    ]) {
      assert.ok(Number.isFinite(value), `Night ${night} produced a non-finite balance value`);
    }
    assert.ok(s.hp >= 1 && s.hp <= (gauntlet ? 15 : 24), `Night ${night} HP scale escaped the tuned range`);
    assert.ok(s.speed >= 1 && s.speed <= 1.95, `Night ${night} speed became unreadable`);
    assert.ok(s.attack >= 1 && s.attack <= (gauntlet ? 3.4 : 3.6), `Night ${night} attack scale escaped its cap`);
    assert.ok(
      s.eliteCeiling >= 0.08 && s.eliteCeiling <= 0.3,
      `Night ${night} elite rate escaped its cap`,
    );
    assert.ok(s.spawnMul >= 0.68 && s.spawnMul <= 1, `Night ${night} spawn pacing escaped its cap`);
    assert.ok(
      s.behaviorRank >= 0 && s.behaviorRank <= 7,
      `Night ${night} behavior rank escaped its cap`,
    );
    assert.ok(s.threat + 1e-9 >= previousThreat, `Threat fell at Night ${night}`);
    previousThreat = s.threat;

    const lanePrevious = gauntlet ? previousGauntlet : previousNormal;
    if (lanePrevious) {
      assert.ok(s.hp + 1e-9 >= lanePrevious.hp, `HP scale fell within ${gauntlet ? "Gauntlet" : "normal"} lane at Night ${night}`);
      assert.ok(s.bossHp >= lanePrevious.bossHp, `Boss HP fell within ${gauntlet ? "Gauntlet" : "normal"} lane at Night ${night}`);
    }
    if (gauntlet) previousGauntlet = s;
    else previousNormal = s;
  }

  const normalCheckpoints = [1, 10, 49, 99, 249, 499, 749, 999].map(campaignBalanceSnapshot);
  const gauntletCheckpoints = [50, 100, 250, 500, 750, 1000].map(campaignBalanceSnapshot);
  for (const checkpoints of [normalCheckpoints, gauntletCheckpoints]) {
    for (let i = 1; i < checkpoints.length; i++) {
      assert.ok(checkpoints[i]!.hp > checkpoints[i - 1]!.hp, "major Campaign checkpoints must get harder within their lane");
      assert.ok(checkpoints[i]!.bossHp > checkpoints[i - 1]!.bossHp, "major boss checkpoints must get harder within their lane");
    }
  }
});

test("phase 5 defeat keeps all collected crowns, resets streak and repeats the same Night", () => {
  const start = {
    ...defaultSave,
    crowns: 0,
    nightsWon: 22,
    highestNight: 22,
    campaignStreak: 4,
    bestCampaignStreak: 7,
    reignMul: 1,
  };
  const full = nightCrowns(start, 21);
  const lost = applyFinalize(start, {
    runId: "phase5-loss",
    won: false,
    kills: 48,
    gold: 21,
    time: 120,
    daily: false,
    dailyId: "",
    doubled: false,
    nightIndex: 23,
    ranked: false,
    combo: 9,
    orderDay: "2026-09-05",
  });
  assert.equal(lost.crowns, full);
  assert.equal(lost.runActualPayout, full);
  assert.equal(lost.nightsWon, 22, "a defeat must not advance Campaign Night");
  assert.equal(lost.campaignStreak, 0);
  assert.equal(lost.bestCampaignStreak, 7);

  const won = applyFinalize(
    { ...start, campaignStreak: 4 },
    {
      runId: "phase5-win",
      won: true,
      kills: 60,
      gold: 21,
      time: 180,
      bossKill: false,
      daily: false,
      dailyId: "",
      doubled: false,
      nightIndex: 23,
      ranked: false,
      combo: 10,
      orderDay: "2026-09-05",
    },
  );
  assert.equal(won.nightsWon, 23);
  assert.equal(won.campaignStreak, 5);
  assert.equal(won.bestCampaignStreak, 7);
});

test("phase 5 daily missions always generate ten varied deterministic goals and claim once", () => {
  const day = "2026-09-05";
  const today = dailyMissionsFor(day);
  const again = dailyMissionsFor(day);
  const tomorrow = dailyMissionsFor("2026-09-06");
  assert.equal(today.length, 10);
  assert.equal(new Set(today.map((m) => m.id)).size, 10);
  assert.deepEqual(today, again);
  assert.notDeepEqual(
    today.map((m) => m.id),
    tomorrow.map((m) => m.id),
  );
  const totalReward = today.reduce((sum, m) => sum + m.crowns, 0);
  assert.ok(
    totalReward >= 40 && totalReward <= 100,
    `daily reward budget ${totalReward} is outside the intended range`,
  );

  let save = { ...defaultSave, crowns: 0 };
  for (let i = 0; i < 4; i++) {
    save = applyDailyMissionRun(save, day, {
      daily: false,
      won: true,
      kills: 120,
      time: 360,
      bossKill: true,
      combo: 25,
      gold: 40,
    });
  }
  save = applyDailyMissionEvolution(save, day);
  save = applyDailyMissionEvolution(save, day);
  save = applyDailyMissionEvolution(save, day);
  assert.equal(dailyMissionsDone(save, day), 10);
  assert.equal(dailyMissionClaimableCrowns(save, day), totalReward);
  const claimed = claimDailyMissions(save, day);
  assert.equal(claimed.crowns, totalReward);
  assert.equal(dailyMissionClaimableCrowns(claimed, day), 0);
  const twice = claimDailyMissions(claimed, day);
  assert.equal(twice.crowns, totalReward, "daily missions must not pay twice");
});

test("daily mission retuning preserves same-day progress and already claimed families", () => {
  const day = "2026-09-10";
  const runMission = dailyMissionsFor(day).find((mission) => mission.kind === "runs")!;
  const oldId = `runs:${Math.max(1, runMission.target - 1)}`;
  const inProgress = {
    ...defaultSave,
    dailyMissionDay: day,
    dailyMissionProgress: { [oldId]: runMission.target - 1 },
    dailyMissionClaimed: [],
  };

  assert.equal(dailyMissionProgress(inProgress, day, runMission), runMission.target - 1);
  const advanced = applyDailyMissionRun(inProgress, day, {
    daily: false,
    won: false,
    kills: 0,
    time: 0,
    bossKill: false,
    combo: 0,
    gold: 0,
  });
  assert.equal(dailyMissionProgress(advanced, day, runMission), runMission.target);

  const alreadyClaimed = { ...inProgress, dailyMissionClaimed: [oldId] };
  assert.equal(dailyMissionProgress(alreadyClaimed, day, runMission), runMission.target);
  assert.equal(
    dailyMissionClaimableCrowns(alreadyClaimed, day),
    0,
    "a claimed pre-retune family must not pay twice",
  );
});

test("phase 5 Endless has no round timer and its pressure rises without reset", () => {
  let prevNight = 0;
  let prevThreat = -1;
  let prevPhase = -1;
  for (let t = 0; t <= 4 * 60 * 60; t += 60) {
    const n = endlessEquivalentNight(t);
    const th = endlessThreat(t);
    const phase = endlessPhaseTime(t);
    assert.ok(n >= prevNight);
    assert.ok(th >= prevThreat);
    assert.ok(phase >= prevPhase && phase <= 110);
    prevNight = n;
    prevThreat = th;
    prevPhase = phase;
  }
  assert.equal(endlessBossNumber(ENDLESS_FIRST_BOSS_AT_S - 1), 0);
  assert.equal(endlessBossNumber(ENDLESS_FIRST_BOSS_AT_S), 1);
  assert.equal(endlessBossNumber(ENDLESS_SECOND_BOSS_AT_S - 1), 1);
  assert.equal(endlessBossNumber(ENDLESS_SECOND_BOSS_AT_S), 2);
  assert.equal(endlessBossNumber(ENDLESS_SECOND_BOSS_AT_S + ENDLESS_BOSS_EVERY_S), 3);
  assert.deepEqual([1, 2, 3, 4].map(endlessBossSpawnTime), [289, 599, 899, 1199]);

  const engine = new NightEngine(
    fakeCanvas(),
    { onHud() {}, onLevelUp() {}, onDeath() {}, onWin() {} },
    { shake: false, vibrate: false, reduced: true, headless: true, endless: true, seed: 5 },
  );
  assert.equal(engine.endless, true);
  assert.equal(engine.nightLen, Number.POSITIVE_INFINITY);
  assert.equal(engine.goldChance, 0);
  engine.destroy();
});

test("phase 5 Endless result plausibility uses authenticated session age, not a gameplay timer", () => {
  assert.equal(plausibleEndlessResult({ timeS: 600, kills: 700, sessionAgeMs: 605_000 }), true);
  assert.equal(plausibleEndlessResult({ timeS: 600, kills: 700, sessionAgeMs: 300_000 }), false);
  assert.equal(plausibleEndlessResult({ timeS: 60, kills: 99999, sessionAgeMs: 70_000 }), false);
});

test("phase 5 economy: Night 1-1000 funds a useful upgrade path without crown inflation", () => {
  // Guaranteed clear rewards alone must fund a sensible build. Random crown
  // drops, Daily Missions, Royal Orders, Reign and Season rewards are upside.
  const checkpoints: Array<[number, Partial<Record<MetaKey, number>>]> = [
    [50, { steel: 2, vita: 2, hide: 1, wisdom: 1, haste: 1, hound: 1 }],
    [100, { steel: 4, vita: 4, hide: 2, crit: 1, wisdom: 2, haste: 1, hound: 2 }],
    [
      250,
      {
        steel: 7,
        vita: 7,
        hide: 5,
        crit: 3,
        wisdom: 6,
        haste: 4,
        fortune: 2,
        sickle: 1,
        hound: 4,
        hawk: 2,
        guard: 2,
      },
    ],
    [
      500,
      {
        steel: 11,
        vita: 11,
        hide: 9,
        crit: 6,
        wisdom: 12,
        haste: 9,
        fortune: 6,
        sickle: 2,
        hound: 8,
        hawk: 6,
        guard: 6,
        ballista: 6,
        brazier: 4,
        beacon: 4,
      },
    ],
    [
      1000,
      {
        steel: 18,
        vita: 18,
        hide: 15,
        crit: 12,
        wisdom: 25,
        haste: 20,
        fortune: 15,
        sickle: 3,
        hound: 15,
        hawk: 12,
        guard: 12,
        ballista: 12,
        brazier: 10,
        beacon: 10,
      },
    ],
  ];
  const metaItems = new Map(
    UPGRADES.filter((i) => i.kind === "meta" && i.meta).map((i) => [i.meta!, i]),
  );
  const buildCost = (plan: Partial<Record<MetaKey, number>>) => {
    let total = 0;
    for (const [key, ranks] of Object.entries(plan) as Array<[MetaKey, number]>) {
      const item = metaItems.get(key);
      assert.ok(item, `missing upgrade item for ${key}`);
      for (let rank = 0; rank < ranks; rank++) total += crownCost(item!, rank) ?? 0;
    }
    return total;
  };

  let previousIncome = 0;
  for (const [night, plan] of checkpoints) {
    const guaranteed = progressCrownsBetween(0, night);
    const spent = buildCost(plan);
    assert.ok(guaranteed > previousIncome, `guaranteed crowns must rise through Night ${night}`);
    assert.ok(
      spent <= guaranteed,
      `Night ${night} useful build costs ${spent}, above guaranteed ${guaranteed}`,
    );
    previousIncome = guaranteed;

    const meta = emptyMeta();
    for (const [key, ranks] of Object.entries(plan) as Array<[MetaKey, number]>) meta[key] = ranks;
    const stats = {
      speed: 0,
      maxHp: 140,
      hp: 140,
      magnet: 420,
      regen: 0,
      vamp: 0,
      dmgMul: 1,
      rateMul: 1,
      owned: new Set(),
      weapons: {
        sickleCount: 1,
        sickleRate: 0.46,
        sickleDmg: 16,
        pierce: 0,
        orbit: 0,
        orbitR: 70,
        pulse: 0,
        pulseR: 140,
        chain: 0,
        chainJumps: 2,
        fire: 0,
        storm: 0,
      },
      explode: 0,
      recurve: false,
      twin: false,
      frost: 0,
      thorns: 0,
      hail: 0,
      split: false,
      ward: false,
      fortune: 0,
      soulHaste: 0,
      aura: 0,
      armor: 0,
      xpMul: 1,
      critChance: 0,
      critMul: 1.6,
      hounds: 0,
      hawks: 0,
      guards: 0,
      ballista: 0,
      brazier: 0,
      beacon: 0,
      pack: { hound: 0, hawk: 0, guard: 0, ballista: 0, brazier: 0, beacon: 0 },
      evo: {},
      lastStand: false,
      cursePet: 1,
      curseTower: 1,
      curseShot: 1,
      rareAdd: 0,
    } as any;
    applyMeta(stats, meta);
    applyLegacyBonuses(stats, night);
    assert.ok(
      stats.maxHp >= 140 && stats.maxHp < 800,
      `Night ${night} meta HP became unreasonable`,
    );
    assert.ok(
      stats.dmgMul >= 1 && stats.dmgMul < 3.5,
      `Night ${night} meta damage became unreasonable`,
    );
    assert.ok(
      stats.metaRateMul > 0 && stats.metaRateMul <= 1,
      `Night ${night} permanent attack speed escaped readable bounds`,
    );
  }

  const upgradeItems = POWER_IDS.map((id) => UPGRADES.find((item) => item.id === id)!);
  const costThroughRank = (ranks: number) =>
    upgradeItems.reduce((sum, item) => {
      let subtotal = 0;
      for (let rank = 0; rank < ranks; rank++) subtotal += crownCost(item, rank) ?? 0;
      return sum + subtotal;
    }, 0);
  const first20 = costThroughRank(20);
  const first50 = costThroughRank(50);
  assert.ok(first20 > 0 && first50 > first20, "unlimited Upgrade costs must keep rising");
  assert.ok(
    first20 < progressCrownsBetween(0, 1000) && first50 > progressCrownsBetween(0, 1000),
    "Night 1-1000 should fund broad early Upgrades without finishing an endless system",
  );
  assert.equal(progressCrownsBetween(0, 1000), 63_972);
  assert.equal(campaignHoldCrowns(1000), 78);
  assert.equal(progressRewardForNight(1000)?.crowns, 509);
});

test("phase 5 Endless ranking has no seven-day ceiling", () => {
  const eightDays = 8 * 24 * 60 * 60;
  assert.equal(
    plausibleEndlessResult({ timeS: eightDays, kills: 1000, sessionAgeMs: (eightDays + 5) * 1000 }),
    true,
  );
  assert.equal(
    plausibleEndlessResult({
      timeS: eightDays,
      kills: 1000,
      sessionAgeMs: (eightDays - 60) * 1000,
    }),
    false,
  );
});

test("phase 5 local Endless best survives beyond seven days", () => {
  const eightDays = 8 * 24 * 60 * 60;
  const clean = sanitizeSave({ ...defaultSave, endlessBest: eightDays }, defaultSave);
  assert.equal(clean.endlessBest, eightDays);
});

test("phase 5 Endless result counters do not wrap at the old 32-bit range", () => {
  const huge = 3_153_600_000;
  const next = noteEndlessResult(
    { ...defaultSave, endlessBest: 3_000_000_000, endlessRuns: 3_000_000_000 },
    huge,
  );
  assert.equal(next.endlessBest, huge);
  assert.equal(next.endlessRuns, 3_000_000_001);
  const clean = sanitizeSave(next, defaultSave);
  assert.equal(clean.endlessBest, huge);
  assert.equal(clean.endlessRuns, 3_000_000_001);
});

test("phase 5 sanitizer preserves unlimited ranks for the seven Upgrade stats", () => {
  const raw = {
    ...defaultSave,
    meta: { ...defaultSave.meta, steel: 500, hide: 600, vita: 700, mend: 800, crit: 900, haste: 1000, fortune: 1100 },
  };
  const clean = sanitizeSave(raw, defaultSave);
  assert.equal(clean.meta.steel, 500);
  assert.equal(clean.meta.hide, 600);
  assert.equal(clean.meta.vita, 700);
  assert.equal(clean.meta.mend, 800);
  assert.equal(clean.meta.crit, 900);
  assert.equal(clean.meta.haste, 1000);
  assert.equal(clean.meta.fortune, 1100);
});

test("C.N.11.11 Campaign crowns use the approved 1.725 payout and drop chance rises continuously toward 25%", () => {
  assert.equal(campaignRunCrownBase(10), 17);
  assert.equal(campaignRunCrownBase(100), 172);
  assert.equal(campaignRunCrownBase(1000), 1725);

  let prior = campaignCrownDropChance(1);
  assert.equal(prior, 0.02);
  for (let night = 2; night <= 10_000; night++) {
    const chance = campaignCrownDropChance(night);
    assert.ok(chance > prior, `Night ${night}: crown drop chance did not rise`);
    prior = chance;
  }
  assert.ok(campaignCrownDropChance(20) > 0.045 && campaignCrownDropChance(20) < 0.055);
  assert.ok(campaignCrownDropChance(100) > 0.075 && campaignCrownDropChance(100) < 0.085);
  assert.ok(
    Math.abs(campaignCrownDropChance(10_000) - 0.2) < 1e-12,
    "Night 10k must be exactly 20%",
  );
  assert.ok(campaignCrownDropChance(100_000) > 0.23, "post-10k crown chance should keep rising");
  assert.ok(
    campaignCrownDropChance(1_000_000_000) < 0.25,
    "base curve should approach the cap smoothly",
  );
  assert.ok(
    campaignCrownDropChance(Number.MAX_SAFE_INTEGER) <= 0.25,
    "extreme Campaign must respect the 25% cap",
  );
});

test("phase 5 permanent Crown Drop Chance improves beyond the 25% base layer and approaches 100%", () => {
  const meta = emptyMeta();
  meta.fortune = 500;
  const engine = new NightEngine(
    fakeCanvas(),
    { onHud() {}, onLevelUp() {}, onDeath() {}, onWin() {} },
    {
      shake: false,
      vibrate: false,
      reduced: true,
      headless: true,
      nightIndex: 1000,
      meta,
      seed: 9,
    },
  );
  assert.ok(engine.goldChance > 0.25, "permanent Crown Drop Chance may improve past the old 25% base layer");
  assert.ok(engine.goldChance < 1, "finite permanent ranks must remain below 100%");

  const lower = campaignCrownDropChance(10_000, 0.2);
  const higher = campaignCrownDropChance(10_000, 0.21);
  assert.ok(higher > lower && higher < 1, "every finite permanent chance increase must still help");
  assert.ok(
    campaignCrownDropChance(Number.MAX_SAFE_INTEGER, 10) > 0.99,
    "very high permanent pressure should approach 100%",
  );
  assert.equal(
    campaignCrownDropChance(Number.MAX_SAFE_INTEGER, 10, 0, 2),
    1,
    "temporary in-run bonuses still cannot exceed a 100% probability",
  );
  engine.destroy();
});

test("phase 5 Endless bosses spawn at 4:49, 9:59, then every five minutes", () => {
  const engine = new NightEngine(
    fakeCanvas(),
    { onHud() {}, onLevelUp() {}, onDeath() {}, onWin() {} },
    { shake: false, vibrate: false, reduced: true, headless: true, endless: true, seed: 99 },
  );
  engine.stats.hp = engine.stats.maxHp = 1_000_000;
  assert.equal(engine.endlessNextBossAt, 289);

  engine.time = 288.99;
  engine.tick(1 / 60);
  assert.equal(engine.bossSpawned, true, "first Endless boss must arrive at 4:49");
  assert.equal(engine.endlessBossCount, 1);
  assert.equal(
    engine.bossProfile.variantId,
    campaignBossProfile(endlessBossNightForNumber(1), 1).variantId,
  );

  const first = engine.enemies.find((e) => e.alive && e.kind === 4);
  assert.ok(first);
  (engine as any).killEnemy(first);
  engine.hitstop = 0;
  assert.equal(engine.endlessNextBossAt, 599);

  engine.time = 598.99;
  engine.tick(1 / 60);
  assert.equal(engine.bossSpawned, true, "second Endless boss must arrive at 9:59");
  assert.equal(engine.endlessBossCount, 2);
  const secondId = engine.bossProfile.variantId;
  assert.equal(secondId, campaignBossProfile(endlessBossNightForNumber(2), 1).variantId);
  assert.notEqual(secondId, campaignBossProfile(endlessBossNightForNumber(1), 1).variantId);
  engine.destroy();
});

test("phase 5 Endless difficulty remains finite and rises for very long runs", () => {
  const checkpoints = [0, 289, 599, 1800, 14_400, 86_400, 604_800, 31_536_000, 3_153_600_000];
  let previousNight = -1;
  let previousThreat = -1;
  let previousBossHp = -1;
  for (const seconds of checkpoints) {
    const equivalentNight = endlessEquivalentNight(seconds);
    const threat = endlessThreat(seconds);
    const balance = endlessBalanceAt(seconds);
    assert.ok(
      Number.isFinite(equivalentNight) && equivalentNight >= previousNight,
      `Endless ${seconds}s equivalent Night reset`,
    );
    assert.ok(
      Number.isFinite(threat) && threat >= previousThreat,
      `Endless ${seconds}s threat reset`,
    );
    assert.ok(
      Number.isFinite(balance.bossHp) && balance.bossHp >= previousBossHp,
      `Endless ${seconds}s boss pressure reset`,
    );
    previousNight = equivalentNight;
    previousThreat = threat;
    previousBossHp = balance.bossHp;
  }

  const ids = new Set<string>();
  for (const bossNumber of [1, 2, 3, 10, 100, 10_000, 1_000_000]) {
    const at = endlessBossSpawnTime(bossNumber);
    assert.ok(Number.isFinite(at) && at > 0, `Endless boss ${bossNumber}: invalid spawn time`);
    const profile = campaignBossProfile(endlessBossNightForNumber(bossNumber), 1);
    assert.ok(!ids.has(profile.variantId), `Endless boss ${bossNumber}: identity repeated`);
    ids.add(profile.variantId);
  }
});
test("phase 5 Endless difficulty stays readable early and demanding later without one-shot math", () => {
  const early = endlessBalanceAt(0);
  const tenMinutes = endlessBalanceAt(599);
  const thirtyMinutes = endlessBalanceAt(1800);
  const oneHour = endlessBalanceAt(3600);

  assert.ok(
    early.hp < 1.35 && early.attack < 1.2,
    "Endless opening became too punishing for a fresh standardized run",
  );
  assert.ok(
    tenMinutes.hp < 2.7 && tenMinutes.attack < 1.9,
    "first ten Endless minutes escaped the readable ramp",
  );
  assert.ok(
    thirtyMinutes.hp > 2.8 && thirtyMinutes.attack > 1.9,
    "30-minute Endless stopped applying meaningful pressure",
  );
  assert.ok(
    oneHour.hp > thirtyMinutes.hp && oneHour.attack >= thirtyMinutes.attack,
    "Endless did not keep ramping after 30 minutes",
  );

  for (const seconds of [0, 599, 1800, 3600, 7200, 14_400, 86_400]) {
    const balance = endlessBalanceAt(seconds);
    const hardestNormalHit = 24 * balance.attack * 1.1;
    assert.ok(
      hardestNormalHit < 70,
      `Endless ${seconds}s: ordinary body hit crossed the readability ceiling`,
    );
  }

  for (let bossNumber = 1; bossNumber <= 48; bossNumber++) {
    const boss = campaignBossProfile(endlessBossNightForNumber(bossNumber), 1);
    const special = Math.max(
      boss.slamDamage * boss.damageMul,
      14 * boss.damageMul,
      boss.reaperDashDamage * boss.damageMul,
      (10 + Math.min(8, boss.ascendantRank)) * boss.damageMul,
      (11 + Math.min(7, boss.ascendantRank)) * boss.damageMul,
    );
    assert.ok(
      special < 60,
      `Endless boss ${bossNumber}: special damage became an unavoidable base-life one-shot wall`,
    );
  }
});

test("phase 5 Endless pressure overtakes a complete in-run build without a hard timer", () => {
  const checkpoints = [0, 600, 1800, 3600, 4500, 5400, 7200, 86_400, 3_153_600_000];
  let priorDurability = 0;
  let priorBossDurability = 0;
  let priorDamage = 0;
  let priorHealing = 1;
  let priorIFrame = 1;

  for (const seconds of checkpoints) {
    const durability = endlessDurabilityMultiplier(seconds);
    const bossDurability = endlessBossDurabilityMultiplier(seconds);
    const damage = endlessDamageMultiplier(seconds);
    const healing = endlessHealingMultiplier(seconds);
    const iFrame = endlessPlayerHitIFrame(seconds);
    const values = [
      durability,
      bossDurability,
      damage,
      healing,
      iFrame,
      endlessSpeedMultiplier(seconds),
      endlessSpawnIntervalMultiplier(seconds),
      endlessEliteBonus(seconds),
      endlessEliteChanceCap(seconds),
    ];
    assert.ok(values.every(Number.isFinite), `Endless ${seconds}s produced a non-finite multiplier`);
    assert.ok(durability >= priorDurability, `Endless ${seconds}s durability fell`);
    assert.ok(bossDurability >= priorBossDurability, `Endless ${seconds}s boss durability fell`);
    assert.ok(damage >= priorDamage, `Endless ${seconds}s damage fell`);
    assert.ok(healing <= priorHealing, `Endless ${seconds}s healing pressure reset`);
    assert.ok(iFrame <= priorIFrame, `Endless ${seconds}s hit immunity reset`);
    priorDurability = durability;
    priorBossDurability = bossDurability;
    priorDamage = damage;
    priorHealing = healing;
    priorIFrame = iFrame;
  }

  assert.ok(endlessDurabilityMultiplier(0) <= 1.06, "Endless opening durability became a wall");
  assert.ok(endlessDamageMultiplier(0) <= 1.05, "Endless opening damage became a wall");
  assert.ok(endlessDurabilityMultiplier(1800) > 4.5, "30-minute durability is too weak");
  assert.ok(endlessDamageMultiplier(1800) > 2.2, "30-minute damage is too weak");
  assert.ok(endlessDurabilityMultiplier(3600) > 16, "one-hour durability cannot pressure a full build");
  assert.ok(endlessBossDurabilityMultiplier(3600) > 40, "one-hour Lord still evaporates");
  assert.ok(endlessHealingMultiplier(3600) < 0.25, "one-hour life steal still erases all damage");
  assert.ok(endlessPlayerHitIFrame(4500) <= 0.301, "late global hit immunity remains too forgiving");
});

test("phase 5 Endless ignores permanent menu upgrades and stops empty level-ups at MAX BUILD", () => {
  const meta = emptyMeta();
  for (const id of Object.keys(meta) as MetaKey[]) meta[id] = 1_000_000;
  let offers = 0;
  let lastHud: any = null;
  const engine: any = new NightEngine(
    fakeCanvas(),
    {
      onHud(hud: any) {
        lastHud = hud;
      },
      onLevelUp() {
        offers += 1;
      },
      onDeath() {},
      onWin() {},
    },
    {
      shake: false,
      vibrate: false,
      reduced: true,
      headless: true,
      endless: true,
      seed: 5505,
      meta,
      open: openCards(99, [], false),
    },
  );

  assert.equal(engine.stats.maxHp, 140);
  assert.equal(engine.stats.dmgMul, 1);
  let picks = 0;
  while (picks < 500) {
    const deal = engine.deal();
    if (!deal.length) break;
    engine.applyPick(deal[0]!.id);
    picks += 1;
  }
  assert.equal(picks, 166);
  engine.level = 167;
  engine.xp = xpToNext(engine.level);
  engine.tryLevel();
  assert.equal(engine.level, 168);
  assert.equal(engine.buildMaxed, true);
  assert.equal(engine.xp, 0);
  assert.equal(offers, 0);

  engine.xp = 1_000_000_000;
  engine.tryLevel();
  assert.equal(engine.level, 168, "MAX BUILD continued producing meaningless levels");
  assert.equal(engine.xp, 0);
  engine.pushHud();
  assert.equal(lastHud?.buildMaxed, true);
  assert.equal(lastHud?.need, 0);
  engine.destroy();
});
