import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, runOnJS, useAnimatedStyle,
  useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { resolveConfig } from './config';
import { createRoute, samplePose, totalDuration, validLayout, type Pose } from './motion';
import type { Size, SpriteFrame, SpriteKind, Targets, WoodpeckerConfig } from './types';

const sheets: Record<SpriteKind, { source: ImageSourcePropType; width: number; height: number }> = {
  flight: { source: require('./assets/flight.png'), width: 2172, height: 724 },
  turn: { source: require('./assets/turn.png'), width: 2172, height: 724 },
  peck: { source: require('./assets/peck.png'), width: 1983, height: 793 },
};

export type WoodpeckerIntroProps = {
  size: Size;
  targets: Targets;
  enabled: boolean;
  /** 0 = idle. Increment to start/restart, including after completion. */
  startSignal: number;
  /** Only an explicitly requested replay may override the system preference. */
  manualPlayback?: boolean;
  onComplete?: () => void;
  config?: Partial<WoodpeckerConfig>;
};

function Sprite({ kind, index, frame, config, pose, visible, onLoad }: {
  kind: SpriteKind; index: number; frame: SpriteFrame; config: WoodpeckerConfig;
  pose: SharedValue<Pose>; visible: SharedValue<number>; onLoad: () => void;
}) {
  const sheet = sheets[kind];
  // One shared scale per sheet, so neither the feet nor the body resize between frames.
  const scale = config.birdSize / (kind === 'turn' ? 350 : 430)
    * (kind === 'peck' ? config.peckScale : 1);
  const width = frame.width * scale;
  const height = frame.height * scale;
  const style = useAnimatedStyle(() => {
    const p = pose.value;
    const anchorX = (p.facing === 1 ? frame.anchor.x : frame.width-frame.anchor.x) * scale;
    return {
      opacity: visible.value && p.kind === kind && p.frame === index ? 1 : 0,
      transform: [
        { translateX: p.x - anchorX }, { translateY: p.y - frame.anchor.y * scale },
        { scaleX: p.facing },
      ],
    };
  });
  return (
    <Animated.View style={[styles.sprite, { width, height }, style]}>
      <Image source={sheet.source} onLoad={onLoad} fadeDuration={0} resizeMode="stretch"
        style={{ position: 'absolute', left: -frame.x*scale, top: -frame.y*scale,
          width: sheet.width*scale, height: sheet.height*scale }} />
    </Animated.View>
  );
}

/** Standalone, touch-through overlay. Owns no navigation, GPS or settings. */
export function WoodpeckerIntro({ size, targets, enabled, startSignal, onComplete,
  manualPlayback = false, config: overrides }: WoodpeckerIntroProps) {
  const config = useMemo(() => resolveConfig(overrides), [overrides]);
  const layoutValid = validLayout(size, targets);
  const route = useMemo(() => createRoute(size, targets, config), [
    size.width, size.height, targets.gps.x, targets.gps.y, targets.gps.width, targets.gps.height,
    targets.plus.x, targets.plus.y, targets.plus.width, targets.plus.height, config,
  ]);
  const elapsed = useSharedValue(0);
  const visible = useSharedValue(0);
  const pose = useDerivedValue(() => samplePose(elapsed.value, route, config));
  const [loaded, setLoaded] = useState(0);
  const loadedKeys = useRef(new Set<string>());
  const expected = config.frames.flight.length + config.frames.turn.length + config.frames.peck.length;
  const markLoaded = useCallback((key: string) => {
    if (loadedKeys.current.has(key)) return;
    loadedKeys.current.add(key);
    setLoaded(loadedKeys.current.size);
  }, []);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const generation = useRef(0);
  const completed = useRef<number | null>(null);
  const completion = useRef(onComplete);
  completion.current = onComplete;
  const allowed = useRef(false);
  allowed.current = enabled && foreground;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  const finish = useCallback((run: number, signal: number) => {
    if (!allowed.current || AppState.currentState !== 'active'
      || generation.current !== run || completed.current === signal) return;
    completed.current = signal;
    completion.current?.();
  }, []);

  useEffect(() => {
    const run = ++generation.current;
    cancelAnimation(elapsed);
    visible.value = 0;
    if (!enabled || !foreground || !layoutValid || loaded < expected
      || startSignal <= 0 || completed.current === startSignal) return;
    elapsed.value = 0;
    visible.value = 1;
    elapsed.value = withTiming(totalDuration(config), {
      duration: totalDuration(config), easing: Easing.linear,
      reduceMotion: manualPlayback ? ReduceMotion.Never : ReduceMotion.System,
    }, finished => {
      if (finished) {
        visible.value = 0;
        runOnJS(finish)(run, startSignal);
      }
    });
    return () => {
      generation.current++;
      cancelAnimation(elapsed);
      visible.value = 0;
    };
  }, [enabled, foreground, layoutValid, loaded, expected, startSignal, manualPlayback, config, route,
    elapsed, visible, finish]);

  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.overlay, { width: size.width, height: size.height }]}>
      {(['flight', 'turn', 'peck'] as const).flatMap(kind => config.frames[kind].map((frame, index) => (
        <Sprite key={`${kind}-${index}`} kind={kind} index={index} frame={frame} config={config}
          pose={pose} visible={visible} onLoad={() => markLoaded(`${kind}-${index}`)} />
      )))}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, top: 0, overflow: 'visible', zIndex: 20, elevation: 10 },
  sprite: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
});
