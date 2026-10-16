import { useEffect, useSyncExternalStore } from 'react';
import { getAnimationProgress, loadAnimationProgress, subscribeAnimationProgress } from '../storage/animationPreference';

export function useAnimationProgress() {
  const progress = useSyncExternalStore(subscribeAnimationProgress, getAnimationProgress, getAnimationProgress);
  useEffect(() => {
    void loadAnimationProgress().catch(error => console.error('Kunde inte läsa animationsinställningen:', error));
  }, []);
  return progress;
}
