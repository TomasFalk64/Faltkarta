import AsyncStorage from '@react-native-async-storage/async-storage';

// Separate from settings:v1: GPS/settings saves must not rearm a completed intro.
const LEGACY_KEY = 'woodpeckerIntroPending:v1';
const SEQUENTIAL_KEY = 'woodpeckerIntroProgress:v2';
const KEY = 'woodpeckerIntroProgress:v3';
export type AnimationStage = 'mapList' | 'artfynd';
export type AnimationProgress = {
  mapListShown: boolean; artfyndShown: boolean; enabled: boolean;
  manualPlayback: boolean; run: number;
};
export const animationCheckboxChecked = (progress: AnimationProgress) =>
  progress.enabled && !progress.mapListShown && !progress.artfyndShown;
export const shouldShowAnimation = (progress: AnimationProgress | null, stage: AnimationStage) =>
  !!progress?.enabled && !(stage === 'mapList' ? progress.mapListShown : progress.artfyndShown);
let current: AnimationProgress | null = null;
const listeners = new Set<() => void>();
let writes: Promise<void> = Promise.resolve();

export const getAnimationProgress = () => current;
export function subscribeAnimationProgress(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(progress: AnimationProgress) {
  current = progress;
  listeners.forEach(listener => listener());
}
async function readProgress(): Promise<AnimationProgress> {
  const raw = await AsyncStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.mapListShown === 'boolean' && typeof parsed.artfyndShown === 'boolean' && typeof parsed.enabled === 'boolean'
        && typeof parsed.manualPlayback === 'boolean' && Number.isSafeInteger(parsed.run) && parsed.run > 0) return parsed;
    } catch { /* Fall back to the previous preference. */ }
  }
  const sequential = await AsyncStorage.getItem(SEQUENTIAL_KEY);
  if (sequential) {
    try {
      const parsed = JSON.parse(sequential);
      if (['mapList', 'artfynd', 'done'].includes(parsed.stage)) return {
        mapListShown: parsed.stage !== 'mapList', artfyndShown: parsed.stage === 'done',
        enabled: parsed.stage !== 'done', manualPlayback: parsed.manualPlayback === true,
        run: Number.isSafeInteger(parsed.run) && parsed.run > 0 ? parsed.run : 1,
      };
    } catch { /* Fall back to the original preference. */ }
  }
  const enabled = (await AsyncStorage.getItem(LEGACY_KEY)) !== 'false';
  return { mapListShown: false, artfyndShown: false, enabled, manualPlayback: false, run: 1 };
}
export function loadAnimationProgress(): Promise<AnimationProgress> {
  const read = writes.then(async () => {
    const progress = await readProgress();
    publish(progress);
    return progress;
  });
  writes = read.then(() => {}, () => {});
  return read;
}
export async function loadAnimationPending(): Promise<boolean> {
  return animationCheckboxChecked(await loadAnimationProgress());
}

function updateProgress(update: (previous: AnimationProgress) => AnimationProgress): Promise<void> {
  const write = writes.then(async () => {
    const previous = await readProgress();
    const next = update(previous);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    publish(next);
  });
  writes = write.catch(() => {});
  return write;
}
export function saveAnimationPending(pending: boolean, manualPlayback = false): Promise<void> {
  return updateProgress(previous => ({
    ...previous, ...(pending ? { mapListShown: false, artfyndShown: false } : {}),
    enabled: pending, manualPlayback: pending && manualPlayback, run: previous.run + 1,
  }));
}
export function completeAnimationStage(stage: AnimationStage, run: number): Promise<void> {
  return updateProgress(previous => !shouldShowAnimation(previous, stage) || previous.run !== run ? previous : {
    ...previous, [stage === 'mapList' ? 'mapListShown' : 'artfyndShown']: true,
  });
}
