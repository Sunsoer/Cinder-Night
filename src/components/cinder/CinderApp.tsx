import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Frame from "lucide-react/dist/esm/icons/frame";
import Heart from "lucide-react/dist/esm/icons/heart";
import Pause from "lucide-react/dist/esm/icons/pause";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import Crown from "lucide-react/dist/esm/icons/crown";
import Trophy from "lucide-react/dist/esm/icons/trophy";
import X from "lucide-react/dist/esm/icons/x";
import Shield from "lucide-react/dist/esm/icons/shield";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Zap from "lucide-react/dist/esm/icons/zap";
import Swords from "lucide-react/dist/esm/icons/swords";
import Volume2 from "lucide-react/dist/esm/icons/volume-2";
import VolumeX from "lucide-react/dist/esm/icons/volume-x";
import Vibrate from "lucide-react/dist/esm/icons/vibrate";
import Waves from "lucide-react/dist/esm/icons/waves";
import { NIGHT_LEN, type Hud, type NightStats } from "@/game/session";
import {
  RELICS,
  CARDS,
  UPGRADES,
  crownCost,
  dailyRelicFor,
  HP_CARD,
  metaLevel,
  openCards,
  POWER_IDS,
  powerNow,
  threatFromNights,
  nextUnlock,
  emptyMeta,
  evolutionProgressForCard,
  evolutionProgressForId,
  evolutionRequirementText,
  evolutionEffectText,
  type CardDef,
  type CardId,
  type PlayerStats,
  type RelicId,
  type UpgradeItem,
} from "@/game/content";
import {
  buyUpgradeItem,
  defaultSave,
  loadSave,
  markDaily,
  markEvo,
  claimDailyMissionRewards,
  nightCrowns,
  campaignResultCrowns,
  noteWeekScore,
  patchProfile,
  patchSettings,
  selectRelic,
  finalizeRun,
  markPendingDefeat,
  clearPendingDefeat,
  noteUnsent,
  clearUnsent,
  closeDailyDouble,
  startActiveRun,
  syncServerDailyClaim,
  abandonActiveRun,
  dismissActiveRun,
  enqueueUnsent,
  unsentAtCap,
  syncCampaignProgressFromSession,
  noteEndlessResult,
  writeSave,
  type SaveData,
} from "@/game/save";
import {
  beginMenuAudio,
  beginNightAudio,
  endMenuAudio,
  endNightAudio,
  resumeAfterForeground,
  resumeFromUserGesture,
  setLevels,
  setMuted,
  sfxBuy,
  suspendAudio,
} from "@/game/audio";
import { isoWeekKey, nightScore } from "@/game/score";
import { dailySeed, curseForDay, type CurseDef } from "@/game/daily";
import { ACTIVE_EVO_IDS, EVO_TITLE, isEvoId } from "@/game/evo";
import {
  ballistaTowerCooldown,
  cannonTowerBlastRadius,
  cannonTowerCooldown,
  FIRE_TOWER_ACTIVE_S,
  FIRE_TOWER_RELOAD_S,
  fireTowerDps,
  fireTowerReach,
  healTowerCooldown,
  healTowerFraction,
  healTowerRange,
  heirTowerMinionCooldown,
  heirTowerMinionDamage,
  heirTowerMinionHp,
  laserTowerBeamDuration,
  laserTowerCooldown,
  laserTowerDps,
} from "@/game/court";
import {
  DAILY_OPEN_NIGHTS,
  canPostScore,
  campaignArenaFor,
  campaignMutationLabel,
  formatCourtRank,
  makeRunId,
  playingNightIndex,
  unlockedCampaignMutations,
  utcDayKey,
} from "@/game/rules";
import {
  DailyBoard,
  DailyCard,
  EvoHelpList,
  TomeScreen,
  VolumeRow,
} from "@/components/cinder/MetaUI";
import { tapProps, pressProps, instantProps } from "@/lib/tap";
import { devToolsEnabled, isProduction } from "@/game/env";
import { dailyMainClaimed, pauseQuitIsLoss } from "@/game/finalize";
import { replaceTimer } from "@/game/spatial";
import { reviveButtonAllowed, reviveSlots } from "@/game/revive";
import { setServerNow, trustedNow } from "@/game/clock";
import {
  dailyMissionClaimableCrowns,
  dailyMissionProgress,
  dailyMissionsDone,
  dailyMissionsFor,
} from "@/game/missions";
import { formatEndlessTime } from "@/game/endless";
import {
  pauseFromPhase,
  resumePausedPhase,
  scoreReplyApplies,
  staleOpenShouldAbandon,
  clockMayReplaceRunDaily,
  rankedBeginPlan,
  type RunCtx,
} from "@/game/flow";
import { Face } from "@/components/cinder/avatars";
import { bindAppViewport, syncAppViewportAfterForeground } from "@/game/viewport";
import {
  clearRunRecovery,
  readRunRecovery,
  recoveryMatchesActiveRun,
  writeRunRecovery,
  type RunRecovery,
} from "@/game/run-recovery";
import { trackGameEvent } from "@/game/analytics";
import {
  isMajorMilestone,
  legacyRankFor,
  milestoneProgress,
  progressRewardForNight,
} from "@/game/milestones";
import { ascendantGiftForMilestone, nextAscendantGift } from "@/game/ascension";
import { APP_RELEASE } from "@/game/release";

const CourtScreen = lazy(() =>
  import("@/components/cinder/CourtUI").then((m) => ({ default: m.CourtScreen })),
);
const ProfileScreen = lazy(() =>
  import("@/components/cinder/ProfileUI").then((m) => ({ default: m.ProfileScreen })),
);

type Screen =
  "title" | "hub" | "power" | "play" | "help" | "settings" | "court" | "profile" | "tome";
type PlayEngine = {
  stats: PlayerStats;
  start: () => void;
  destroy: () => void;
  setPaused: (v: boolean) => void;
  setGameSpeed: (speed: 1 | 2) => void;
  applyPick: (id: CardId) => void;
  banish: (id: CardId) => boolean;
  castDecree: () => boolean;
  castOverdrive: () => boolean;
  revive: () => void;
  snapshot: (won?: boolean) => NightStats;
  pendingLevels: number;
  banishesLeft: number;
  refitViewport?: () => void;
  exportRecoveryState?: () => unknown;
  restoreRecoveryState?: (state: unknown, cardChoiceVisible?: boolean) => void;
  recoverPendingChoice?: () => boolean;
};
type PlayPhase = "run" | "cards" | "dead" | "won" | "paused";

const BOOT_ENGINE_TIMEOUT_MS = 4500;
const BOOT_SESSION_TIMEOUT_MS = 2000;
const BOOT_CAMPAIGN_SESSION_TIMEOUT_MS = 1200;
const BOOT_CLOCK_TIMEOUT_MS = 900;
const INITIAL_WARM_TIMEOUT_MS = 1800;

let nightModulePromise: Promise<typeof import("@/game/night")> | null = null;

function loadNightModule() {
  if (!nightModulePromise) {
    nightModulePromise = import("@/game/night").catch((error) => {
      nightModulePromise = null;
      throw error;
    });
  }
  return nightModulePromise;
}

type CinderBootWindow = Window & {
  __CINDER_READY?: boolean;
  __CINDER_SET_BOOT_PROGRESS?: (value: number, label?: string) => void;
  __CINDER_NIGHT_START_MS?: number;
  __CINDER_BOOT_ERROR?: string;
};

function reportInitialBoot(value: number, label: string) {
  if (typeof window === "undefined") return;
  (window as CinderBootWindow).__CINDER_SET_BOOT_PROGRESS?.(value, label);
}

function preloadCourtArt(): Promise<void> {
  if (typeof Image === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = "high";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    image.onload = finish;
    image.onerror = finish;
    image.src = COURT_ART_SRC;
    if (image.complete) finish();
  });
}

const COURT_ART_SRC = `${import.meta.env.BASE_URL}cinder-court.jpg`;

const emptyHud: Hud = {
  hp: 140,
  maxHp: 140,
  time: 0,
  duration: NIGHT_LEN,
  endless: false,
  xp: 0,
  need: 12,
  level: 1,
  gold: 0,
  kills: 0,
  combo: 0,
  boss: false,
  bossHp: 0,
  bossMax: 720,
  sickles: 1,
  orbits: 0,
  threat: 0,
  banner: "",
  decreeCd: 0,
  decreeMax: 20,
  overdriveCd: 0,
  overdriveMax: 50,
  overdriveT: 0,
  overdriveDuration: 10,
  fireCd: 0,
  fireMax: 5,
  fireStacks: 0,
  chainCd: 0,
  chainMax: 5,
  chainStacks: 0,
  pulseCd: 0,
  pulseMax: 3,
  pulseStacks: 0,
  stormCount: 0,
  stormStability: 0,
  stormMaxStability: 150,
  stormRespawn: 0,
  stormRespawnMax: 12,
  summons: [],
  spearCd: 0,
  spearMax: 5,
  spearStacks: 0,
  minesCd: 0,
  minesMax: 7,
  minesStacks: 0,
  chainsCd: 0,
  chainsMax: 9,
  chainsStacks: 0,
  shadowEchoCd: 0,
  shadowEchoMax: 7,
  shadowEchoStacks: 0,
};

function fmtRemain(elapsed: number, duration = NIGHT_LEN) {
  const s = Math.max(0, Math.ceil(duration - elapsed));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function fmtSince(ts: number) {
  if (!ts) return "today";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "today";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type TimedResult<T> = { ok: true; value: T } | { ok: false; timedOut: boolean; error?: unknown };

async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<TimedResult<T>> {
  let timer = 0;
  const timeout = new Promise<TimedResult<T>>((resolve) => {
    timer = window.setTimeout(() => resolve({ ok: false, timedOut: true }), ms);
  });
  const settled = promise.then(
    (value): TimedResult<T> => ({ ok: true, value }),
    (error: unknown): TimedResult<T> => ({ ok: false, timedOut: false, error }),
  );
  const result = await Promise.race([settled, timeout]);
  window.clearTimeout(timer);
  return result;
}

export function CinderApp() {
  const [save, setSave] = useState<SaveData>(defaultSave);
  const [screen, setScreen] = useState<Screen>("title");
  const [phase, setPhase] = useState<PlayPhase>("run");
  const [hud, setHud] = useState<Hud>(emptyHud);
  const [cards, setCards] = useState<CardDef[]>([]);
  const [stats, setStats] = useState<NightStats | null>(null);
  const [revivesLeft, setRevivesLeft] = useState(1);
  const [hint, setHint] = useState(true);
  const [synergy, setSynergy] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const [dailyMode, setDailyMode] = useState(false);
  const [endlessMode, setEndlessMode] = useState(false);
  const [opening, setOpening] = useState(false);
  const [nightBootProgress, setNightBootProgress] = useState(0);
  const [nightBootStage, setNightBootStage] = useState("Preparing the arena…");
  const [runScore, setRunScore] = useState<number | null>(null);
  const [courtPlace, setCourtPlace] = useState<string | null>(null);
  const [dailyId, setDailyId] = useState(utcDayKey());
  const [dailyBoardOpen, setDailyBoardOpen] = useState(false);
  const [offlineUnranked, setOfflineUnranked] = useState(false);
  const [syncNeed, setSyncNeed] = useState(false);
  const [loadoutOpen, setLoadoutOpen] = useState(false);
  const [playSettingsOpen, setPlaySettingsOpen] = useState(false);
  const [gameSpeed, setGameSpeed] = useState<1 | 2>(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PlayEngine | null>(null);
  const gameSpeedRef = useRef<1 | 2>(1);
  const bootSeq = useRef(0);
  const paidRef = useRef(false);
  const runTokenRef = useRef("");
  const sessionRef = useRef("");
  const dailyIdRef = useRef(utcDayKey());
  const saveRef = useRef(save);
  saveRef.current = save;
  const reduced = useRef(false);
  const dailyRef = useRef(false);
  dailyRef.current = dailyMode;
  const endlessRef = useRef(false);
  endlessRef.current = endlessMode;
  const synergyTimer = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const rankedRef = useRef(true);
  const pausedFromRef = useRef<"run" | "cards" | null>(null);
  const runClockRef = useRef(0);
  const runCtxRef = useRef<RunCtx | null>(null);
  const audioNeedsUnlockRef = useRef(false);
  const nightIndexRef = useRef(1);
  const nightBootStartedRef = useRef(0);
  const nightBootRetryCountRef = useRef(0);
  const nightBootRetryTimerRef = useRef(0);
  // Locks the currently rendered card choice immediately on touch. Mobile WebViews
  // can otherwise dispatch a second tap before React paints the next deal.
  const cardPickLockRef = useRef(false);
  const flushPendingScoresRef = useRef<() => Promise<void>>(async () => {});
  const recoveryRef = useRef<RunRecovery | null>(null);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const revivesLeftRef = useRef(revivesLeft);
  revivesLeftRef.current = revivesLeft;
  const backgroundPauseRef = useRef(false);

  const wakeAudioFromGesture = () => {
    audioNeedsUnlockRef.current = true;
    void resumeFromUserGesture()
      .then((needsGesture) => {
        audioNeedsUnlockRef.current = needsGesture;
      })
      .catch(() => {
        audioNeedsUnlockRef.current = true;
      });
  };

  useEffect(() => {
    try {
      document.documentElement.dataset.cinderHydrated = "true";
      reportInitialBoot(68, "Restoring your crown…");
      const loaded = loadSave();
      setSave(loaded);
      const storedRecovery = readRunRecovery();
      const canRecover =
        !!storedRecovery &&
        (storedRecovery.mode === "endless" ||
          recoveryMatchesActiveRun(storedRecovery, loaded.activeRun));
      if (canRecover && storedRecovery) {
        recoveryRef.current = storedRecovery;
        setDailyMode(storedRecovery.mode === "daily");
        dailyRef.current = storedRecovery.mode === "daily";
        setEndlessMode(storedRecovery.mode === "endless");
        endlessRef.current = storedRecovery.mode === "endless";
        if (storedRecovery.dailyId) {
          dailyIdRef.current = storedRecovery.dailyId;
          setDailyId(storedRecovery.dailyId);
        }
        setScreen("play");
        setRunId((n) => n + 1);
      } else if (storedRecovery) {
        clearRunRecovery(storedRecovery.runId);
      }
      reportInitialBoot(74, "Warming the court…");

      // Warm the two things the player sees/uses first while the boot overlay is
      // still up: title artwork and the heavy combat engine. The overlay has a
      // short ceiling so a weak connection never makes the title feel stuck.
      let initialReady = false;
      const finishInitialBoot = () => {
        if (initialReady) return;
        initialReady = true;
        reportInitialBoot(100, "Court ready");
        if (!canRecover) {
          const menuNeedsGesture = beginMenuAudio();
          audioNeedsUnlockRef.current = menuNeedsGesture;
        }
        const w = window as CinderBootWindow;
        w.__CINDER_READY = true;
        try {
          delete w.__CINDER_BOOT_ERROR;
        } catch {
          /* diagnostics cleanup only */
        }
        window.dispatchEvent(new Event("cinder-ready"));
      };
      const warmArt = preloadCourtArt().then(() => reportInitialBoot(84, "Sharpening the throne…"));
      const warmNight = loadNightModule()
        .then(() => reportInitialBoot(94, "Arming the night…"))
        .catch(() => {
          // Begin Night still owns the retry/error UI if this speculative warmup fails.
        });
      void Promise.allSettled([warmArt, warmNight]).then(finishInitialBoot);
      const initialReadyTimer = window.setTimeout(finishInitialBoot, INITIAL_WARM_TIMEOUT_MS);
      const warmServicesTimer = window.setTimeout(() => {
        // These are non-critical. Warming their client proxies after the title is
        // ready removes another first-tap fetch without stealing boot bandwidth.
        void import("@/server/court").catch(() => {});
        void import("@/server/rankings").catch(() => {});
      }, INITIAL_WARM_TIMEOUT_MS + 250);

      setMuted(loaded.settings.muted);
      setLevels(loaded.settings.sfx, loaded.settings.music);
      reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let syncing = false;
      const flushPendingScores = async () => {
        if (syncing) return;
        syncing = true;
        try {
          const queue = [...(saveRef.current.unsentSubmits ?? [])];
          for (const u of queue) {
            if (!u.sessionId || !u.runId) continue;
            try {
              if (u.mode === "endless" || u.payload.kind === "endless") {
                const { submitEndless } = await import("@/server/rankings");
                await submitEndless({
                  data: {
                    runId: u.runId,
                    sessionId: u.sessionId,
                    time: Math.max(0, Math.floor(Number(u.payload.time) || 0)),
                    kills: Math.max(0, Math.floor(Number(u.payload.kills) || 0)),
                  },
                });
              } else {
                const { submitNight } = await import("@/server/court");
                await submitNight({
                  data: {
                    score: Number(u.payload.score) || 0,
                    kills: Number(u.payload.kills) || 0,
                    time: Number(u.payload.time) || 0,
                    won: !!u.payload.won,
                    nightIndex: Number(u.payload.nightIndex) || 1,
                    kind: u.mode === "daily" || u.payload.kind === "daily" ? "daily" : "night",
                    runId: u.runId,
                    dailyId: u.mode === "daily" ? String(u.payload.dailyId || "") : undefined,
                    sessionId: u.sessionId,
                    bossKilled: !!u.payload.bossKilled,
                    hpRemaining: Number(u.payload.hpRemaining) || 0,
                    highestCombo: Number(u.payload.highestCombo) || 0,
                  },
                });
              }
              setSave((prev) => {
                const next = clearUnsent(prev, u.runId);
                saveRef.current = next;
                return next;
              });
            } catch {
              // Keep the row. It will retry on reconnect, foreground or next boot.
            }
          }
        } finally {
          syncing = false;
        }
      };
      flushPendingScoresRef.current = flushPendingScores;
      const later = window.setTimeout(() => {
        void flushPendingScores();
      }, 400);
      const onOnline = () => {
        void flushPendingScores();
      };
      window.addEventListener("online", onOnline);
      void import("@/server/clock")
        .then(({ getDailyClock }) => getDailyClock())
        .then((c) => {
          if (c?.now) setServerNow(c.now);
          if (c?.dailyId) {
            setDailyId(c.dailyId);
            if (clockMayReplaceRunDaily(!!runCtxRef.current)) {
              dailyIdRef.current = c.dailyId;
            }
          }
        })
        .catch(() => {
          if (!clockMayReplaceRunDaily(!!runCtxRef.current)) return;
          const day = utcDayKey();
          dailyIdRef.current = day;
          setDailyId(day);
        });
      let backgrounded = false;
      const persistCurrentRun = () => {
        const engine = engineRef.current;
        const runId = runTokenRef.current;
        if (
          screenRef.current !== "play" ||
          !engine ||
          !runId ||
          phaseRef.current === "dead" ||
          phaseRef.current === "won"
        )
          return;
        const state = engine.exportRecoveryState?.();
        if (!state) return;
        const mode = endlessRef.current ? "endless" : dailyRef.current ? "daily" : "night";
        writeRunRecovery({
          version: 1,
          runId,
          mode,
          nightIndex: nightIndexRef.current,
          dailyId: mode === "daily" ? dailyIdRef.current : "",
          capturedAt: Date.now(),
          phase: phaseRef.current === "cards" ? "cards" : "run",
          cardIds: phaseRef.current === "cards" ? cardsRef.current.map((c) => c.id) : [],
          revivesLeft: revivesLeftRef.current,
          engine: state,
        });
      };
      const recoveryTimer = window.setInterval(persistCurrentRun, 15000);
      const pauseForBackground = () => {
        if (backgrounded) return;
        backgrounded = true;
        // iOS can freeze or discard a PWA very shortly after pagehide. Persist
        // both progression and the gameplay checkpoint synchronously first.
        persistCurrentRun();
        writeSave(saveRef.current);
        if (screenRef.current === "play") {
          const from = pauseFromPhase(phaseRef.current);
          if (from) {
            pausedFromRef.current = from;
            backgroundPauseRef.current = true;
            engineRef.current?.setPaused(true);
            setPhase("paused");
          }
        }
        suspendAudio(true);
        audioNeedsUnlockRef.current = true;
      };
      const resumeForeground = () => {
        // pageshow can fire while iOS still reports the document as hidden. Do
        // not clear the background pause until the app is actually visible.
        if (document.visibilityState === "hidden") return;
        backgrounded = false;
        void import("@/server/clock")
          .then(({ getDailyClock }) => getDailyClock())
          .then((c) => {
            if (c?.now) setServerNow(c.now);
          })
          .catch(() => {
            /* keep monotonic server clock */
          });
        void flushPendingScores();
        void resumeAfterForeground()
          .then((needsGesture) => {
            audioNeedsUnlockRef.current = needsGesture;
          })
          .catch(() => {
            audioNeedsUnlockRef.current = true;
          });

        // Resume gameplay independently of viewport settling. bindAppViewport
        // also performs its own pageshow settle and intentionally cancels older
        // viewport tokens. Keeping setPaused(false) inside that callback could
        // therefore leave React/UI alive while the arena stayed frozen. Only a
        // pause created by backgrounding is auto-resumed; manual pauses remain.
        if (backgroundPauseRef.current && screenRef.current === "play") {
          engineRef.current?.setPaused(false);
          setPhase(resumePausedPhase(pausedFromRef.current));
          pausedFromRef.current = null;
          backgroundPauseRef.current = false;
        }

        syncAppViewportAfterForeground(() => {
          engineRef.current?.refitViewport?.();
        });
      };
      const onVis = () => {
        if (document.visibilityState === "hidden") pauseForBackground();
        else resumeForeground();
      };
      const onPageHide = () => pauseForBackground();
      const onPageShow = () => resumeForeground();
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("pageshow", onPageShow);
      const unbindView = bindAppViewport(() => engineRef.current?.refitViewport?.());
      const unlockFromGesture = () => {
        if (!audioNeedsUnlockRef.current) return;
        void resumeFromUserGesture()
          .then((needsGesture) => {
            audioNeedsUnlockRef.current = needsGesture;
          })
          .catch(() => {
            audioNeedsUnlockRef.current = true;
          });
      };
      const pointerOpts = { capture: true } as AddEventListenerOptions;
      const hasPointer = typeof window.PointerEvent !== "undefined";
      if (hasPointer) window.addEventListener("pointerdown", unlockFromGesture, pointerOpts);
      else window.addEventListener("touchend", unlockFromGesture, pointerOpts);
      return () => {
        window.clearTimeout(later);
        window.clearTimeout(initialReadyTimer);
        window.clearTimeout(warmServicesTimer);
        window.clearInterval(recoveryTimer);
        flushPendingScoresRef.current = async () => {};
        window.removeEventListener("online", onOnline);
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
        unbindView();
        if (hasPointer) window.removeEventListener("pointerdown", unlockFromGesture, pointerOpts);
        else window.removeEventListener("touchend", unlockFromGesture, pointerOpts);
      };
    } catch {
      setSave(defaultSave);
    }
  }, []);

  useEffect(() => {
    setMuted(save.settings.muted);
    setLevels(save.settings.sfx, save.settings.music);
  }, [save.settings.muted, save.settings.sfx, save.settings.music]);

  const tearDown = useCallback(() => {
    engineRef.current?.destroy();
    engineRef.current = null;
    endNightAudio();
    const needsGesture = beginMenuAudio();
    audioNeedsUnlockRef.current = audioNeedsUnlockRef.current || needsGesture;
  }, []);

  const postScore = useCallback((s: NightStats, daily: boolean, ctx: RunCtx, ranked = true) => {
    const snap = saveRef.current;
    const score = daily
      ? 0
      : nightScore({
          kills: s.kills,
          time: s.time,
          gold: s.gold,
          won: s.won,
          nightsWon: snap.nightsWon + (s.won ? 1 : 0),
          combo: s.combo,
          bossKill: !!s.bossKill,
        });
    if (scoreReplyApplies(runCtxRef.current, ctx)) {
      setRunScore(daily ? null : score);
      setCourtPlace(null);
    }
    if (!daily && ranked) {
      setSave((prev) => noteWeekScore(prev, score));
    }
    const sessionId = ctx.sessionId;
    if (!canPostScore(ctx.runId, sessionId, ranked)) return;
    const payload = {
      score,
      kills: s.kills,
      time: s.time,
      won: s.won,
      nightIndex: daily ? 1 : ctx.nightIndex || playingNightIndex(snap.nightsWon),
      kind: daily ? "daily" : "night",
      runId: ctx.runId,
      dailyId: daily ? ctx.dailyId : undefined,
      sessionId,
      bossKilled: !!s.bossKill,
      hpRemaining: Math.max(0, Math.floor(s.hp ?? 0)),
      highestCombo: s.combo,
    };
    void import("@/server/court")
      .then(({ submitNight }) => submitNight({ data: payload }))
      .then((board) => {
        setSave((prev) => clearUnsent(prev, ctx.runId));
        if (!scoreReplyApplies(runCtxRef.current, ctx)) return;
        if (daily) return;
        if (board.you) {
          const label = formatCourtRank(board.you.rank);
          setCourtPlace(`Court ${label} · ${board.you.score} nights this week`);
        }
      })
      .catch(() => {
        setSave((prev) =>
          enqueueUnsent(prev, {
            runId: ctx.runId,
            sessionId,
            mode: daily ? "daily" : "night",
            payload: { ...payload },
            createdAt: Date.now(),
          }),
        );
      });
  }, []);

  const bootNight = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const seq = ++bootSeq.current;
    tearDown();
    setPhase("run");
    setHud(emptyHud);
    setStats(null);
    setCards([]);
    setHint(true);
    setSynergy(null);
    setOpening(true);
    setNightBootProgress((value) => (nightBootRetryCountRef.current > 0 ? Math.max(value, 8) : 8));
    setNightBootStage("Preparing the arena…");
    nightBootStartedRef.current =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    paidRef.current = false;
    const recovery = recoveryRef.current;
    runTokenRef.current = recovery?.runId ?? makeRunId();
    sessionRef.current = "";
    runCtxRef.current = null;
    rankedRef.current = !recovery;
    runClockRef.current = 0;
    pausedFromRef.current = null;
    setOfflineUnranked(false);
    setRunScore(null);
    setCourtPlace(null);
    const still = () => seq === bootSeq.current && canvasRef.current === canvas;
    try {
      const snap = saveRef.current;
      const daily = dailyRef.current;
      const endless = endlessRef.current;
      let dailyId = recovery?.dailyId || dailyIdRef.current || utcDayKey();

      // The local game engine is the critical path. Start loading it immediately
      // and bound the wait so a broken/lost chunk can never leave the opening
      // scrim on screen forever. Network services are secondary and may fall
      // back to offline practice without blocking the night.
      setNightBootProgress((value) => Math.max(value, 24));
      setNightBootStage("Loading combat engine…");
      const engineResultP = settleWithin(loadNightModule(), BOOT_ENGINE_TIMEOUT_MS);

      if (daily && !recovery) {
        try {
          const clockTask = import("@/server/clock").then(({ getDailyClock }) => getDailyClock());
          const clockResult = await settleWithin(clockTask, BOOT_CLOCK_TIMEOUT_MS);
          if (!still()) return;
          if (clockResult.ok) {
            const clock = clockResult.value;
            if (clock?.now) {
              setServerNow(clock.now);
              runClockRef.current = clock.now;
            }
            if (clock?.dailyId) dailyId = clock.dailyId;
          } else {
            dailyId = utcDayKey();
          }
        } catch {
          dailyId = utcDayKey();
        }
      } else if (!recovery) {
        runClockRef.current = Date.now();
        void import("@/server/clock")
          .then(({ getDailyClock }) => getDailyClock())
          .then((clock) => {
            if (seq !== bootSeq.current) return;
            if (clock?.now) {
              setServerNow(clock.now);
              runClockRef.current = clock.now;
            }
          })
          .catch(() => {});
      }

      dailyIdRef.current = dailyId;
      setDailyId(dailyId);
      let nightIndex =
        recovery?.nightIndex ?? (daily || endless ? 1 : playingNightIndex(snap.nightsWon));
      nightIndexRef.current = nightIndex;
      setRevivesLeft(
        recovery
          ? recovery.revivesLeft
          : endless
            ? 0
            : reviveSlots({ daily, extraRevive: !daily && snap.extraRevive }),
      );

      if (recovery) {
        sessionRef.current = "";
        rankedRef.current = false;
        setOfflineUnranked(true);
      } else
        try {
          type OpenSessionResult = {
            ok?: boolean;
            sessionId?: string;
            reason?: string;
          };
          const openTask: Promise<OpenSessionResult> = endless
            ? import("@/server/rankings").then(({ openEndlessRun }) =>
                openEndlessRun({ data: { runId: runTokenRef.current } }),
              )
            : import("@/server/court").then(({ openRun }) =>
                openRun({
                  data: {
                    kind: daily ? "daily" : "night",
                    nightIndex,
                    dailyId: daily ? dailyId : undefined,
                    runId: runTokenRef.current,
                    force: true,
                  },
                }),
              );
          setNightBootProgress((value) => Math.max(value, 42));
          setNightBootStage(daily || endless ? "Opening ranked session…" : "Opening the court…");
          const openTimeout =
            daily || endless ? BOOT_SESSION_TIMEOUT_MS : BOOT_CAMPAIGN_SESSION_TIMEOUT_MS;
          const openResult = await settleWithin(openTask, openTimeout);
          if (!still()) return;
          if (!openResult.ok) {
            if (openResult.timedOut) {
              void openTask
                .then((late: any) => {
                  if (!late?.sessionId) return;
                  return endless
                    ? import("@/server/rankings").then(({ abandonEndlessRun }) =>
                        abandonEndlessRun({ data: { sessionId: late.sessionId } }),
                      )
                    : import("@/server/court").then(({ abandonRun }) =>
                        abandonRun({ data: { sessionId: late.sessionId } }),
                      );
                })
                .catch(() => {});
            }
            sessionRef.current = "";
            rankedRef.current = false;
            setOfflineUnranked(true);
          } else {
            const sess: any = openResult.value;
            if (staleOpenShouldAbandon(seq, bootSeq.current) || canvasRef.current !== canvas) {
              if (sess?.sessionId) {
                if (endless) {
                  void import("@/server/rankings")
                    .then(({ abandonEndlessRun }) =>
                      abandonEndlessRun({ data: { sessionId: sess.sessionId } }),
                    )
                    .catch(() => {});
                } else {
                  void import("@/server/court")
                    .then(({ abandonRun }) => abandonRun({ data: { sessionId: sess.sessionId } }))
                    .catch(() => {});
                }
              }
              return;
            }
            if (!sess || sess.ok === false || !sess.sessionId) {
              sessionRef.current = "";
              rankedRef.current = false;
              setOfflineUnranked(true);
            } else {
              sessionRef.current = sess.sessionId;
              if (!endless && !daily && Number(sess.nightIndex) >= 1) {
                nightIndex = Number(sess.nightIndex);
                const synced = syncCampaignProgressFromSession(saveRef.current, nightIndex);
                saveRef.current = synced;
                setSave(synced);
              }
              nightIndexRef.current = nightIndex;
              if (!endless && sess.dailyId) {
                dailyId = sess.dailyId;
                dailyIdRef.current = sess.dailyId;
                setDailyId(sess.dailyId);
              }
              if (!endless) {
                runCtxRef.current = {
                  runId: runTokenRef.current,
                  sessionId: sess.sessionId,
                  dailyId: daily ? dailyId : "",
                  mode: daily ? "daily" : "night",
                  nightIndex,
                };
              }
              if (!endless && daily && sess.mainClaimed)
                setSave((prev) => syncServerDailyClaim(prev, dailyId, true));
              rankedRef.current = true;
              setOfflineUnranked(false);
            }
          }
        } catch {
          sessionRef.current = "";
          rankedRef.current = false;
          setOfflineUnranked(true);
        }

      setNightBootProgress((value) => Math.max(value, 62));
      setNightBootStage(rankedRef.current ? "Court linked…" : "Local progress ready…");
      if (!still()) return;
      const engineResult = await engineResultP;
      if (!still()) return;
      if (!engineResult.ok) {
        if (engineResult.timedOut) {
          // A genuinely stalled dynamic import must not poison the next automatic
          // attempt with the same forever-pending promise. Start a fresh import.
          nightModulePromise = null;
          throw new Error("The game engine took too long to load.");
        }
        throw engineResult.error instanceof Error
          ? engineResult.error
          : new Error("The game engine could not be loaded.");
      }
      setNightBootProgress((value) => Math.max(value, 80));
      setNightBootStage("Forging enemies and powers…");
      const { NightEngine } = engineResult.value;
      const curse = daily ? curseForDay(dailyId) : null;
      const dailyRelic = daily ? dailyRelicFor(dailyId) : null;
      if (!still()) return;
      const engine = new NightEngine(
        canvas,
        {
          onHud: (h) => {
            if (seq !== bootSeq.current) return;
            setHud(h);
          },
          onLevelUp: (c) => {
            if (seq !== bootSeq.current) return;
            cardPickLockRef.current = false;
            if (!c.length) {
              cardsRef.current = [];
              phaseRef.current = "run";
              setCards([]);
              setPhase("run");
              return;
            }
            // The engine already excludes owned Evolutions. De-duplicate again at
            // the UI boundary so a stale/duplicated host event can never render the
            // same card twice in one choice screen.
            const unique = c.filter(
              (card, index, all) =>
                all.findIndex((candidate) => candidate.id === card.id) === index,
            );
            // Keep the lifecycle refs in sync in this same engine callback. React
            // state is intentionally asynchronous, while iOS may emit pagehide
            // before the next render. Without these assignments a checkpoint can
            // contain engine.choosing=true but phase="run" and no visible cards,
            // which restores as a completely frozen arena with working UI icons.
            cardsRef.current = unique;
            phaseRef.current = "cards";
            setCards(unique);
            setPhase("cards");
          },
          onDeath: (s) => {
            if (seq !== bootSeq.current) return;
            clearRunRecovery(runTokenRef.current);
            setStats(s);
            setPhase("dead");
            trackGameEvent("run_loss", Math.floor(s.time), s.kills);
            if (endless) {
              paidRef.current = true;
              const endlessRunId = runTokenRef.current;
              const endlessSessionId = sessionRef.current;
              const rankedEndless = rankedRef.current && !!endlessSessionId;
              setSave((prev) => {
                const next = noteEndlessResult(
                  prev,
                  s.time,
                  rankedEndless
                    ? { runId: endlessRunId, sessionId: endlessSessionId, kills: s.kills }
                    : undefined,
                );
                saveRef.current = next;
                return next;
              });
              if (rankedEndless) {
                void import("@/server/rankings")
                  .then(({ submitEndless }) =>
                    submitEndless({
                      data: {
                        runId: endlessRunId,
                        sessionId: endlessSessionId,
                        time: Math.floor(s.time),
                        kills: s.kills,
                      },
                    }),
                  )
                  .then(() =>
                    setSave((prev) => {
                      const next = clearUnsent(prev, endlessRunId);
                      saveRef.current = next;
                      return next;
                    }),
                  )
                  .catch(() => {
                    /* queued locally; reconnect will retry */
                  });
              }
              return;
            }
            if (!rankedRef.current || !sessionRef.current) return;
            setSave((prev) =>
              markPendingDefeat(
                prev,
                {
                  runId: runTokenRef.current,
                  won: false,
                  kills: s.kills,
                  gold: s.gold,
                  time: s.time,
                  bossKill: false,
                  daily,
                  dailyId,
                  doubled: false,
                  nightIndex,
                  seasonNow: runClockRef.current,
                  orderDay: utcDayKey(trustedNow() || Date.now()),
                },
                {
                  sessionId: sessionRef.current,
                  score: nightScore({
                    kills: s.kills,
                    time: s.time,
                    gold: s.gold,
                    won: false,
                    nightsWon: daily ? 0 : prev.nightsWon,
                    combo: s.combo,
                    bossKill: false,
                  }),
                  nightIndex,
                },
              ),
            );
          },
          onWin: (s) => {
            if (seq !== bootSeq.current) return;
            clearRunRecovery(runTokenRef.current);
            if (endless || paidRef.current) return;
            paidRef.current = true;
            setStats(s);
            setPhase("won");
            trackGameEvent("run_win", s.kills, Math.floor(s.time));
            if (s.bossKill) trackGameEvent("boss_kill", daily ? 1 : nightIndex, s.kills);
            setSave((prev) => {
              const ranked = rankedRef.current && !!sessionRef.current;
              const next = finalizeRun(prev, {
                runId: runTokenRef.current,
                won: true,
                kills: s.kills,
                gold: s.gold,
                time: s.time,
                bossKill: !!s.bossKill,
                daily,
                dailyId,
                doubled: false,
                nightIndex,
                ranked,
                combo: s.combo,
                seasonNow: runClockRef.current || prev.activeRun?.seasonNow,
                orderDay: utcDayKey(trustedNow() || Date.now()),
                score: daily
                  ? 0
                  : nightScore({
                      kills: s.kills,
                      time: s.time,
                      gold: s.gold,
                      won: true,
                      nightsWon: daily ? 0 : nightIndex,
                      combo: s.combo,
                      bossKill: !!s.bossKill,
                    }),
              });
              if (!ranked || !sessionRef.current) return next;
              return noteUnsent(next, {
                runId: runTokenRef.current,
                sessionId: sessionRef.current,
                score: 0,
                kills: s.kills,
                time: s.time,
                won: true,
                nightIndex,
                kind: daily ? "daily" : "night",
                dailyId,
                bossKilled: !!s.bossKill,
                hpRemaining: Math.max(0, Math.floor(s.hp ?? 0)),
                highestCombo: s.combo,
              });
            });
            postScore(
              { ...s, won: true },
              daily,
              {
                runId: runTokenRef.current,
                sessionId: sessionRef.current,
                dailyId: daily ? dailyId : "",
                mode: daily ? "daily" : "night",
                nightIndex,
              },
              rankedRef.current,
            );
          },
          onSynergy: (title) => {
            setSynergy(title);
            synergyTimer.current = replaceTimer(
              synergyTimer.current,
              (fn, ms) => window.setTimeout(fn, ms),
              (id) => window.clearTimeout(id),
              () => setSynergy(null),
              1800,
            );
          },
          onEvo: (id) => {
            trackGameEvent("evolution", isEvoId(id) ? 1 : 0, endless ? -1 : daily ? 1 : nightIndex);
            if (!endless) {
              setSave((prev) => markEvo(prev, id, utcDayKey(trustedNow() || Date.now())));
            }
          },
        },
        {
          shake: snap.settings.shake,
          vibrate: snap.settings.vibrate,
          reduced: reduced.current || !!snap.settings.reducedFx,
          viewDebug: !!snap.settings.viewDebug && !isProduction(),
          relic: endless ? "sickle" : daily ? (dailyRelic ?? "sickle") : snap.selected,
          daily: daily ? dailyRelic : null,
          cloak: daily || endless ? false : snap.cloak,
          banishes: 1,
          threat: endless ? 0 : threatFromNights(daily ? 0 : nightIndex - 1),
          nightIndex: daily || endless ? 1 : nightIndex,
          open: endless
            ? openCards(99, [], false)
            : daily
              ? openCards(DAILY_OPEN_NIGHTS, [], false)
              : openCards(nightIndex - 1, snap.unlocks, snap.archive),
          meta: daily || endless ? emptyMeta() : snap.meta,
          curse: endless ? null : curse,
          lookKing: snap.look.king,
          lookShot: snap.look.shot,
          lookFloor: snap.look.floor,
          fair: daily,
          endless,
          seed: daily ? dailySeed(dailyId) : undefined,
        },
      );
      if (!still()) {
        engine.destroy();
        return;
      }
      if (recovery) {
        const restoredCards = recovery.cardIds
          .map((id) => CARDS.find((card) => card.id === id))
          .filter((card): card is CardDef => !!card);
        const restoredChoiceVisible = recovery.phase === "cards" && restoredCards.length > 0;
        engine.restoreRecoveryState?.(recovery.engine, restoredChoiceVisible);
        if (restoredChoiceVisible) {
          cardsRef.current = restoredCards;
          phaseRef.current = "cards";
          setCards(restoredCards);
          setPhase("cards");
        } else {
          cardsRef.current = [];
          phaseRef.current = "run";
          setCards([]);
          setPhase("run");
          // Repair older/racy checkpoints that captured a queued level but lost
          // the matching React card overlay. Re-deal that pending choice instead
          // of leaving NightEngine.choosing hidden and the whole arena frozen.
          engine.recoverPendingChoice?.();
        }
        rankedRef.current = false;
        sessionRef.current = "";
        setOfflineUnranked(true);
      }
      engineRef.current = engine;
      engine.setGameSpeed(gameSpeedRef.current);
      setNightBootProgress((value) => Math.max(value, 96));
      setNightBootStage("Night ready");
      endMenuAudio();
      setOpening(false);
      nightBootRetryCountRef.current = 0;
      if (nightBootRetryTimerRef.current) {
        window.clearTimeout(nightBootRetryTimerRef.current);
        nightBootRetryTimerRef.current = 0;
      }
      engine.start();
      if (recovery) recoveryRef.current = null;
      setNightBootProgress((value) => Math.max(value, 100));
      if (typeof performance !== "undefined") {
        (window as CinderBootWindow).__CINDER_NIGHT_START_MS = Math.max(
          0,
          performance.now() - nightBootStartedRef.current,
        );
      }
      void beginNightAudio();
      if (endless) {
        setSave((prev) => closeDailyDouble(prev));
      } else {
        setSave((prev) =>
          startActiveRun(
            daily ? closeDailyDouble(markDaily(prev, dailyId)) : closeDailyDouble(prev),
            {
              runId: runTokenRef.current,
              sessionId: sessionRef.current,
              mode: daily ? "daily" : "night",
              nightIndex,
              startedAt: Date.now(),
              active: true,
              dailyId: daily ? dailyId : "",
              // Keep the legacy field name in the save schema so active runs
              // from older versions remain recoverable. It now stores only the
              // server-aligned UTC used by daily goals.
              seasonNow: runClockRef.current,
              ranked: rankedRef.current && !!sessionRef.current,
            },
          ),
        );
      }
    } catch (err) {
      if (!still()) return;
      // Night opening recovers automatically. Never expose chunk/framework error
      // text and never ask the player to press Retry. Keep the same screen and
      // monotonically advance the opening UI while a fresh attempt is scheduled.
      try {
        (window as CinderBootWindow).__CINDER_BOOT_ERROR =
          err instanceof Error ? err.message : String(err ?? "Night startup error");
      } catch {
        /* diagnostics only */
      }
      const staleSession = sessionRef.current;
      sessionRef.current = "";
      rankedRef.current = false;
      setOfflineUnranked(true);
      if (staleSession) {
        const abandon = endlessRef.current
          ? import("@/server/rankings").then(({ abandonEndlessRun }) =>
              abandonEndlessRun({ data: { sessionId: staleSession } }),
            )
          : import("@/server/court").then(({ abandonRun }) =>
              abandonRun({ data: { sessionId: staleSession } }),
            );
        void abandon.catch(() => {});
      }
      nightModulePromise = null;
      const attempt = ++nightBootRetryCountRef.current;
      const delay = Math.min(4000, 300 * 2 ** Math.min(4, attempt - 1));
      setOpening(true);
      setNightBootProgress((value) => Math.max(value, 92));
      setNightBootStage("Reconnecting the night…");
      if (nightBootRetryTimerRef.current) window.clearTimeout(nightBootRetryTimerRef.current);
      nightBootRetryTimerRef.current = window.setTimeout(() => {
        nightBootRetryTimerRef.current = 0;
        if (screenRef.current === "play") setRunId((n) => n + 1);
      }, delay);
    }
  }, [tearDown, postScore]);

  useEffect(() => {
    if (screen !== "play") {
      tearDown();
      return;
    }
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (cancelled) return;
      if (!canvasRef.current) {
        setOpening(true);
        setNightBootStage("Preparing the display…");
        if (nightBootRetryTimerRef.current) window.clearTimeout(nightBootRetryTimerRef.current);
        nightBootRetryTimerRef.current = window.setTimeout(() => {
          nightBootRetryTimerRef.current = 0;
          if (screenRef.current === "play") setRunId((n) => n + 1);
        }, 120);
        return;
      }
      void bootNight();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      tearDown();
    };
  }, [screen, bootNight, tearDown, runId]);

  const leavePlay = (to: Screen = "title") => {
    bootSeq.current += 1;
    if (nightBootRetryTimerRef.current) {
      window.clearTimeout(nightBootRetryTimerRef.current);
      nightBootRetryTimerRef.current = 0;
    }
    nightBootRetryCountRef.current = 0;
    const sid = sessionRef.current;
    clearRunRecovery(runTokenRef.current);
    tearDown();
    setOpening(false);
    setPhase("run");
    setScreen(to);
    setOfflineUnranked(false);
    if (sid) {
      const abandon = endlessRef.current
        ? import("@/server/rankings").then(({ abandonEndlessRun }) =>
            abandonEndlessRun({ data: { sessionId: sid } }),
          )
        : import("@/server/court").then(({ abandonRun }) =>
            abandonRun({ data: { sessionId: sid } }),
          );
      void abandon.catch(() => {
        /* session stays until TTL */
      });
    }
    sessionRef.current = "";
    rankedRef.current = true;
    runCtxRef.current = null;
    setSave((prev) => dismissActiveRun(prev));
  };

  const begin = async (daily = false, endless = false) => {
    clearRunRecovery();
    recoveryRef.current = null;
    // A scored Endless session must be submitted before another online Endless
    // session replaces it. Offline practice is still allowed while disconnected.
    if (endless && typeof navigator !== "undefined" && navigator.onLine !== false) {
      const hasPendingEndless = saveRef.current.unsentSubmits.some((u) => u.mode === "endless");
      if (hasPendingEndless) {
        setSyncNeed(true);
        await flushPendingScoresRef.current();
        if (saveRef.current.unsentSubmits.some((u) => u.mode === "endless")) return;
        setSyncNeed(false);
      }
    }
    if (!endless) {
      const plan = rankedBeginPlan(saveRef.current.unsentSubmits?.length ?? 0);
      if (!plan.start) {
        setSyncNeed(true);
        return;
      }
    }
    setSyncNeed(false);
    trackGameEvent(
      endless ? "begin_endless" : daily ? "begin_daily" : "begin_night",
      endless ? 0 : daily ? 1 : playingNightIndex(saveRef.current.nightsWon),
      saveRef.current.nightsPlayed | 0,
    );
    dailyRef.current = daily;
    endlessRef.current = endless;
    setDailyMode(daily);
    setEndlessMode(endless);
    setOpening(true);
    setPhase("run");
    setScreen("play");
    try {
      wakeAudioFromGesture();
      setMuted(saveRef.current.settings.muted);
      setLevels(saveRef.current.settings.sfx, saveRef.current.settings.music);
    } catch {
      /* audio can wait */
    }
  };

  const pick = (id: CardId) => {
    if (cardPickLockRef.current) return;
    cardPickLockRef.current = true;
    // Remove the rendered deal synchronously. The engine will publish a fresh deal
    // if another pending level exists, so a chosen Evolution cannot visibly linger.
    cardsRef.current = [];
    setCards([]);
    const engine = engineRef.current;
    if (!engine) {
      cardPickLockRef.current = false;
      phaseRef.current = "run";
      setPhase("run");
      setRunId((n) => n + 1);
      return;
    }
    engine.applyPick(id);
    if (engine.pendingLevels <= 0) {
      cardPickLockRef.current = false;
      phaseRef.current = "run";
      setPhase("run");
    }
  };

  const banish = (id: CardId) => {
    engineRef.current?.banish(id);
  };

  const revive = () => {
    if (
      !reviveButtonAllowed({
        daily: dailyRef.current,
        remaining: revivesLeft,
      })
    ) {
      return;
    }
    setRevivesLeft((n) => Math.max(0, n - 1));
    setSave((prev) => clearPendingDefeat(prev));
    engineRef.current?.revive();
    setPhase("run");
    setStats(null);
  };

  const settleLoss = (s: NightStats) => {
    if (paidRef.current) return;
    paidRef.current = true;
    const daily = dailyRef.current;
    const dailyId = dailyIdRef.current || utcDayKey();
    const runId = runTokenRef.current;
    const ranked = rankedRef.current && !!sessionRef.current;
    setSave((prev) => {
      const next = finalizeRun(prev, {
        runId,
        won: false,
        kills: s.kills,
        gold: s.gold,
        time: s.time,
        bossKill: false,
        daily,
        dailyId,
        doubled: false,
        ranked,
        combo: s.combo,
        seasonNow: runClockRef.current || prev.activeRun?.seasonNow,
        orderDay: utcDayKey(trustedNow() || Date.now()),
      });
      if (!ranked || !sessionRef.current) return next;
      return noteUnsent(next, {
        runId,
        sessionId: sessionRef.current,
        score: 0,
        kills: s.kills,
        time: s.time,
        won: false,
        nightIndex: daily ? 1 : nightIndexRef.current || playingNightIndex(prev.nightsWon),
        kind: daily ? "daily" : "night",
        dailyId,
        highestCombo: s.combo,
      });
    });
    postScore(
      { ...s, won: false },
      daily,
      {
        runId,
        sessionId: sessionRef.current,
        dailyId: daily ? dailyId : "",
        mode: daily ? "daily" : "night",
        nightIndex: daily ? 1 : nightIndexRef.current,
      },
      ranked,
    );
  };

  const quitActivePlay = (to: Screen) => {
    const daily = dailyRef.current;
    const endless = endlessRef.current;
    if (endless) {
      const snap = engineRef.current?.snapshot(false) ?? stats;
      if (snap && !paidRef.current) {
        paidRef.current = true;
        const endlessRunId = runTokenRef.current;
        const endlessSessionId = sessionRef.current;
        const rankedEndless = rankedRef.current && !!endlessSessionId;
        setSave((prev) => {
          const next = noteEndlessResult(
            prev,
            snap.time,
            rankedEndless
              ? { runId: endlessRunId, sessionId: endlessSessionId, kills: snap.kills }
              : undefined,
          );
          saveRef.current = next;
          return next;
        });
        if (rankedEndless) {
          void import("@/server/rankings")
            .then(({ submitEndless }) =>
              submitEndless({
                data: {
                  runId: endlessRunId,
                  sessionId: endlessSessionId,
                  time: Math.floor(snap.time),
                  kills: snap.kills,
                },
              }),
            )
            .then(() =>
              setSave((prev) => {
                const next = clearUnsent(prev, endlessRunId);
                saveRef.current = next;
                return next;
              }),
            )
            .catch(() => {
              /* queued locally; reconnect will retry */
            });
        }
      }
    } else if (pauseQuitIsLoss(daily ? "daily" : "night")) {
      const snap = engineRef.current?.snapshot(false) ?? stats;
      if (snap) settleLoss(snap);
      else setSave((prev) => abandonActiveRun(prev));
    } else {
      setSave((prev) => abandonActiveRun(prev));
    }
    setScreen(to);
    setPhase("run");
  };

  const toHub = (recordLoss: boolean) => {
    if (!endlessRef.current && recordLoss && stats) settleLoss(stats);
    setScreen("hub");
    setPhase("run");
  };

  const toTitle = (recordLoss: boolean) => {
    if (!endlessRef.current && recordLoss && stats) settleLoss(stats);
    setScreen("title");
    setPhase("run");
  };

  const replay = () => {
    wakeAudioFromGesture();
    if (!endlessRef.current && phase === "dead" && stats) settleLoss(stats);
    setStats(null);
    setCards([]);
    setHint(true);
    setSynergy(null);
    setPhase("run");
    setOpening(true);
    setRunId((n) => n + 1);
  };

  const goBack = (to: Screen = "title") => setScreen(to);

  const togglePause = useCallback(() => {
    if (phase === "run" || phase === "cards") {
      setLoadoutOpen(false);
      setPlaySettingsOpen(false);
      pausedFromRef.current = pauseFromPhase(phase);
      engineRef.current?.setPaused(true);
      setPhase("paused");
      suspendAudio();
    } else if (phase === "paused") {
      engineRef.current?.setPaused(false);
      setPhase(resumePausedPhase(pausedFromRef.current));
      pausedFromRef.current = null;
      wakeAudioFromGesture();
    }
  }, [phase]);

  const toggleGameSpeed = useCallback(() => {
    const next: 1 | 2 = gameSpeedRef.current === 1 ? 2 : 1;
    gameSpeedRef.current = next;
    setGameSpeed(next);
    engineRef.current?.setGameSpeed(next);
  }, []);

  const openLoadout = useCallback(() => {
    if (phase !== "run") return;
    setPlaySettingsOpen(false);
    pausedFromRef.current = pauseFromPhase(phase);
    engineRef.current?.setPaused(true);
    setLoadoutOpen(true);
    setPhase("paused");
    suspendAudio();
  }, [phase]);

  const closeLoadout = useCallback(() => {
    if (phase !== "paused") {
      setLoadoutOpen(false);
      return;
    }
    setLoadoutOpen(false);
    engineRef.current?.setPaused(false);
    setPhase(resumePausedPhase(pausedFromRef.current));
    pausedFromRef.current = null;
    wakeAudioFromGesture();
  }, [phase]);

  const openPlaySettings = useCallback(() => {
    if (phase !== "run" && phase !== "cards") return;
    setLoadoutOpen(false);
    pausedFromRef.current = pauseFromPhase(phase);
    engineRef.current?.setPaused(true);
    setPlaySettingsOpen(true);
    setPhase("paused");
    // Keep the current ambience audible while the player adjusts volume.
    wakeAudioFromGesture();
  }, [phase]);

  const closePlaySettings = useCallback(() => {
    if (phase !== "paused") {
      setPlaySettingsOpen(false);
      return;
    }
    setPlaySettingsOpen(false);
    engineRef.current?.setPaused(false);
    setPhase(resumePausedPhase(pausedFromRef.current));
    pausedFromRef.current = null;
    wakeAudioFromGesture();
  }, [phase]);

  useEffect(() => {
    trackGameEvent("app_open");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (screen !== "play") return;
      if (e.code === "Escape") {
        e.preventDefault();
        togglePause();
      }
      if (phase === "cards") {
        if (e.code === "Digit1" && cards[0]) pick(cards[0].id);
        if (e.code === "Digit2" && cards[1]) pick(cards[1].id);
        if (e.code === "Digit3" && cards[2]) pick(cards[2].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, phase, cards, togglePause]);

  useEffect(() => {
    if (hud.time > 46) setHint(false);
  }, [hud.time]);

  const curse = curseForDay(dailyId);
  const currentPlayNight = nightIndexRef.current || save.nightsWon + 1;
  const activeArena = dailyMode || endlessMode ? null : campaignArenaFor(currentPlayNight);
  const activeMutations =
    dailyMode || endlessMode ? [] : unlockedCampaignMutations(currentPlayNight);
  const activeTutorial =
    hint && !endlessMode ? tutorialHint(dailyMode, currentPlayNight, hud.time) : null;
  const gameplayOfflineNotice = offlineUnranked
    ? endlessMode
      ? "Offline Endless · ranking unavailable"
      : dailyMode
        ? "Offline Daily · ranking unavailable"
        : "Offline · progress saved locally"
    : null;
  const gameplaySyncRequired = unsentAtCap(save);

  return (
    <main
      id="cinder-app"
      className="relative isolate z-10 h-[var(--app-height,100dvh)] w-full overflow-hidden bg-bg font-sans text-fg"
      data-screen={
        screen === "play"
          ? phase === "paused"
            ? "pause"
            : phase === "cards"
              ? "cards"
              : phase === "won"
                ? dailyMode
                  ? "dailyresult"
                  : "victory"
                : phase === "dead"
                  ? endlessMode
                    ? "endlessresult"
                    : "defeat"
                  : opening
                    ? endlessMode
                      ? "endlessintro"
                      : dailyMode
                        ? "dailyintro"
                        : "gameplay"
                    : "gameplay"
          : screen === "help"
            ? "intro"
            : screen === "power"
              ? "title"
              : screen
      }
    >
      {screen === "title" && (
        <>
          <Title
            save={save}
            curse={curse}
            dailyId={dailyId}
            onBegin={() => begin(false, false)}
            onDaily={() => begin(true, false)}
            onEndless={() => begin(false, true)}
            onHub={() => setScreen("hub")}
            onPower={() => setScreen("power")}
            onSettings={() => setScreen("settings")}
            onCourt={() => {
              trackGameEvent("court_open");
              setScreen("court");
            }}
            onProfile={() => setScreen("profile")}
            onTome={() => setScreen("tome")}
            onDailyBoard={() => setDailyBoardOpen(true)}
            onClaimMissions={() => {
              const claimable = dailyMissionClaimableCrowns(saveRef.current, dailyId);
              if (claimable <= 0) return;
              trackGameEvent(
                "mission_claim",
                claimable,
                dailyMissionsDone(saveRef.current, dailyId),
              );
              setSave((prev) => claimDailyMissionRewards(prev, dailyId));
              sfxBuy();
            }}
          />
          {syncNeed ? (
            <p className="pointer-events-none absolute left-0 right-0 top-[max(7.5rem,calc(env(safe-area-inset-top)+6rem))] z-40 text-center text-sm uppercase tracking-[0.2em] text-ember">
              SYNC REQUIRED
            </p>
          ) : null}
        </>
      )}
      {screen === "hub" && (
        <Hub
          save={save}
          onBack={() => goBack("title")}
          onSelect={(id) => setSave(selectRelic(save, id))}
        />
      )}
      {screen === "power" && (
        <Power save={save} onBack={() => goBack("title")} onChange={setSave} />
      )}
      {screen === "help" && <Help onBack={() => goBack("settings")} />}
      {screen === "tome" && <TomeScreen save={save} onBack={() => goBack("title")} />}
      {screen === "settings" && (
        <Settings
          save={save}
          onBack={() => goBack("title")}
          onChange={setSave}
          onHelp={() => setScreen("help")}
        />
      )}
      {screen === "court" && (
        <Suspense
          fallback={
            <ScreenShell>
              <p className="mt-8 text-sm text-muted">Opening court…</p>
            </ScreenShell>
          }
        >
          <CourtScreen onBack={() => goBack("title")} />
        </Suspense>
      )}
      {screen === "profile" && (
        <Suspense
          fallback={
            <ScreenShell>
              <p className="mt-8 text-sm text-muted">Profile</p>
            </ScreenShell>
          }
        >
          <ProfileScreen
            nightsWon={save.nightsWon}
            name={save.playerName}
            avatar={save.avatar}
            onBack={() => goBack("title")}
            onSave={async (next) => {
              const { saveProfile } = await import("@/server/court");
              const saved = await saveProfile({ data: { name: next.name, avatar: next.avatar } });
              setSave((prev) => patchProfile(prev, { name: saved.name, avatar: saved.avatar }));
            }}
          />
        </Suspense>
      )}
      {dailyBoardOpen ? (
        <div className="absolute inset-0 z-50 bg-bg" data-screen="dailyboard">
          <DailyBoard dailyId={dailyId} onBack={() => setDailyBoardOpen(false)} />
        </div>
      ) : null}
      {screen === "play" && (
        <div className="absolute inset-0">
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 z-0 h-full w-full"
            onContextMenu={(e) => e.preventDefault()}
          />
          {phase !== "won" && phase !== "dead" ? (
            <HudBar
              hud={hud}
              bestEndless={save.endlessBest}
              onPause={togglePause}
              gameSpeed={gameSpeed}
              onToggleSpeed={toggleGameSpeed}
              onLoadout={openLoadout}
              onSettings={openPlaySettings}
              offlineNotice={gameplayOfflineNotice}
              syncRequired={gameplaySyncRequired}
            />
          ) : null}
          {phase === "run" && !opening ? (
            <>
              <OverdriveButton
                hud={hud}
                onCast={() => {
                  wakeAudioFromGesture();
                  engineRef.current?.castOverdrive();
                }}
              />
              <DecreeButton
                hud={hud}
                onCast={() => {
                  wakeAudioFromGesture();
                  engineRef.current?.castDecree();
                }}
              />
            </>
          ) : null}
          {activeTutorial && phase === "run" ? (
            <div className="pointer-events-none absolute bottom-[max(6.5rem,calc(env(safe-area-inset-bottom)+5.25rem))] left-4 right-4 z-20 mx-auto max-w-sm rounded-xl border border-gold/20 bg-bg/78 px-3 py-2 text-center text-xs leading-relaxed text-gold-2 shadow-[0_8px_24px_rgba(0,0,0,0.22)]">
              {activeTutorial}
            </div>
          ) : null}
          {synergy && (
            <div className="pointer-events-none absolute left-4 right-4 top-[42%] z-20 mx-auto max-w-sm -translate-y-1/2 rounded-2xl border border-gold/60 bg-bg/88 px-5 py-5 text-center shadow-[0_0_45px_rgba(196,165,116,0.18)]">
              <p className="text-[11px] uppercase tracking-[0.3em] text-gold">Crown evolution</p>
              <p className="mt-1 font-display text-5xl leading-none text-gold-2">{synergy}</p>
              <p className="mt-2 text-xs uppercase tracking-[0.18em] text-muted">
                The court transforms
              </p>
            </div>
          )}
          {opening && (
            <Scrim>
              <p className="text-xs uppercase tracking-[0.22em] text-gold">
                {endlessMode
                  ? "∞ Endless Ranking"
                  : dailyMode
                    ? "Daily Trial"
                    : `Night ${nightIndexRef.current || save.nightsWon + 1}`}
              </p>
              <h2 className="font-display text-4xl">Opening the court…</h2>
              <p className="max-w-xs text-sm text-muted">
                {endlessMode
                  ? "Equal starting power. No rewards, no revives, no time limit. Survive as long as you can for the ranking."
                  : dailyMode
                    ? "Preparing today’s standardized trial. Daily ranking requires an online session."
                    : "Preparing the Night. If the network is unavailable, Campaign progress is saved locally; Court rankings stay online-only."}
              </p>
              {!dailyMode && !endlessMode && activeArena ? (
                <div className="max-w-xs rounded-xl border border-gold/20 bg-surface/70 px-3 py-2 text-xs text-muted">
                  <p className="text-gold-2">
                    {activeArena.milestone ? "Ascendant arena" : "Arena"} · {activeArena.title}
                  </p>
                  {activeMutations.length > 0 ? (
                    <p className="mt-1">
                      Mutations · {activeMutations.map(campaignMutationLabel).join(" · ")}
                    </p>
                  ) : (
                    <p className="mt-1">No enemy mutations yet.</p>
                  )}
                </div>
              ) : null}
              <div
                className="w-44"
                role="progressbar"
                aria-label="Opening night"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={nightBootProgress}
              >
                <div className="h-1.5 overflow-hidden rounded-full border border-gold/20 bg-line/80">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#78351f] via-[#c47a36] to-[#ead29a] shadow-[0_0_12px_rgba(226,189,115,0.3)] transition-[width] duration-200"
                    style={{ width: `${Math.max(4, nightBootProgress)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em]">
                  <span className="text-muted">{nightBootStage}</span>
                  <span className="tabular-nums text-gold-2">{nightBootProgress}%</span>
                </div>
              </div>
              <GhostBtn onClick={() => leavePlay("title")}>Cancel</GhostBtn>
            </Scrim>
          )}
          {phase === "cards" && cards.length > 0 && (
            <CardPick
              cards={cards}
              hud={hud}
              stats={engineRef.current?.stats ?? null}
              banishes={engineRef.current?.banishesLeft ?? 0}
              onPick={pick}
              onBanish={banish}
            />
          )}
          {phase === "paused" && loadoutOpen && engineRef.current?.stats ? (
            <LoadoutPanel stats={engineRef.current.stats} hud={hud} onClose={closeLoadout} />
          ) : null}
          {phase === "paused" && playSettingsOpen ? (
            <InGameSettingsPanel save={save} onChange={setSave} onClose={closePlaySettings} />
          ) : null}
          {phase === "paused" && !loadoutOpen && !playSettingsOpen && (
            <Scrim>
              <h2 className="font-display text-4xl">Paused</h2>
              <SolidBtn onClick={togglePause}>Resume</SolidBtn>
              <GhostBtn onClick={() => quitActivePlay("hub")}>Vault</GhostBtn>
              <GhostBtn onClick={() => quitActivePlay("title")}>Title</GhostBtn>
            </Scrim>
          )}
          {phase === "dead" && stats && endlessMode && (
            <Scrim variant="defeat">
              <ResultSigil variant="defeat" />
              <p className="cn-result-kicker text-xs uppercase tracking-[0.22em] text-gold">
                Endless ranking
              </p>
              <h2 className="cn-result-title font-display text-5xl">The court finally fell</h2>
              <div className="w-full max-w-[19rem] rounded-xl border border-gold/25 bg-surface/80 px-4 py-4 text-center">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Survived</p>
                <p className="mt-1 font-display text-5xl tabular-nums text-gold-2">
                  {formatEndlessTime(stats.time)}
                </p>
                <p className="mt-2 text-sm text-muted">
                  {stats.kills} fallen · Best{" "}
                  {formatEndlessTime(Math.max(save.endlessBest, Math.floor(stats.time)))}
                </p>
                <p className="mt-2 text-xs text-muted">
                  No crowns · no mission progress · ranking only
                </p>
              </div>
              <SolidBtn onClick={replay}>Retry Endless</SolidBtn>
              <GhostBtn onClick={() => setScreen("court")}>Rankings</GhostBtn>
              <GhostBtn onClick={() => toTitle(false)}>Title</GhostBtn>
            </Scrim>
          )}
          {phase === "dead" && stats && !endlessMode && (
            <Scrim variant="defeat">
              <ResultSigil variant="defeat" />
              <p className="cn-result-kicker text-xs uppercase tracking-[0.22em] text-ember">
                Ashes claim the court
              </p>
              <h2 className="cn-result-title font-display text-5xl">The crown has fallen</h2>
              <NightReport
                stats={stats}
                payout={
                  dailyMode
                    ? nightCrowns(save, stats.gold, { daily: true })
                    : campaignResultCrowns(save, stats.gold, false)
                }
                night={save.nightsWon + 1}
                bestNight={save.nightsWon}
                unlock={nextUnlock(save.nightsWon)}
                score={runScore}
                place={courtPlace}
                daily={dailyMode}
              />
              {!dailyMode ? (
                <p className="max-w-[18rem] text-center text-xs text-gold-2">
                  Defeat reward · all collected crowns kept · Night {save.nightsWon + 1} repeats
                </p>
              ) : null}
              <RunProgressLine save={save} day={dailyId} campaign={!dailyMode} />
              <NextGoalLine save={save} />
              <SolidBtn onClick={replay}>Retry</SolidBtn>
              {reviveButtonAllowed({
                daily: dailyMode,
                remaining: revivesLeft,
              }) ? (
                <GhostBtn onClick={revive}>Revive</GhostBtn>
              ) : null}
              <GhostBtn onClick={() => toHub(true)}>Vault</GhostBtn>
              <GhostBtn onClick={() => toTitle(true)}>Title</GhostBtn>
              <p className="max-w-[16rem] text-center text-xs text-muted">
                {revivesLeft > 0
                  ? `${revivesLeft} revive${revivesLeft === 1 ? "" : "s"} left this night.`
                  : "No revives left. Retry the night."}
              </p>
            </Scrim>
          )}
          {phase === "won" && stats && (
            <Scrim variant="victory">
              <ResultSigil variant="victory" />
              <p className="cn-result-kicker text-xs uppercase tracking-[0.22em] text-gold">
                {!dailyMode && isMajorMilestone(save.nightsWon)
                  ? "Ascendant milestone"
                  : "Dawn breaks"}
              </p>
              <h2 className="cn-result-title font-display text-5xl">
                {!dailyMode && isMajorMilestone(save.nightsWon)
                  ? `Night ${save.nightsWon} conquered`
                  : "The court holds"}
              </h2>
              <NightReport
                stats={stats}
                payout={nightCrowns(save, stats.gold, { daily: dailyMode })}
                night={save.nightsWon}
                bestNight={save.nightsWon}
                score={runScore}
                place={courtPlace}
                daily={dailyMode}
              />
              {!dailyMode ? <ProgressRewardLine night={save.nightsWon} /> : null}
              <RunProgressLine save={save} day={dailyId} campaign={!dailyMode} />
              <NextGoalLine save={save} />
              <SolidBtn onClick={replay} id="next-night">
                {dailyMode ? "Retry curse" : "Next night"}
              </SolidBtn>
              <GhostBtn onClick={() => toHub(false)}>Vault</GhostBtn>
              <GhostBtn onClick={() => toTitle(false)}>Title</GhostBtn>
            </Scrim>
          )}
        </div>
      )}
    </main>
  );
}

function BackBtn({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button
      {...pressProps(onClick)}
      aria-label="Back"
      className="pointer-events-auto relative z-30 inline-flex h-12 min-h-12 shrink-0 min-w-[6rem] items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm text-fg"
    >
      ← {label}
    </button>
  );
}

function ScreenShell({ children }: { children: ReactNode }) {
  return (
    <section className="scroll-y relative z-20 flex h-full flex-col overflow-y-auto bg-bg px-6 cn-screen">
      {children}
    </section>
  );
}

function CourtArt({ paused = false }: { paused?: boolean }) {
  return (
    <div
      className={`cn-court-art pointer-events-none absolute inset-0 z-0 ${paused ? "cn-court-art-paused" : ""}`}
      aria-hidden="true"
    >
      <div className="cn-court-stage">
        <img
          src={COURT_ART_SRC}
          alt=""
          width={1500}
          height={2666}
          decoding="async"
          loading="eager"
          fetchPriority="high"
          draggable={false}
          className="cinder-menu-art cn-court-art-img"
        />
        <div className="cn-fx cn-fx-halo" />
        <div className="cn-fx cn-fx-beam" />
        <div className="cn-fx cn-fx-aura" />
        <div className="cn-fx cn-fx-crown" />
        <div className="cn-fx cn-fx-eye cn-fx-eye-l" />
        <div className="cn-fx cn-fx-eye cn-fx-eye-r" />
        <div className="cn-fx cn-fx-staff" />
        <div className="cn-fx cn-fx-fire cn-fx-fire-l" />
        <div className="cn-fx cn-fx-fire cn-fx-fire-r" />
        <div className="cn-fx cn-fx-fire cn-fx-fire-ml" />
        <div className="cn-fx cn-fx-fire cn-fx-fire-mr" />
        <div className="cn-fx cn-fx-smoke cn-fx-smoke-a" />
        <div className="cn-fx cn-fx-smoke cn-fx-smoke-b" />
        <div className="cn-court-embers">
          {Array.from({ length: 18 }, (_, i) => (
            <span
              key={i}
              className={`cn-court-ember cn-court-ember-${i % 3}`}
              style={{
                animationDelay: `${(i * 0.53) % 7.4}s`,
                left: `${7 + ((i * 11) % 86)}%`,
                animationDuration: `${6.4 + (i % 5) * 0.7}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DailyMissionsCard({
  save,
  day,
  onClaim,
}: {
  save: SaveData;
  day: string;
  onClaim: () => void;
}) {
  const missions = dailyMissionsFor(day);
  const claimable = dailyMissionClaimableCrowns(save, day);
  const done = dailyMissionsDone(save, day);
  const claimed = new Set(save.dailyMissionDay === day ? save.dailyMissionClaimed : []);
  return (
    <section className="mt-3 rounded-xl border border-gold/30 bg-surface/85 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-gold">Daily Missions</p>
          <p className="mt-0.5 text-xs text-muted">
            10 goals · new mix every UTC day · Endless never counts.
          </p>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-gold-2">{done}/10</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {missions.map((mission) => {
          const progress = dailyMissionProgress(save, day, mission);
          const complete = progress >= mission.target;
          const paid = claimed.has(mission.id);
          return (
            <li key={mission.id} className="rounded-lg border border-line/70 bg-bg/35 px-2.5 py-2">
              <div className="flex items-start gap-2 text-xs">
                <span
                  className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${complete ? "border-gold bg-gold text-bg" : "border-line text-muted"}`}
                  aria-hidden="true"
                >
                  {complete ? "✓" : ""}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={paid ? "text-fg/55" : complete ? "text-fg/75" : "text-fg"}>
                    {mission.title}
                  </span>
                  <span className="text-muted"> · +{mission.crowns}</span>
                  <span className="mt-0.5 block text-[10px] tabular-nums text-muted">
                    {Math.min(progress, mission.target)} / {mission.target}
                    {paid ? " · claimed" : ""}
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-gold"
                  style={{
                    width: `${Math.max(0, Math.min(1, progress / Math.max(1, mission.target))) * 100}%`,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {claimable > 0 ? (
        <button
          {...tapProps(onClaim)}
          className="pointer-events-auto mt-3 h-11 w-full rounded-lg bg-gold text-xs font-medium text-bg"
        >
          Claim {claimable} crowns
        </button>
      ) : done === 10 ? (
        <p className="mt-2 text-center text-xs text-muted">All daily missions complete.</p>
      ) : null}
    </section>
  );
}

function RunProgressLine({
  save,
  day,
  campaign,
}: {
  save: SaveData;
  day: string;
  campaign: boolean;
}) {
  const done = dailyMissionsDone(save, day);
  const claimable = dailyMissionClaimableCrowns(save, day);
  return (
    <div className="w-full max-w-[19rem] rounded-xl border border-line/80 bg-surface/65 px-3 py-2.5 text-xs">
      {campaign ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">Campaign streak</span>
          <span className="tabular-nums text-gold-2">
            {save.campaignStreak} current · {save.bestCampaignStreak} best
          </span>
        </div>
      ) : null}
      <div className={`flex items-center justify-between gap-3 ${campaign ? "mt-1.5" : ""}`}>
        <span className="text-muted">Daily Missions</span>
        <span className="tabular-nums text-gold-2">
          {done}/10{claimable > 0 ? ` · ${claimable} crowns ready` : ""}
        </span>
      </div>
    </div>
  );
}

function MilestoneProgressLine({ nightsWon }: { nightsWon: number }) {
  const m = milestoneProgress(nightsWon);
  const pct = Math.max(0, Math.min(100, m.progress * 100));
  const gift = nextAscendantGift(nightsWon);
  return (
    <div className="mt-3 w-full max-w-[17.5rem] rounded-xl border border-gold/20 bg-bg/48 px-3 py-2.5 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em]">
        <span className="text-gold-2">Ascendant milestone {m.next}</span>
        <span className="tabular-nums text-muted">
          {m.into} / {m.span}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/80">
        <div
          className="h-full bg-gold transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[10px] text-gold-2">
        Next gift · {gift.title} · Tier {gift.tier}
      </p>
      {m.legacyRank > 0 ? (
        <p className="mt-1 text-[10px] text-muted">
          Ash Legacy {m.legacyRank} · permanent court power
        </p>
      ) : null}
    </div>
  );
}

function ProgressRewardLine({ night }: { night: number }) {
  const reward = progressRewardForNight(night);
  if (!reward) return null;
  const major = reward.kind === "milestone";
  const rank = major ? legacyRankFor(night) : 0;
  const gift = major ? ascendantGiftForMilestone(night) : null;
  const rewardLabel = major
    ? "milestone reward"
    : reward.kind === "court"
      ? "court reward"
      : reward.kind === "path"
        ? "path reward"
        : "night clear";
  return (
    <div
      className={`w-full max-w-[19rem] rounded-xl border px-3 py-3 text-center ${major ? "border-gold/55 bg-gold/10" : "border-gold/25 bg-surface/75"}`}
    >
      <p className="text-[10px] uppercase tracking-[0.2em] text-gold">
        {major ? `Milestone ${night} held` : reward.title}
      </p>
      <p className="mt-1 text-sm text-gold-2">
        +{reward.crowns} crowns · {rewardLabel}
      </p>
      {gift ? (
        <p className="mt-2 text-sm font-medium text-gold">
          Unlocked · {gift.title} · Tier {gift.tier}
        </p>
      ) : null}
      {gift ? <p className="mt-1 text-xs text-muted">{gift.blurb}</p> : null}
      {major ? (
        <p className="mt-1.5 text-[11px] text-muted">
          Ash Legacy {rank} also strengthens life, damage and soul gain.
        </p>
      ) : null}
    </div>
  );
}

function NextGoalLine({ save }: { save: SaveData }) {
  const day = utcDayKey(trustedNow() || Date.now());
  const claimable = dailyMissionClaimableCrowns(save, day);
  if (claimable > 0) {
    return (
      <p className="max-w-[18rem] text-center text-xs text-gold-2">
        Daily Missions · {claimable} crowns ready
      </p>
    );
  }
  const mission = dailyMissionsFor(day).find((m) => dailyMissionProgress(save, day, m) < m.target);
  if (mission) {
    const progress = dailyMissionProgress(save, day, mission);
    return (
      <p className="max-w-[18rem] text-center text-xs text-gold-2">
        Daily · {mission.title} · {progress}/{mission.target}
      </p>
    );
  }
  const unlock = nextUnlock(save.nightsWon);
  if (unlock) {
    return (
      <p className="max-w-[18rem] text-center text-xs text-gold-2">
        Next unlock · {unlock.title} · Night {unlock.night}
      </p>
    );
  }
  return (
    <p className="max-w-[18rem] text-center text-xs text-muted">
      All Daily Missions complete today.
    </p>
  );
}

function Title({
  save,
  curse,
  dailyId,
  onBegin,
  onDaily,
  onEndless,
  onHub,
  onPower,
  onSettings,
  onCourt,
  onProfile,
  onTome,
  onDailyBoard,
  onClaimMissions,
}: {
  save: SaveData;
  curse: CurseDef;
  dailyId: string;
  onBegin: () => void;
  onDaily: () => void;
  onEndless: () => void;
  onHub: () => void;
  onPower: () => void;
  onSettings: () => void;
  onCourt: () => void;
  onProfile: () => void;
  onTome: () => void;
  onDailyBoard: () => void;
  onClaimMissions: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [scenePaused, setScenePaused] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  useEffect(() => {
    const onVisibility = () => setScenePaused(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility, { passive: true });
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const night = playingNightIndex(save.nightsWon);
  const played = Math.max(save.nightsPlayed || 0, save.nightsWon);
  const firstRun = played === 0;
  const tomeOpen = save.nightsWon >= 2 || played >= 3;
  return (
    <section className="absolute inset-0 isolate flex flex-col overflow-hidden bg-bg">
      <div
        className="cinder-title-bg pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
      />
      <CourtArt paused={scenePaused} />
      <div className="cn-safe-x cn-title-safe-top relative z-30 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="pointer-events-auto relative z-30 flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {!firstRun ? (
              <button
                {...pressProps(onCourt)}
                className="pointer-events-auto relative z-30 grid size-11 min-h-11 min-w-11 place-items-center rounded-xl border border-gold/30 bg-surface/85 text-gold-2"
                aria-label="Court League"
              >
                <Trophy className="size-4" strokeWidth={1.8} />
              </button>
            ) : null}
            <button
              {...pressProps(onSettings)}
              className="pointer-events-auto relative z-30 grid size-11 min-h-11 min-w-11 place-items-center rounded-xl border border-gold/30 bg-surface/85 text-gold-2"
              aria-label="Options"
            >
              <Settings2 className="size-4" strokeWidth={1.8} />
            </button>
          </div>
          {!firstRun && !moreOpen ? (
            <button
              {...pressProps(() => setMoreOpen(true))}
              className="pointer-events-auto relative z-40 flex h-11 min-h-11 items-center gap-2 rounded-xl border border-gold/40 bg-surface/92 px-3.5 text-gold-2 shadow-[0_0_24px_rgba(196,165,116,0.16)]"
              aria-label="Court menu"
            >
              <Crown className="size-4" strokeWidth={1.8} />
              <span className="text-[11px] uppercase tracking-[0.16em]">Court</span>
            </button>
          ) : null}
        </div>
        <div className="mt-1 flex max-w-[17.5rem] flex-col">
          <p className="text-[11px] uppercase tracking-[0.3em] text-gold drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
            Build your court
          </p>
          <h1 className="mt-2 font-display text-[2.7rem] leading-[0.86] tracking-[-0.025em] text-fg min-[400px]:text-[3.05rem] [@media(max-height:920px)]:text-[2.45rem] drop-shadow-[0_4px_18px_rgba(0,0,0,0.8)]">
            Cinder Night
          </h1>
          <div className="mt-3 flex w-fit items-center rounded-full border border-gold/20 bg-bg/55 px-3 py-1.5 backdrop-blur-sm">
            <span className="text-[11px] uppercase tracking-[0.16em] text-gold-2">
              Night {night} awaits
            </span>
          </div>
          {!firstRun ? (
            <>
              <p className="mt-2 text-xs text-muted">
                {save.nightsWon} held · streak {save.campaignStreak} · {save.crowns} crowns
              </p>
            </>
          ) : (
            <p className="mt-2 max-w-[16rem] text-xs leading-relaxed text-muted">
              Hold the court until dawn. Your first victory opens more of the Court.
            </p>
          )}
          {unsentAtCap(save) ? (
            <p className="mt-3 text-xs uppercase tracking-[0.2em] text-gold-2">
              SYNC REQUIRED · Court scores waiting
            </p>
          ) : null}
        </div>
      </div>
      {!firstRun ? (
        <div className="cn-safe-x pointer-events-none absolute bottom-[11.5rem] left-0 z-30 w-full [@media(max-height:820px)]:bottom-[10.5rem]">
          <MilestoneProgressLine nightsWon={save.nightsWon} />
        </div>
      ) : null}
      <div className="cn-safe-x pointer-events-auto relative z-40 shrink-0 bg-gradient-to-t from-bg via-bg/88 to-transparent pt-8 pb-[max(1.75rem,calc(env(safe-area-inset-bottom)+0.85rem))] [@media(max-height:920px)]:pt-6">
        <div className="flex flex-col gap-2 [@media(max-height:920px)]:gap-1.5">
          <SolidBtn onClick={onBegin} id="begin-night">
            Begin Night {night}
          </SolidBtn>
          {!firstRun ? <GhostBtn onClick={onEndless}>∞ Endless</GhostBtn> : null}
        </div>
      </div>
      {!firstRun && moreOpen ? (
        <div className="absolute inset-0 z-50">
          <button
            {...pressProps(() => setMoreOpen(false))}
            className="pointer-events-auto absolute inset-0 bg-bg/55"
            aria-label="Close Court menu"
          />
          <aside className="pointer-events-auto absolute inset-y-0 right-0 flex w-[min(20.5rem,88%)] flex-col border-l border-gold/35 bg-bg/96 pt-[max(1rem,env(safe-area-inset-top))] shadow-[-18px_0_40px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between gap-3 px-4 pb-2">
              <p className="text-xs uppercase tracking-[0.2em] text-gold">Court</p>
              <button
                {...pressProps(() => setMoreOpen(false))}
                className="pointer-events-auto grid size-11 min-h-11 min-w-11 place-items-center rounded-xl border border-gold/30 bg-surface text-gold-2"
                aria-label="Close"
              >
                <X className="size-4" strokeWidth={1.8} />
              </button>
            </div>
            <div className="scroll-y min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <button
                {...pressProps(onProfile)}
                className="pointer-events-auto mb-3 flex w-full items-center gap-2 rounded-full border border-line bg-surface/80 py-1.5 pl-1.5 pr-3 text-left"
                aria-label="Profile"
              >
                <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2">
                  <Face avatar={save.avatar} size={32} />
                </span>
                <span className="text-xs tabular-nums text-muted">
                  {save.nightsWon} nights · streak {save.campaignStreak} · {save.crowns}
                </span>
              </button>
              <DailyCard
                curse={curse}
                dailyId={dailyId}
                relic={dailyRelicFor(dailyId)}
                best={save.dailyBestOn === dailyId ? save.dailyBest : 0}
                played={dailyMainClaimed(save, dailyId)}
                onPlay={onDaily}
                onBoard={onDailyBoard}
              />
              <DailyMissionsCard save={save} day={dailyId} onClaim={onClaimMissions} />
              <button
                {...tapProps(onEndless)}
                className="pointer-events-auto mt-3 w-full rounded-xl border border-gold/45 bg-gold/10 px-3 py-3 text-left"
              >
                <span className="block text-xs uppercase tracking-[0.18em] text-gold">
                  ∞ Endless Ranking
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted">
                  Equal starting power · no rewards · no revives · survive as long as possible.
                </span>
                {save.endlessBest > 0 ? (
                  <span className="mt-1 block text-xs tabular-nums text-gold-2">
                    Your local best · {formatEndlessTime(save.endlessBest)}
                  </span>
                ) : null}
              </button>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <SolidGold onClick={onPower}>Upgrades</SolidGold>
                <GhostBtn onClick={onHub}>Vault</GhostBtn>
                <GhostBtn onClick={onTome} disabled={!tomeOpen}>
                  {tomeOpen ? "Tome" : "Tome · after Night 2"}
                </GhostBtn>
                <GhostBtn onClick={() => setMoreOpen(false)}>Close</GhostBtn>
              </div>
              <p className="mt-3 text-center text-[11px] leading-relaxed text-muted">
                The Tome opens after Night 2.
              </p>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function Hub({
  save,
  onBack,
  onSelect,
}: {
  save: SaveData;
  onBack: () => void;
  onSelect: (id: RelicId) => void;
}) {
  return (
    <ScreenShell>
      <div className="flex items-center justify-between gap-3">
        <BackBtn onClick={onBack} />
        <span className="text-xs uppercase tracking-[0.16em] text-gold">Campaign record</span>
      </div>
      <h2 className="mt-5 font-display text-4xl">Vault</h2>
      <p className="mt-2 text-sm text-muted">
        Your campaign record and starting relic. Daily Trials use their own daily relic.
      </p>
      <City lights={save.lights} />
      <dl className="mt-5 grid grid-cols-2 gap-2">
        <Stat label="Nights won" value={String(save.nightsWon)} />
        <Stat label="Nights played" value={String(save.nightsPlayed || save.nightsWon)} />
        <Stat label="Current streak" value={String(save.campaignStreak)} />
        <Stat label="Best streak" value={String(save.bestCampaignStreak)} />
        <Stat
          label="Endless best"
          value={save.endlessBest > 0 ? formatEndlessTime(save.endlessBest) : "—"}
        />
        <Stat label="Endless runs" value={String(save.endlessRuns)} />
        <Stat label="Enemies" value={String(save.totalKills)} />
        <Stat label="Crowns" value={String(save.crowns)} />
        <Stat label="Best score" value={String(save.bestScore)} />
        <Stat label="Highest combo" value={String(save.highestCombo)} />
        <Stat label="Highest night" value={String(save.highestNight || save.nightsWon)} />
        <Stat label="Boss kills" value={String(save.bossKills)} />
        <Stat
          label="Campaign this week"
          value={String(save.weekKey === isoWeekKey() ? save.weekNights : 0)}
        />
      </dl>
      <p className="mt-3 text-sm text-muted">Playing since {fmtSince(save.startedAt)}</p>
      <div className="mt-6 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-gold">Campaign start relic</p>
          <p className="mt-1 text-sm text-muted">Used when you begin a normal night.</p>
        </div>
        <span className="shrink-0 text-xs text-gold-2">
          {RELICS[save.selected]?.title ?? "Relic"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {save.unlocked.map((id) => (
          <button
            key={id}
            {...tapProps(() => onSelect(id))}
            className={`pointer-events-auto relative z-30 rounded-xl border px-3 py-3 text-left ${
              save.selected === id ? "border-gold bg-surface-2" : "border-line bg-surface"
            }`}
            aria-pressed={save.selected === id}
          >
            <span className="block font-display text-lg leading-none">{RELICS[id].title}</span>
            <span className="mt-1 block text-xs text-muted">{RELICS[id].blurb}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">
        Return to the title to start the next night. Daily Trial progress and relics stay separate
        from Campaign.
      </p>
    </ScreenShell>
  );
}

const POWER_ICON = {
  "meta-steel": Swords,
  "meta-hide": Shield,
  "meta-vita": Heart,
  "meta-crit": Sparkles,
  "meta-haste": Waves,
  "meta-fortune": Crown,
} as const;

function Power({
  save,
  onBack,
  onChange,
}: {
  save: SaveData;
  onBack: () => void;
  onChange: (s: SaveData | ((prev: SaveData) => SaveData)) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const rows = POWER_IDS.map((id) => UPGRADES.find((it) => it.id === id)).filter(
    (it): it is UpgradeItem => !!it,
  );

  const buy = (item: UpgradeItem) => {
    const next = buyUpgradeItem(saveRef.current, item);
    if (typeof next === "string") {
      setNote(next);
      return;
    }
    saveRef.current = next;
    onChange(next);
    sfxBuy();
    setNote(`${item.title} · rank ${metaLevel(next, item)}`);
  };

  return (
    <ScreenShell>
      <div className="flex items-center justify-between gap-3">
        <BackBtn onClick={onBack} />
        <span className="font-display text-xl tabular-nums text-gold-2">{save.crowns}</span>
      </div>
      <h2 className="mt-6 font-display text-4xl">Upgrades</h2>
      <p className="mt-2 text-sm text-muted">
        Six permanent upgrades. Unlimited ranks, paid only with Crowns. Every rank still improves
        the stat, while gains taper gradually at very high levels.
      </p>
      {note ? <p className="mt-3 text-sm text-gold-2">{note}</p> : null}
      <ul className="mt-6 space-y-3">
        {rows.map((item) => {
          const Icon = POWER_ICON[item.id as keyof typeof POWER_ICON] ?? Swords;
          const level = metaLevel(save, item);
          const cost = crownCost(item, level);
          const now = item.meta ? powerNow(save.meta, item.meta) : "";
          return (
            <li key={item.id} className="rounded-xl border border-line bg-surface px-4 py-4">
              <div className="flex items-start gap-3">
                <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-surface-2 text-gold-2">
                  <Icon className="size-5" strokeWidth={1.7} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-display text-2xl leading-none">{item.title}</h3>
                    <span className="text-[11px] tabular-nums text-gold-2">{`Rank ${level}`}</span>
                  </div>
                  <p className="mt-2 text-sm text-fg/90">{now}</p>
                  <p className="mt-1 text-sm text-muted">{item.gets}</p>
                  <div className="mt-3">
                    <button
                      {...tapProps(() => buy(item))}
                      className="pointer-events-auto relative z-30 h-11 rounded-lg bg-fg px-4 text-sm font-medium text-bg"
                    >
                      Upgrade to Rank {level + 1} · {cost ?? 0} crowns
                    </button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </ScreenShell>
  );
}

function City({ lights }: { lights: number }) {
  const windows = [
    [38, 62],
    [52, 58],
    [66, 64],
    [28, 74],
    [44, 78],
    [60, 72],
    [74, 80],
    [34, 90],
    [50, 88],
    [68, 92],
    [42, 102],
    [58, 106],
  ] as const;
  return (
    <svg viewBox="0 0 100 130" className="mx-auto mt-8 h-52 w-full max-w-xs text-gold" aria-hidden>
      <path
        d="M8 122 L18 70 L28 78 L40 42 L50 54 L62 30 L74 58 L82 50 L92 122 Z"
        fill="#14110e"
        stroke="currentColor"
        strokeWidth="0.6"
        opacity="0.9"
      />
      {windows.map(([x, y], i) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="4.2"
          height="6"
          rx="0.4"
          className={i < lights ? "window-lit" : undefined}
          fill={i < lights ? "#e8d5a8" : "#2a241c"}
          opacity={i < lights ? 0.95 : 0.7}
        />
      ))}
      <circle cx="62" cy="30" r="2.2" fill={lights >= 6 ? "#e8d5a8" : "#2a241c"} />
    </svg>
  );
}

function Help({ onBack }: { onBack: () => void }) {
  return (
    <ScreenShell>
      <BackBtn onClick={onBack} />
      <h2 className="mt-6 font-display text-4xl">How to play</h2>
      <ol className="mt-8 space-y-5 text-sm leading-relaxed text-fg/90">
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">You</span>
          You stay in the middle. You do not move or aim. Enemies come to you.
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">King's Decree</span>
          Tap Decree when it is ready. The crown sends out one royal shockwave, damages nearby foes
          and pushes normal enemies back. Then it recharges.
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">Court</span>
          Six pads sit around the king. The six tower types are Ballista, Laser Tower, Fire Tower,
          Heir Tower, Cannon Tower and Heal Tower. Each type takes one pad; repeated picks upgrade
          that same tower to Lv 5. You never place anything by hand.
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">Cards</span>
          When you level up, pick one card. Cards say what role they fill. If a card advances an
          Evolution, it also shows the recipe progress such as 1/2 or READY. Shots are your basic
          attack; Fireball, Lightning, Fire Ring and Tornado recharge automatically and show their
          status in the HUD.
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">Gold line</span>
          Combat only happens inside the gold line. Enemies, pets and towers are kept inside the
          active court.
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">Pets</span>
          Hound roams the Court and runs wherever enemies appear. Ash Lynx is a much faster outer
          patrol assassin; several Lynxes split their targets when possible. Hawk performs aerial
          attack runs with target-locked shots and can only be hurt by ranged attacks. Guards patrol
          around the King and intercept enemies that get close. Towers hold their pads
          automatically.
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">Evolutions</span>
          Gold cards appear when the recipe is ready. Take one. The night changes. You can hold more
          than one.
          <EvoHelpList />
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">
            Daily & Court League
          </span>
          Daily Trials last five minutes and use equal power for everyone. A mass horde arrives at
          2:30, then the Lord arrives at 5:00; the Trial ends only when that Lord is dead. Your
          first Daily win each UTC day counts toward the weekly Court League. Replays can improve
          the Daily Board, but they do not add another league clear.
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">
            Daily Missions
          </span>
          After your first run, 10 rotating daily goals appear in the Court menu. They use existing
          play — wins, evolutions and the Night Lord — and pay crowns when you claim them. No extra
          currency.
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">
            Enemy mutations
          </span>
          Later Campaign Nights add Armored, Frenzied, Shielded and Volatile foes. Their armor, glow
          or ring tells you what changed. The Court Tome keeps short notes on enemies you have
          reached. These Campaign mutations stay out of Endless Ranking so survival scores remain
          easier to compare.
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">
            Campaign record
          </span>
          A Campaign defeat keeps all crowns collected in that run, but the Night does not advance.
          Your current win streak resets; your best streak stays on your record.
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">
            ∞ Endless Ranking
          </span>
          Everyone starts with the same sickle and no Meta, Legacy or Ascendant power. There are no
          rewards, missions or revives and no round timer. A generated Lord arrives every five
          minutes; the arrival point fixes its identity, so equal runs face the same boss. Ranking
          is survival time first, then kills.
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">Souls</span>
          Teal lights are XP. They fly to you. Fill the XP bar to level up.
        </li>
        <li>
          <span className="block text-xs uppercase tracking-[0.18em] text-gold">Nights</span>
          Every Night reaches its Lord at 4:59 and the phase clock waits while that boss lives.
          Every fifth Night continues into a harder second half, then a stronger second Lord arrives
          at 9:59. After the final Lord falls, the court remains active for five more seconds before
          dawn. Each Lord is procedurally generated from its Night and encounter slot: appearance,
          size, powers, strength and attack mix are different, but the seed is fixed so every player
          faces the same boss on the same Night and retries cannot reroll it. A mass horde must be
          cleared at 2:30; ten-minute Nights add another at 7:30. Every 50th Night is instead a
          five-minute boss-only gauntlet with three Lords active at once and does not use these
          hordes.
        </li>
      </ol>
      <p className="mt-auto pt-8 text-xs leading-relaxed text-muted">
        Build your court. Survive the night. Keep the crown.
      </p>
    </ScreenShell>
  );
}

function InGameSettingsPanel({
  save,
  onChange,
  onClose,
}: {
  save: SaveData;
  onChange: (s: SaveData) => void;
  onClose: () => void;
}) {
  const toggle = (key: "shake" | "muted" | "vibrate" | "reducedFx") => {
    onChange(patchSettings(save, { [key]: !save.settings[key] }));
  };
  return (
    <div className="absolute inset-0 z-50 overflow-y-auto overscroll-y-contain bg-bg/96 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] touch-pan-y">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-gold/25 bg-bg/96 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gold">Night paused</p>
            <h2 className="font-display text-3xl">Settings</h2>
          </div>
          <button
            {...instantProps(onClose)}
            className="grid size-11 place-items-center rounded-xl border border-line bg-surface text-gold-2"
            aria-label="Close settings and resume"
          >
            <X className="size-4" strokeWidth={1.8} />
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Audio changes are live, so you can set the mix during a run. Your phone hardware volume
          remains independent.
        </p>
        <ul className="mt-4 space-y-3">
          <ToggleRow
            icon={
              save.settings.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />
            }
            label="Sound"
            on={!save.settings.muted}
            onClick={() => toggle("muted")}
          />
          <VolumeRow
            label="Effects"
            value={save.settings.sfx}
            onChange={(n) => onChange(patchSettings(save, { sfx: n }))}
          />
          <VolumeRow
            label="Music & boss"
            value={save.settings.music}
            onChange={(n) => onChange(patchSettings(save, { music: n }))}
          />
          <ToggleRow
            icon={<Waves className="size-4" />}
            label="Screen shake"
            on={save.settings.shake}
            onClick={() => toggle("shake")}
          />
          <ToggleRow
            icon={<Vibrate className="size-4" />}
            label="Vibration"
            on={save.settings.vibrate}
            onClick={() => toggle("vibrate")}
          />
          <ToggleRow
            icon={<Frame className="size-4" />}
            label="Fewer effects"
            on={save.settings.reducedFx}
            onClick={() => toggle("reducedFx")}
          />
        </ul>
        <button
          {...pressProps(onClose)}
          className="mt-5 h-12 w-full rounded-xl bg-fg text-sm font-medium text-bg"
        >
          Resume Night
        </button>
      </div>
    </div>
  );
}

function Settings({
  save,
  onBack,
  onChange,
  onHelp,
}: {
  save: SaveData;
  onBack: () => void;
  onChange: (s: SaveData) => void;
  onHelp: () => void;
}) {
  const toggle = (key: "shake" | "muted" | "vibrate" | "viewDebug" | "reducedFx") => {
    onChange(patchSettings(save, { [key]: !save.settings[key] }));
  };
  return (
    <ScreenShell>
      <BackBtn onClick={onBack} />
      <h2 className="mt-6 font-display text-4xl">Options</h2>
      <div className="mt-6">
        <GhostBtn onClick={onHelp}>How to play</GhostBtn>
      </div>
      <ul className="mt-6 space-y-3">
        <ToggleRow
          icon={<Waves className="size-4" />}
          label="Screen shake"
          on={save.settings.shake}
          onClick={() => toggle("shake")}
        />
        <ToggleRow
          icon={
            save.settings.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />
          }
          label="Sound"
          on={!save.settings.muted}
          onClick={() => toggle("muted")}
        />
        <VolumeRow
          label="Effects"
          value={save.settings.sfx}
          onChange={(n) => onChange(patchSettings(save, { sfx: n }))}
        />
        <VolumeRow
          label="Music & boss"
          value={save.settings.music}
          onChange={(n) => onChange(patchSettings(save, { music: n }))}
        />
        <ToggleRow
          icon={<Vibrate className="size-4" />}
          label="Vibration"
          on={save.settings.vibrate}
          onClick={() => toggle("vibrate")}
        />
        <ToggleRow
          icon={<Frame className="size-4" />}
          label="Fewer effects"
          on={save.settings.reducedFx}
          onClick={() => toggle("reducedFx")}
        />
        <li className="px-1 text-xs leading-relaxed text-muted">
          Volume changes apply immediately. Your phone volume buttons remain independent, so you can
          always turn the whole game down further on-device.
        </li>
        {devToolsEnabled() ? (
          <ToggleRow
            icon={<Frame className="size-4" />}
            label="Show gold line (debug)"
            on={save.settings.viewDebug}
            onClick={() => toggle("viewDebug")}
          />
        ) : null}
      </ul>
      <p
        className="mt-auto pt-8 text-center text-[10px] uppercase tracking-[0.18em] text-faint"
        aria-label={`Build ${APP_RELEASE}`}
      >
        {APP_RELEASE}
      </p>
    </ScreenShell>
  );
}

function ToggleRow({
  icon,
  label,
  on,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        {...tapProps(onClick)}
        className="pointer-events-auto relative z-30 flex w-full items-center justify-between rounded-xl bg-surface px-4 py-3.5 text-left"
      >
        <span className="flex items-center gap-3 text-sm">
          <span className="text-gold">{icon}</span>
          {label}
        </span>
        <span className={`text-xs tabular-nums ${on ? "text-gold-2" : "text-faint"}`}>
          {on ? "On" : "Off"}
        </span>
      </button>
    </li>
  );
}

function OverdriveButton({ hud, onCast }: { hud: Hud; onCast: () => void }) {
  const active = hud.overdriveT > 0.05;
  const ready = !active && hud.overdriveCd <= 0.05;
  const max = Math.max(1, hud.overdriveMax || 50);
  const progress = Math.max(0, Math.min(1, 1 - hud.overdriveCd / max));
  return (
    <button
      {...instantProps(onCast)}
      disabled={!ready}
      aria-label={
        active
          ? `Overdrive active for ${hud.overdriveT.toFixed(1)} seconds`
          : ready
            ? "Activate Overdrive"
            : `Overdrive ready in ${Math.ceil(hud.overdriveCd)} seconds`
      }
      className={`pointer-events-auto absolute bottom-[max(1.1rem,env(safe-area-inset-bottom))] left-4 z-20 grid size-[4.6rem] place-items-center rounded-full p-[3px] transition-transform active:scale-[0.96] disabled:cursor-default ${active ? "animate-pulse shadow-[0_0_36px_rgba(220,63,24,0.58)]" : "shadow-[0_0_28px_rgba(196,78,34,0.22)]"}`}
      style={{
        background: active
          ? "conic-gradient(#ffe09a 0deg 110deg, #da4b20 110deg 250deg, #ffb13b 250deg 360deg)"
          : ready
            ? "conic-gradient(#f0b04a 0deg 360deg)"
            : `conic-gradient(#c95c2d ${progress * 360}deg, rgba(70,42,32,0.58) 0deg)`,
      }}
    >
      <span
        className={`grid size-full place-items-center rounded-full border text-center ${active ? "border-orange-300/70 bg-[#241008]/96" : "border-line bg-bg/95"}`}
      >
        <span>
          <Zap
            className={`mx-auto size-4 ${active ? "text-orange-200" : ready ? "text-[#f0b04a]" : "text-muted"}`}
          />
          <span
            className={`mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] ${active ? "text-orange-100" : ready ? "text-[#f0b04a]" : "text-muted"}`}
          >
            {active
              ? `${hud.overdriveT.toFixed(1)}s`
              : ready
                ? "Overdrive"
                : `${Math.ceil(hud.overdriveCd)}s`}
          </span>
        </span>
      </span>
    </button>
  );
}

function DecreeButton({ hud, onCast }: { hud: Hud; onCast: () => void }) {
  const ready = hud.decreeCd <= 0.05;
  const max = Math.max(1, hud.decreeMax || 20);
  const progress = Math.max(0, Math.min(1, 1 - hud.decreeCd / max));
  return (
    <button
      {...instantProps(onCast)}
      disabled={!ready}
      aria-label={
        ready ? "Cast King's Decree" : `King's Decree ready in ${Math.ceil(hud.decreeCd)} seconds`
      }
      className="pointer-events-auto absolute bottom-[max(1.1rem,env(safe-area-inset-bottom))] right-4 z-20 grid size-[4.6rem] place-items-center rounded-full p-[3px] shadow-[0_0_28px_rgba(196,165,116,0.2)] transition-transform active:scale-[0.96] disabled:cursor-default"
      style={{
        background: ready
          ? "conic-gradient(#e8d5a8 0deg 360deg)"
          : `conic-gradient(#c4a574 ${progress * 360}deg, rgba(70,56,42,0.55) 0deg)`,
      }}
    >
      <span className="grid size-full place-items-center rounded-full border border-line bg-bg/95 text-center">
        <span>
          <Sparkles className={`mx-auto size-4 ${ready ? "text-gold-2" : "text-muted"}`} />
          <span
            className={`mt-0.5 block text-[11px] font-semibold uppercase tracking-[0.1em] ${ready ? "text-gold-2" : "text-muted"}`}
          >
            {ready ? "Decree" : `${Math.ceil(hud.decreeCd)}s`}
          </span>
        </span>
      </span>
    </button>
  );
}

function SummonTimelineStrip({ hud }: { hud: Hud }) {
  const returning = hud.summons.filter((unit) => unit.status?.startsWith("Returns"));
  if (!returning.length) return null;
  return (
    <div className="pointer-events-none mt-1.5 flex flex-wrap justify-center gap-1.5 [@media(max-height:680px)]:mt-1 [@media(max-height:680px)]:gap-1">
      {returning.map((unit) => {
        const progress = Math.max(0, Math.min(1, unit.current / Math.max(1, unit.max)));
        return (
          <div
            key={unit.id}
            className="min-w-[4.8rem] rounded-lg border border-gold/15 bg-bg/68 px-2 py-1 [@media(max-width:360px)]:min-w-[4.35rem] [@media(max-width:360px)]:px-1.5 [@media(max-height:680px)]:py-0.5"
          >
            <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-[0.1em]">
              <span className="text-muted">{unit.label}</span>
              <span className="tabular-nums text-fg/80">{unit.status}</span>
            </div>
            <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-gold" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function tutorialHint(daily: boolean, night: number, time: number) {
  if (daily) return null;
  if (night === 1) {
    if (time < 8) return "Your court attacks automatically. Survive and watch the gold timer.";
    if (time >= 14 && time < 24) return "Fill the teal XP bar, then pick one simple upgrade.";
    if (time >= 30 && time < 43)
      return "Your two Ultimates are permanent: Decree clears the court, while Overdrive turns the whole court offensive for 10 seconds.";
  }
  if (night === 2 && time < 12) {
    return "Pets and towers fight on their own. Hawk makes aerial attack runs; towers hold their court pads.";
  }
  if (night === 3 && time < 13) {
    return "Special attacks recharge automatically. Their cooldowns are shown above; summon life and stability stay on the units themselves.";
  }
  return null;
}

function cardRole(id: CardId) {
  if (isEvoId(id)) return "Evolution";
  if (
    [
      "fire",
      "chain",
      "pulse",
      "storm",
      "orbit",
      "orbit2",
      "pulse2",
      "pulse3",
      "pulse4",
      "pulse5",
      "chain2",
      "chain3",
      "chain4",
      "chain5",
      "spear",
      "mines",
      "chains",
    ].includes(id)
  )
    return "Spell";
  if (["hound", "hawk", "guard", "lynx"].includes(id)) return "Pet";
  if (["ballista", "brazier", "beacon", "spire", "cannon", "healtower"].includes(id))
    return "Tower";
  if (["hp", "hail", "ward", "thorns", "vamp", "laststand"].includes(id)) return "Defense";
  if (id === "xp") return "Utility";
  return "Attack";
}

function CooldownStrip({ hud }: { hud: Hud }) {
  const items: Array<{ label: string; status: string; progress: number; ready: boolean }> = [];
  const addCd = (enabled: number, label: string, cd: number, max: number) => {
    if (enabled <= 0) return;
    const ready = cd <= 0.05;
    items.push({
      label,
      status: ready ? "READY" : `${Math.max(0, cd).toFixed(cd < 1 ? 1 : 0)}s`,
      progress: ready ? 1 : Math.max(0, Math.min(1, 1 - cd / Math.max(0.1, max))),
      ready,
    });
  };
  addCd(
    hud.fireStacks,
    `Fireball ${["", "I", "II", "III", "IV", "V"][Math.max(0, Math.min(5, hud.fireStacks))] ?? ""}`.trim(),
    hud.fireCd,
    hud.fireMax,
  );
  addCd(
    hud.chainStacks,
    `Lightning ${["", "I", "II", "III", "IV", "V"][Math.max(0, Math.min(5, hud.chainStacks))] ?? ""}`.trim(),
    hud.chainCd,
    hud.chainMax,
  );
  addCd(
    hud.pulseStacks,
    `Fire Ring ${["", "I", "II", "III", "IV", "V"][Math.max(0, Math.min(5, hud.pulseStacks))] ?? ""}`.trim(),
    hud.pulseCd,
    hud.pulseMax,
  );
  addCd(
    hud.spearStacks,
    `Ash Spear ${["", "I", "II", "III", "IV", "V"][Math.max(0, Math.min(5, hud.spearStacks))] ?? ""}`.trim(),
    hud.spearCd,
    hud.spearMax,
  );
  addCd(
    hud.minesStacks,
    `Mines ${["", "I", "II", "III", "IV", "V"][Math.max(0, Math.min(5, hud.minesStacks))] ?? ""}`.trim(),
    hud.minesCd,
    hud.minesMax,
  );
  addCd(
    hud.chainsStacks,
    `Chains ${["", "I", "II", "III", "IV", "V"][Math.max(0, Math.min(5, hud.chainsStacks))] ?? ""}`.trim(),
    hud.chainsCd,
    hud.chainsMax,
  );
  if (!items.length) return null;
  return (
    <div className="pointer-events-none mt-2 flex flex-wrap justify-center gap-1.5 [@media(max-height:680px)]:mt-1 [@media(max-height:680px)]:gap-1">
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-[4.8rem] rounded-lg border border-gold/15 bg-bg/68 px-2 py-1 [@media(max-width:360px)]:min-w-[4.35rem] [@media(max-width:360px)]:px-1.5 [@media(max-height:680px)]:py-0.5"
        >
          <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-[0.1em]">
            <span className="text-muted">{item.label}</span>
            <span className={item.ready ? "text-gold-2" : "tabular-nums text-fg/80"}>
              {item.status}
            </span>
          </div>
          <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-gold" style={{ width: `${item.progress * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function fmtCooldown(cd: number, max: number) {
  if (max <= 0) return "—";
  return cd <= 0.05
    ? `Ready · ${max.toFixed(max % 1 ? 1 : 0)}s`
    : `${cd.toFixed(1)}s left · ${max.toFixed(max % 1 ? 1 : 0)}s`;
}

function LoadoutPanel({
  stats,
  hud,
  onClose,
}: {
  stats: PlayerStats;
  hud: Hud;
  onClose: () => void;
}) {
  const passiveFamilies: { label: string; ids: CardId[] }[] = [
    { label: "Hit Harder", ids: ["dmg", "dmg2", "dmg3", "dmg4", "dmg5"] },
    { label: "More Life", ids: ["hp", "hp2", "hp3", "hp4", "hp5"] },
    { label: "Experience", ids: ["xp", "xp2", "xp3", "xp4", "xp5"] },
    { label: "Life Steal", ids: ["vamp", "vamp2", "vamp3", "vamp4", "vamp5"] },
    { label: "Piercing Shots", ids: ["pierce", "pierce2", "pierce3", "pierce4", "pierce5"] },
    { label: "Thorns", ids: ["thorns", "thorns2", "thorns3", "thorns4", "thorns5"] },
    { label: "Iron Skin", ids: ["hail", "hail2", "hail3", "hail4", "hail5"] },
    { label: "Faster Shots", ids: ["split", "split2", "split3", "split4", "split5"] },
    { label: "Regeneration", ids: ["ward", "ward2", "ward3", "ward4", "ward5"] },
  ];
  const passiveIds = new Set<CardId>(passiveFamilies.flatMap((family) => family.ids));
  const passiveRows = passiveFamilies.flatMap((family) => {
    let best: CardDef | null = null;
    for (const id of family.ids) {
      if (!stats.owned.has(id)) continue;
      const card = CARDS.find((candidate) => candidate.id === id);
      if (card) best = card;
    }
    return best ? [{ label: family.label, title: best.title, effect: best.blurb }] : [];
  });
  const selectedCards = CARDS.filter(
    (card) => stats.owned.has(card.id) && !isEvoId(card.id) && !passiveIds.has(card.id),
  );
  const skills = [
    stats.weapons.fire > 0
      ? {
          title: "Fireball",
          level: `Lv ${Math.min(5, stats.weapons.fire)} · ×${Math.min(5, stats.weapons.fire)}`,
          timing: fmtCooldown(hud.fireCd, hud.fireMax),
          effect: "Each level adds one full-strength fireball to the automatic volley.",
        }
      : null,
    stats.weapons.chain > 0
      ? {
          title: "Lightning",
          level: `Lv ${Math.max(1, stats.weapons.chain)}`,
          timing: fmtCooldown(hud.chainCd, hud.chainMax),
          effect: `Heavy lightning strike; currently jumps to ${Math.max(0, stats.weapons.chainJumps)} additional targets.`,
        }
      : null,
    stats.weapons.pulse > 0
      ? {
          title: "Fire Ring",
          level: `Lv ${Math.max(1, Math.min(5, hud.pulseStacks))}`,
          timing: fmtCooldown(hud.pulseCd, hud.pulseMax),
          effect: `Automatic ring burst around the King · radius ${Math.round(stats.weapons.pulseR)} · about ${Math.round(18 * (1 + stats.weapons.pulse))} base damage.`,
        }
      : null,
    stats.weapons.storm > 0
      ? {
          title: "Tornado",
          level: `×${stats.weapons.storm}`,
          timing: hud.stormRespawn > 0 ? `${hud.stormRespawn.toFixed(1)}s until return` : "Active",
          effect: "Moves through the Court, pulls enemies inward and spends Stability on kills.",
        }
      : null,
    stats.weapons.spear > 0
      ? {
          title: "Ash Spear",
          level: `Lv ${stats.weapons.spear}`,
          timing: fmtCooldown(hud.spearCd, hud.spearMax),
          effect: "Pierces the strongest target and deals extra pressure to elites and bosses.",
        }
      : null,
    stats.weapons.mines > 0
      ? {
          title: "Cinder Mines",
          level: `Lv ${stats.weapons.mines}`,
          timing: fmtCooldown(hud.minesCd, hud.minesMax),
          effect: "Plants ember mines that detonate when enemies enter their trigger area.",
        }
      : null,
    stats.weapons.chains > 0
      ? {
          title: "Crown Chains",
          level: `Lv ${stats.weapons.chains}`,
          timing: fmtCooldown(hud.chainsCd, hud.chainsMax),
          effect: "Binds dangerous enemies and briefly roots non-boss targets.",
        }
      : null,
  ].filter(Boolean) as { title: string; level: string; timing: string; effect: string }[];

  const towerRows = [
    stats.ballista > 0
      ? {
          title: "Ballista",
          level: stats.ballista,
          timing: `${ballistaTowerCooldown(stats.ballista, stats.pack.ballista).toFixed(2)}s per shot`,
          effect: "Fast precision bolts. Levels improve damage, range, cadence and bolt size.",
        }
      : null,
    stats.brazier > 0
      ? {
          title: "Laser Tower",
          level: stats.brazier,
          timing: `${laserTowerBeamDuration(stats.brazier).toFixed(1)}s beam · ${laserTowerCooldown(stats.brazier, stats.pack.brazier).toFixed(1)}s recovery`,
          effect: `Tracking beam · reach 360 · ${Math.round(laserTowerDps(stats.brazier) * (1 + stats.pack.brazier * 0.16))} base DPS before global damage bonuses${stats.brazier >= 4 ? " · ramps while holding the same target and can retarget mid-beam" : ""}${stats.evo.crownprism ? " · CROWN PRISM: locks a foe across the Court until it dies and pushes it to the edge" : ""}.`,
        }
      : null,
    stats.beacon > 0
      ? {
          title: "Fire Tower",
          level: stats.beacon,
          timing: `${FIRE_TOWER_ACTIVE_S.toFixed(1)}s flame · ${FIRE_TOWER_RELOAD_S.toFixed(1)}s reload`,
          effect: `Continuous area flame burns every enemy in reach · ${Math.round(fireTowerDps(stats.beacon) * (1 + stats.pack.beacon * 0.18) * (stats.evo.wall ? 1.25 : 1))} current tower DPS before other global damage bonuses · reach ${Math.round(fireTowerReach(stats.beacon, stats.pack.beacon) * (stats.evo.wall ? 1.18 : 1))}${stats.evo.wall ? " · THE WALL: +25% damage, +18% reach" : ""}.`,
        }
      : null,
    stats.spires > 0
      ? {
          title: "Heir Tower",
          level: stats.spires,
          timing: `${heirTowerMinionCooldown(stats.spires).toFixed(2)}s sword cadence`,
          effect: `Maintains up to ${Math.min(5, stats.spires)} Heir${stats.spires === 1 ? "" : "s"} · ${Math.round(heirTowerMinionHp(stats.spires))} HP · ${heirTowerMinionDamage(stats.spires).toFixed(1)} base sword damage each${stats.spires >= 5 ? " · Crown Heir 1 deals +25% sword damage" : ""}.`,
        }
      : null,
    stats.cannon > 0
      ? {
          title: "Cannon Tower",
          level: stats.cannon,
          timing: `${cannonTowerCooldown(stats.cannon).toFixed(1)}s reload`,
          effect: `Target-lock heavy shell · blast radius ${Math.round(cannonTowerBlastRadius(stats.cannon))} · hits every enemy inside the blast.`,
        }
      : null,
    stats.healTower > 0
      ? {
          title: "Heal Tower",
          level: stats.healTower,
          timing: `${healTowerCooldown(stats.healTower).toFixed(1)}s per heal`,
          effect: `Green beam heals the King and every living ally within ${healTowerRange(stats.healTower)} reach · restores ${(healTowerFraction(stats.healTower) * 100).toFixed(0)}% of each target's own max life per pulse.`,
        }
      : null,
  ].filter(Boolean) as { title: string; level: number; timing: string; effect: string }[];

  const petSummary = [
    stats.hounds > 0 ? `Hound ×${stats.hounds}` : null,
    stats.hawks > 0 ? `Hawk ×${stats.hawks}` : null,
    stats.guards > 0 ? `Guard ×${stats.guards}` : null,
    stats.lynxes > 0 ? `Ash Lynx ×${stats.lynxes}` : null,
    stats.weapons.storm > 0 ? `Tornado ×${stats.weapons.storm}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 overflow-y-auto overscroll-y-contain bg-bg/96 px-4 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+1rem))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md">
        <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between gap-3 bg-bg/94 px-1 py-2 backdrop-blur-sm">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-gold">Current Night</p>
            <h2 className="font-display text-3xl">Build & Loadout</h2>
          </div>
          <button
            {...instantProps(onClose)}
            className="grid size-12 shrink-0 place-items-center rounded-xl border border-gold/30 bg-surface text-gold-2"
            aria-label="Close build and resume"
          >
            <X className="size-5" strokeWidth={1.8} />
          </button>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-muted">
          The Night is paused while this page is open. Cooldowns, current summon life and every
          active Evolution are shown from the live run.
        </p>

        <section className="mt-5 rounded-xl border border-gold/25 bg-surface/75 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-2xl text-gold-2">King</h3>
            <span className="text-xs tabular-nums text-muted">
              {hud.buildMaxed ? "MAX BUILD" : `Lv ${hud.level}`}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <p className="rounded-lg bg-bg/55 px-2.5 py-2">
              Life · {Math.round(hud.hp)} / {Math.round(hud.maxHp)}
            </p>
            <p className="rounded-lg bg-bg/55 px-2.5 py-2">Shots · {stats.weapons.sickleCount}</p>
            <p className="rounded-lg bg-bg/55 px-2.5 py-2">Damage · ×{stats.dmgMul.toFixed(2)}</p>
            <p className="rounded-lg bg-bg/55 px-2.5 py-2">Regen · {stats.regen.toFixed(1)}/s</p>
          </div>
          <div className="mt-2 rounded-lg border border-gold/15 bg-bg/45 px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-gold-2">King&apos;s Decree · Ultimate</span>
              <span className="tabular-nums text-muted">
                {fmtCooldown(hud.decreeCd, hud.decreeMax)}
              </span>
            </div>
            <p className="mt-1 leading-relaxed text-muted">
              Arena-wide royal shockwave. Strikes every living enemy across the visible court;
              existing elite/boss damage caps and knockback rules stay unchanged.
            </p>
          </div>
          <div className="mt-2 rounded-lg border border-orange-400/20 bg-bg/45 px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-[#f0b04a]">Overdrive · Ultimate</span>
              <span className="tabular-nums text-muted">
                {hud.overdriveT > 0.05
                  ? `ACTIVE · ${hud.overdriveT.toFixed(1)}s`
                  : fmtCooldown(hud.overdriveCd, hud.overdriveMax)}
              </span>
            </div>
            <p className="mt-1 leading-relaxed text-muted">
              10 seconds: +45% global damage, +65% global attack speed, +15 percentage points global
              Crit chance and stronger Crits. Movement speed is unchanged.
            </p>
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-line bg-surface/70 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-display text-2xl">Passive Upgrades</h3>
            <span className="text-[11px] text-muted">Current tier</span>
          </div>
          {passiveRows.length ? (
            <div className="mt-2 space-y-2">
              {passiveRows.map((passive) => (
                <div
                  key={passive.label}
                  className="rounded-lg border border-line/70 bg-bg/50 px-3 py-2"
                >
                  <p className="font-medium text-gold-2">{passive.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{passive.effect}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">No passive upgrade cards selected yet.</p>
          )}
        </section>

        <section className="mt-4 rounded-xl border border-line bg-surface/70 p-3">
          <h3 className="font-display text-2xl">Skills & Attacks</h3>
          {skills.length ? (
            <div className="mt-2 space-y-2">
              {skills.map((skill) => (
                <div
                  key={skill.title}
                  className="rounded-lg border border-line/70 bg-bg/50 px-3 py-2"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium text-gold-2">
                      {skill.title} · {skill.level}
                    </p>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">
                      {skill.timing}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{skill.effect}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">No automatic skill cards selected yet.</p>
          )}
        </section>

        <section className="mt-4 rounded-xl border border-line bg-surface/70 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-display text-2xl">Pets & Summons</h3>
            <span className="text-[11px] text-muted">{petSummary.join(" · ") || "None"}</span>
          </div>
          {hud.summons.length ? (
            <div className="mt-2 space-y-2">
              {hud.summons.map((unit) => {
                const returning = !!unit.status?.startsWith("Returns");
                const tornado = unit.label.startsWith("Tornado");
                const pct = Math.max(0, Math.min(1, unit.current / Math.max(1, unit.max)));
                return (
                  <div
                    key={unit.id}
                    className="rounded-lg border border-line/70 bg-bg/50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-gold-2">{unit.label}</span>
                      <span className="tabular-nums text-muted">
                        {returning
                          ? unit.status
                          : `${Math.round(unit.current)} / ${Math.round(unit.max)} ${tornado ? "Stability" : "HP"}`}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                      <div className="h-full bg-gold-2" style={{ width: `${pct * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">No active pets or summons yet.</p>
          )}
          <div className="mt-2 space-y-1 text-xs leading-relaxed text-muted">
            {stats.hounds > 0 ? (
              <p>
                Hound · roaming royal hunter that sprints, pounces and bites; it never waits beside
                the King.
              </p>
            ) : null}
            {stats.hawks > 0 ? (
              <p>
                Hawk · air hunter; attack runs fire target-locked shots, and only hostile ranged
                attacks can hurt it.
              </p>
            ) : null}
            {stats.guards > 0 ? (
              <p>
                Guard · patrols around the King and intercepts enemies entering the King&apos;s
                danger area.
              </p>
            ) : null}
            {stats.lynxes > 0 ? (
              <p>
                Ash Lynx · very fast perimeter assassin that splits targets with other Lynxes and
                applies EXPOSED, increasing damage taken.
              </p>
            ) : null}
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-line bg-surface/70 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-display text-2xl">Court Towers</h3>
            <span className="text-[11px] text-muted">{towerRows.length}/6 pads used</span>
          </div>
          {towerRows.length ? (
            <div className="mt-2 space-y-2">
              {towerRows.map((tower) => (
                <div
                  key={tower.title}
                  className="rounded-lg border border-line/70 bg-bg/50 px-3 py-2"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium text-gold-2">
                      {tower.title} · Lv {tower.level}
                    </p>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">
                      {tower.timing}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{tower.effect}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">No Court tower built yet.</p>
          )}
        </section>

        <section className="mt-4 rounded-xl border border-gold/25 bg-surface/75 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-display text-2xl text-gold-2">Evolutions</h3>
            <span className="text-[11px] text-muted">Recipe + effect</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Collect at least one card from every recipe group. When all groups are complete, the
            gold Evolution card can appear at a level-up.
          </p>
          <div className="mt-3 space-y-2">
            {ACTIVE_EVO_IDS.map((id) => {
              const active = !!stats.evo[id];
              const progress = evolutionProgressForId(stats, id);
              return (
                <div
                  key={id}
                  className={`rounded-lg border px-3 py-2 ${active ? "border-gold/55 bg-gold/8" : progress.ready ? "border-gold/30 bg-bg/60" : "border-line/70 bg-bg/45"}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-display text-lg text-gold-2">{EVO_TITLE[id]}</p>
                    <span
                      className={`text-[10px] uppercase tracking-[0.12em] ${active || progress.ready ? "text-gold" : "text-muted"}`}
                    >
                      {active
                        ? "Active"
                        : progress.ready
                          ? "Recipe ready"
                          : `${progress.have}/${progress.total}`}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-gold">
                    Requires · {evolutionRequirementText(id)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Effect · {evolutionEffectText(id)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-line bg-surface/70 p-3">
          <h3 className="font-display text-2xl">Selected Cards</h3>
          <p className="mt-1 text-xs text-muted">
            Other card types already taken this Night. Passive I-V chains are summarized above at
            their highest current tier.
          </p>
          {selectedCards.length ? (
            <div className="mt-2 grid grid-cols-1 gap-2">
              {selectedCards.map((card) => (
                <div key={card.id} className="rounded-lg border border-line/70 bg-bg/50 px-3 py-2">
                  <p className="text-sm font-medium text-gold-2">{card.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{card.blurb}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">No level-up cards selected yet.</p>
          )}
        </section>

        <button
          {...pressProps(onClose)}
          className="mt-5 h-12 w-full rounded-xl bg-fg text-sm font-medium text-bg"
        >
          Resume Night
        </button>
      </div>
    </div>
  );
}

function HudBar({
  hud,
  bestEndless,
  onPause,
  gameSpeed,
  onToggleSpeed,
  onLoadout,
  onSettings,
  offlineNotice,
  syncRequired,
}: {
  hud: Hud;
  bestEndless: number;
  onPause: () => void;
  gameSpeed: 1 | 2;
  onToggleSpeed: () => void;
  onLoadout: () => void;
  onSettings: () => void;
  offlineNotice: string | null;
  syncRequired: boolean;
}) {
  const t = hud.endless
    ? Math.min(1, (hud.time % 300) / 300)
    : Math.max(0, 1 - hud.time / Math.max(1, hud.duration));
  const hp = hud.maxHp > 0 ? hud.hp / hud.maxHp : 0;
  const xp = hud.buildMaxed ? 1 : hud.need > 0 ? hud.xp / hud.need : 0;
  const [recordFlash, setRecordFlash] = useState(false);
  const recordCrossed = useRef(false);
  const newBest = hud.endless && bestEndless > 0 && hud.time > bestEndless;
  const endlessStarting = hud.endless && hud.time < 1;
  useEffect(() => {
    if (!hud.endless || endlessStarting) {
      recordCrossed.current = false;
      setRecordFlash(false);
      return;
    }
    if (newBest && !recordCrossed.current) {
      recordCrossed.current = true;
      setRecordFlash(true);
      const id = window.setTimeout(() => setRecordFlash(false), 1800);
      return () => window.clearTimeout(id);
    }
  }, [hud.endless, endlessStarting, newBest]);
  return (
    <div className="absolute inset-x-0 top-0 z-20 px-4 pt-[max(0.8rem,env(safe-area-inset-top))] [@media(max-width:360px)]:px-2.5 [@media(max-height:680px)]:pt-[max(0.45rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-3 [@media(max-width:360px)]:gap-2">
        <div className="pointer-events-none min-w-0 flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-gold-2" style={{ width: `${t * 100}%` }} />
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-ember" style={{ width: `${hp * 100}%` }} />
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-gold-2">
              {Math.round(hud.hp)} / {Math.round(hud.maxHp)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-soul" style={{ width: `${xp * 100}%` }} />
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-soul">
              {hud.buildMaxed ? "MAX BUILD" : `${Math.floor(hud.xp)} / ${Math.floor(hud.need)}`}
            </span>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <span className="font-display text-xl tabular-nums text-gold-2">
            {hud.endless
              ? `∞ ${formatEndlessTime(hud.time)}`
              : hud.boss && hud.time >= hud.duration - 1
                ? "OVERTIME"
                : fmtRemain(hud.time, hud.duration)}
          </span>
          <button
            {...instantProps(onToggleSpeed)}
            className="pointer-events-auto relative z-30 grid size-12 place-items-center rounded-xl border border-gold/30 bg-surface/90 font-display text-sm tabular-nums text-gold-2 [@media(max-width:360px)]:size-11 [@media(max-height:680px)]:size-10"
            aria-label={`Game speed ${gameSpeed}x`}
            title={`Game speed: ${gameSpeed}×`}
          >
            {gameSpeed}×
          </button>
          <button
            {...instantProps(onLoadout)}
            className="pointer-events-auto relative z-30 grid size-12 place-items-center rounded-xl border border-gold/30 bg-surface/90 text-gold-2 [@media(max-width:360px)]:size-11 [@media(max-height:680px)]:size-10"
            aria-label="Build and loadout"
            title="Build & loadout"
          >
            <BookOpen className="size-4" strokeWidth={1.8} />
          </button>
          <button
            {...instantProps(onSettings)}
            className="pointer-events-auto relative z-30 grid size-12 place-items-center rounded-xl border border-gold/30 bg-surface/90 text-gold-2 [@media(max-width:360px)]:size-11 [@media(max-height:680px)]:size-10"
            aria-label="Settings"
            title="Settings"
          >
            <Settings2 className="size-4" strokeWidth={1.8} />
          </button>
          <button
            {...instantProps(onPause)}
            className="pointer-events-auto relative z-30 grid size-12 place-items-center rounded-xl border border-gold/30 bg-surface/90 text-gold-2 [@media(max-width:360px)]:size-11 [@media(max-height:680px)]:size-10"
            aria-label="Pause"
          >
            <Pause className="size-4" strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] tabular-nums text-muted [@media(max-width:360px)]:text-[10px] [@media(max-height:680px)]:mt-1">
        <span>{hud.buildMaxed ? "MAX BUILD" : `Lv ${hud.level}`}</span>
        <span>
          Shots {hud.sickles}
          {hud.orbits ? ` · Blades ${hud.orbits}` : ""}
          {hud.endless ? ` · ${hud.kills} fallen` : ` · ${hud.gold} crowns · ${hud.kills} fallen`}
        </span>
      </div>
      {hud.endless && bestEndless > 0 ? (
        <div
          className={`pointer-events-none mx-auto mt-1.5 w-fit rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] transition-all ${newBest ? "border-gold/55 bg-gold/12 text-gold-2" : "border-line/80 bg-bg/55 text-muted"} ${recordFlash ? "scale-105 shadow-[0_0_24px_rgba(232,168,78,0.35)]" : ""}`}
        >
          {newBest ? "New best" : "Best"} · {formatEndlessTime(bestEndless)}
        </div>
      ) : null}
      <CooldownStrip hud={hud} />
      <SummonTimelineStrip hud={hud} />
      {offlineNotice || syncRequired ? (
        <div className="pointer-events-none mt-1.5 flex flex-wrap justify-center gap-1 [@media(max-height:680px)]:mt-1">
          {offlineNotice ? (
            <p className="rounded-full bg-bg/88 px-3 py-1 text-center text-[10px] uppercase tracking-[0.16em] text-gold-2 shadow-[0_2px_10px_rgba(0,0,0,0.25)]">
              {offlineNotice}
            </p>
          ) : null}
          {syncRequired ? (
            <p className="rounded-full bg-bg/88 px-3 py-1 text-center text-[10px] uppercase tracking-[0.16em] text-danger shadow-[0_2px_10px_rgba(0,0,0,0.25)]">
              Sync required
            </p>
          ) : null}
        </div>
      ) : null}
      {hud.banner ? (
        <p className="mt-2 text-center text-[11px] uppercase tracking-[0.2em] text-gold-2 [@media(max-height:680px)]:mt-1 [@media(max-height:680px)]:text-[10px]">
          {hud.banner}
        </p>
      ) : null}
      {hud.boss && (
        <div className="mt-2 [@media(max-height:680px)]:mt-1">
          <p className="text-center text-[11px] uppercase tracking-[0.2em] text-gold-2 [@media(max-height:680px)]:text-[10px]">
            {hud.endless
              ? "Endless Lord"
              : hud.banner.startsWith("Final Lord")
                ? "Final Lord · Elite Court"
                : "Night Lord · Elite Court"}
          </p>
          <div className="mx-auto mt-1 h-1.5 max-w-[12rem] overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-ember"
              style={{ width: `${hud.bossMax ? (hud.bossHp / hud.bossMax) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CardPick({
  cards,
  hud,
  stats,
  banishes,
  onPick,
  onBanish,
}: {
  cards: CardDef[];
  hud: Hud;
  stats: PlayerStats | null;
  banishes: number;
  onPick: (id: CardId) => void;
  onBanish: (id: CardId) => void;
}) {
  const note = (c: CardDef) => {
    if (c.id === "hp") {
      const now = Math.round(hud.hp);
      const max = Math.round(hud.maxHp);
      return `${now} / ${max}  →  ${now + HP_CARD} / ${max + HP_CARD}`;
    }
    if (c.id === "proj") return `${hud.sickles} → ${Math.min(8, hud.sickles + 1)} Shots`;
    if (c.id === "orbit")
      return hud.orbits ? `${hud.orbits} → ${hud.orbits + 2} Blades` : "0 → 2 Blades";
    if (c.id === "orbit2") return `${hud.orbits} → ${Math.min(12, hud.orbits + 2)} Blades`;
    if (c.id === "fire") {
      const current = Math.max(0, Math.min(5, stats?.weapons.fire ?? 0));
      const next = Math.min(5, current + 1);
      const cooldown = [0, 5, 4.5, 4, 3.5, 3][next]!;
      return current <= 0
        ? "Fireball I · 1 full-strength fireball every 5.0s"
        : `Fireball ${["", "I", "II", "III", "IV", "V"][next]} · Lv ${current} → ${next} · cooldown ${cooldown.toFixed(1)}s`;
    }
    if (c.id === "storm") {
      const current = Math.max(0, Math.min(3, stats?.weapons.storm ?? 0));
      return current <= 0
        ? "Summon Tornado · pulls and damages enemies; returns after Stability recovery"
        : `Summon another Tornado · ${current} → ${Math.min(3, current + 1)} active Tornados`;
    }
    if (c.id === "spear") {
      const current = Math.max(0, Math.min(5, stats?.weapons.spear ?? 0));
      const next = Math.min(5, current + 1);
      return `Ash Spear ${["", "I", "II", "III", "IV", "V"][next]} · ${32 * next} base damage every 5.0s · pierces and hits elites/bosses harder`;
    }
    if (c.id === "mines") {
      const current = Math.max(0, Math.min(5, stats?.weapons.mines ?? 0));
      const next = Math.min(5, current + 1);
      const count = 7 + next;
      return `Cinder Mines ${["", "I", "II", "III", "IV", "V"][next]} · up to ${count} mines, replenished every 7.0s · ${28 * next} base damage · larger blast`;
    }
    if (c.id === "chains") {
      const current = Math.max(0, Math.min(5, stats?.weapons.chains ?? 0));
      const next = Math.min(5, current + 1);
      return `Crown Chains ${["", "I", "II", "III", "IV", "V"][next]} · hits up to ${Math.min(8, 2 + next)} targets every 9.0s · stronger damage and root`;
    }
    if (c.id === "ballista") {
      const current = Math.max(0, Math.min(5, stats?.ballista ?? 0));
      return current <= 0
        ? "Build · Ballista Lv 1 · long-range bolts; upgrades improve damage, range, fire rate and bolt size"
        : `Upgrade · Ballista Lv ${current} → Lv ${Math.min(5, current + 1)} · damage + range + fire rate + bolt size`;
    }
    if (c.id === "brazier") {
      const current = Math.max(0, Math.min(5, stats?.brazier ?? 0));
      const next = Math.min(5, current + 1);
      return current <= 0
        ? `Build · Laser Tower I · reach 360 · ${laserTowerBeamDuration(1).toFixed(1)}s tracking beam · ${laserTowerDps(1)} base DPS`
        : `Upgrade · Laser Tower ${["", "I", "II", "III", "IV", "V"][current]} → ${["", "I", "II", "III", "IV", "V"][next]} · longer beam + higher DPS${next >= 4 ? " + ramp/retarget" : ""}`;
    }
    if (c.id === "beacon") {
      const current = Math.max(0, Math.min(5, stats?.beacon ?? 0));
      return current <= 0
        ? `Build · Fire Tower I · ${FIRE_TOWER_ACTIVE_S.toFixed(1)}s continuous flame · ${FIRE_TOWER_RELOAD_S.toFixed(1)}s reload · ${fireTowerDps(1)} base DPS · reach ${Math.round(fireTowerReach(1))}`
        : `Upgrade · Fire Tower ${["", "I", "II", "III", "IV", "V"][current]} → ${["", "I", "II", "III", "IV", "V"][Math.min(5, current + 1)]} · ${fireTowerDps(current)} → ${fireTowerDps(Math.min(5, current + 1))} base DPS · reach ${Math.round(fireTowerReach(current))} → ${Math.round(fireTowerReach(Math.min(5, current + 1)))}`;
    }
    if (c.id === "spire") {
      const current = Math.max(0, Math.min(5, stats?.spires ?? 0));
      return current <= 0
        ? `Build · Heir Tower I · summons 1 Heir with ${Math.round(heirTowerMinionHp(1))} HP and ${heirTowerMinionDamage(1).toFixed(1)} base sword damage`
        : `Upgrade · Heir Tower ${["", "I", "II", "III", "IV", "V"][current]} → ${["", "I", "II", "III", "IV", "V"][Math.min(5, current + 1)]} · ${current} → ${Math.min(5, current + 1)} Heirs · stronger HP and sword damage`;
    }
    if (c.id === "cannon") {
      const current = Math.max(0, Math.min(5, stats?.cannon ?? 0));
      const next = Math.min(5, current + 1);
      const radii = [0, 90, 120, 150, 180, 210];
      return current <= 0
        ? "Build · Cannon Tower I · target-lock shell · 90 blast radius · 3.5s reload"
        : `Upgrade · Cannon Tower ${["", "I", "II", "III", "IV", "V"][current]} → ${["", "I", "II", "III", "IV", "V"][next]} · blast radius ${radii[current]} → ${radii[next]} · faster reload ${cannonTowerCooldown(current).toFixed(1)}s → ${cannonTowerCooldown(next).toFixed(1)}s`;
    }
    if (c.id === "healtower") {
      const current = Math.max(0, Math.min(5, stats?.healTower ?? 0));
      const next = Math.min(5, current + 1);
      return current <= 0
        ? `Build · Heal Tower I · green beam heals King + living allies within ${healTowerRange(1)} reach · ${(healTowerFraction(1) * 100).toFixed(0)}% every ${healTowerCooldown(1).toFixed(1)}s`
        : `Upgrade · Heal Tower Lv ${current} → Lv ${next} · healing ${(healTowerFraction(current) * 100).toFixed(0)}% → ${(healTowerFraction(next) * 100).toFixed(0)}% · reach ${healTowerRange(current)} → ${healTowerRange(next)} · pulse ${healTowerCooldown(current).toFixed(1)}s → ${healTowerCooldown(next).toFixed(1)}s`;
    }
    return null;
  };
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 overflow-y-auto overscroll-y-contain bg-bg/92 px-4 pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.75rem))] pt-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))]">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-end">
        <p className="mb-3 text-center text-xs uppercase tracking-[0.22em] text-gold">
          Pick a card
        </p>
        <div className="flex w-full flex-col gap-2">
          {cards.map((c, i) => {
            const evo = isEvoId(c.id);
            const rarity = c.rarity ?? "common";
            const role = cardRole(c.id);
            const evoHints = stats ? evolutionProgressForCard(stats, c.id) : [];
            const evoRequirement = isEvoId(c.id) ? evolutionRequirementText(c.id) : null;
            const liveNote = note(c);
            const towerCard = [
              "ballista",
              "brazier",
              "beacon",
              "spire",
              "cannon",
              "healtower",
            ].includes(c.id);
            const liveSkillCard = ["fire", "storm", "spear", "mines", "chains"].includes(c.id);
            const roman = ["", "I", "II", "III", "IV", "V"];
            let displayTitle = c.title;
            if (stats && c.id === "fire")
              displayTitle = `Fireball ${roman[Math.min(5, stats.weapons.fire + 1)]}`;
            if (stats && c.id === "spear")
              displayTitle = `Ash Spear ${roman[Math.min(5, stats.weapons.spear + 1)]}`;
            if (stats && c.id === "mines")
              displayTitle = `Cinder Mines ${roman[Math.min(5, stats.weapons.mines + 1)]}`;
            if (stats && c.id === "chains")
              displayTitle = `Crown Chains ${roman[Math.min(5, stats.weapons.chains + 1)]}`;
            if (stats && c.id === "ballista")
              displayTitle = `Ballista ${roman[Math.min(5, stats.ballista + 1)]}`;
            if (stats && c.id === "brazier")
              displayTitle = `Laser Tower ${roman[Math.min(5, stats.brazier + 1)]}`;
            if (stats && c.id === "beacon")
              displayTitle = `Fire Tower ${roman[Math.min(5, stats.beacon + 1)]}`;
            if (stats && c.id === "spire")
              displayTitle = `Heir Tower ${roman[Math.min(5, stats.spires + 1)]}`;
            if (stats && c.id === "cannon")
              displayTitle = `Cannon Tower ${roman[Math.min(5, stats.cannon + 1)]}`;
            if (stats && c.id === "healtower")
              displayTitle = `Heal Tower ${roman[Math.min(5, stats.healTower + 1)]}`;
            if (stats && c.id === "storm" && stats.weapons.storm > 0) displayTitle = "Tornado · +1";
            const primaryDescription = isEvoId(c.id)
              ? evolutionEffectText(c.id)
              : (towerCard || liveSkillCard) && liveNote
                ? liveNote
                : c.blurb;
            return (
              <div
                key={c.id}
                className={`rounded-xl border px-4 py-4 ${evo ? "border-gold bg-surface-2" : "border-line bg-surface"}`}
              >
                <button
                  data-card-id={c.id}
                  {...pressProps(() => onPick(c.id))}
                  className="pointer-events-auto w-full text-left"
                >
                  {evo ? (
                    <p className="mb-1 text-[11px] uppercase tracking-[0.2em] text-gold">
                      Evolution ready
                    </p>
                  ) : (
                    <p className="mb-1 text-[11px] uppercase tracking-[0.22em] text-muted">
                      {role}
                      {rarity !== "common" ? ` · ${rarity}` : ""}
                    </p>
                  )}
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-2xl leading-none">{displayTitle}</span>
                    <span
                      className="text-[11px] tabular-nums text-muted [@media(pointer:coarse)]:hidden"
                      aria-label={`Keyboard shortcut ${i + 1}`}
                    >
                      {i + 1}
                    </span>
                  </div>
                  {evo ? (
                    <p className="mt-2 rounded-lg border border-gold/35 bg-gold/8 px-2.5 py-2 text-sm leading-relaxed text-gold-2">
                      {primaryDescription}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm leading-relaxed text-muted">{primaryDescription}</p>
                  )}
                  {evoRequirement ? (
                    <p className="mt-2 rounded-lg border border-gold/20 bg-bg/40 px-2.5 py-2 text-xs leading-relaxed text-gold-2">
                      Requires · {evoRequirement}
                    </p>
                  ) : null}
                  {!evo && !towerCard && !liveSkillCard && liveNote ? (
                    <p className="mt-1 text-xs text-gold-2">{liveNote}</p>
                  ) : null}
                  {evoHints.slice(0, 2).map((hint) => (
                    <p
                      key={hint.id}
                      className={`mt-1 text-xs ${hint.readyAfterPick ? "font-medium text-gold" : "text-gold-2"}`}
                    >
                      {hint.title} · {hint.have}/{hint.total}
                      {hint.readyAfterPick ? " · READY after pick" : ""}
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                        Needs · {hint.requirement}
                      </span>
                    </p>
                  ))}
                </button>
                {banishes > 0 ? (
                  <button
                    {...tapProps(() => onBanish(c.id))}
                    className="pointer-events-auto mt-3 inline-flex min-h-11 min-w-11 items-center justify-center text-xs uppercase tracking-[0.16em] text-muted"
                  >
                    Skip
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Scrim({ children, variant }: { children: ReactNode; variant?: "victory" | "defeat" }) {
  const resultClass = variant ? ` cn-result-scrim cn-result-${variant}` : "";
  return (
    <div
      className={`absolute inset-0 z-20 flex max-h-[var(--app-height,100dvh)] flex-col items-center justify-start gap-5 overflow-y-auto overscroll-y-contain bg-bg/92 px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))] text-center${resultClass}`}
    >
      <div
        className={`my-auto flex w-full max-w-sm flex-col items-center gap-5 py-6${variant ? " cn-result-panel" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}

function ResultSigil({ variant }: { variant: "victory" | "defeat" }) {
  return (
    <div className={`cn-result-sigil cn-result-sigil-${variant}`} aria-hidden="true">
      <span className="cn-result-sigil-core" />
      <span className="cn-result-sigil-spire cn-result-sigil-spire-l" />
      <span className="cn-result-sigil-spire cn-result-sigil-spire-c" />
      <span className="cn-result-sigil-spire cn-result-sigil-spire-r" />
    </div>
  );
}

function NightReport({
  stats,
  payout,
  night,
  bestNight,
  unlock,
  score,
  place,
  daily,
}: {
  stats: NightStats;
  payout?: number;
  night: number;
  bestNight: number;
  unlock?: { night: number; title: string } | null;
  score?: number | null;
  place?: string | null;
  daily?: boolean;
}) {
  const bossPct = Math.round(stats.bossLeft * 100);
  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-3">
      <p className="text-sm text-muted">{daily ? "Today’s curse" : `Night ${night}`}</p>
      <dl className="grid w-full grid-cols-3 gap-2">
        <Stat label="Fallen" value={String(stats.kills)} />
        <Stat label="Combo" value={String(stats.combo)} />
        <Stat label="Crowns" value={String(payout ?? stats.gold)} />
      </dl>
      {score != null ? <p className="text-sm text-gold-2">Score {score}</p> : null}
      {place ? <p className="text-sm text-muted">{place}</p> : null}
      {stats.bossKill ? (
        <p className="text-sm text-gold-2">Boss defeated · +140 score</p>
      ) : stats.bossRetreated ? (
        <p className="text-sm text-muted">The Lord retreats. You held the night.</p>
      ) : stats.bossSeen && !stats.won && stats.bossLeft > 0 ? (
        <p className="text-sm text-ember">Boss life remaining · {bossPct}%</p>
      ) : null}
      {daily ? null : <p className="text-xs text-muted">Best night {bestNight}</p>}
      {unlock && !stats.won && !daily ? (
        <p className="text-xs text-gold-2">
          Next unlock · Night {unlock.night} · {unlock.title}
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface px-2 py-3">
      <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className="mt-1 font-display text-2xl tabular-nums">{value}</dd>
    </div>
  );
}

function SolidBtn({
  children,
  onClick,
  id,
}: {
  children: ReactNode;
  onClick: () => void;
  id?: string;
}) {
  return (
    <button
      id={id}
      {...pressProps(onClick)}
      className="pointer-events-auto relative z-30 h-12 min-h-12 shrink-0 w-full rounded-lg bg-fg text-sm font-medium text-bg transition-transform duration-150 active:scale-[0.98] [@media(max-height:920px)]:h-11 [@media(max-height:920px)]:min-h-11"
    >
      {children}
    </button>
  );
}

function SolidGold({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      {...pressProps(onClick)}
      disabled={disabled}
      className="pointer-events-auto relative z-30 h-12 min-h-12 shrink-0 w-full rounded-lg bg-gold text-sm font-medium text-bg transition-transform duration-150 active:scale-[0.98] disabled:opacity-60 [@media(max-height:920px)]:h-11 [@media(max-height:920px)]:min-h-11"
    >
      {children}
    </button>
  );
}

function GhostBtn({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      {...pressProps(onClick)}
      disabled={disabled}
      className="pointer-events-auto relative z-30 h-12 min-h-12 shrink-0 w-full rounded-lg border border-line bg-surface text-sm text-fg transition-transform duration-150 active:scale-[0.98] disabled:opacity-60 [@media(max-height:920px)]:h-11 [@media(max-height:920px)]:min-h-11"
    >
      {children}
    </button>
  );
}
