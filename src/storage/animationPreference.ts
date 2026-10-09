import AsyncStorage from '@react-native-async-storage/async-storage';

// Separate from settings:v1: GPS/settings saves must not rearm a completed intro.
const KEY = 'woodpeckerIntroPending:v1';
let writes: Promise<void> = Promise.resolve();

export async function loadAnimationPending(): Promise<boolean> {
  await writes;
  return (await AsyncStorage.getItem(KEY)) !== 'false';
}

export function saveAnimationPending(pending: boolean): Promise<void> {
  const write = writes.then(() => AsyncStorage.setItem(KEY, JSON.stringify(pending)));
  writes = write.catch(() => {});
  return write;
}
