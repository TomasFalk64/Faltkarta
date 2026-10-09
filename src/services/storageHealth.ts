import { Alert, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

let warnedLevel = 0;
let checking = false;

export async function checkDatabaseStorage(): Promise<boolean> {
  if (Platform.OS !== "android" || checking) return false;
  checking = true;
  try {
    const storage = requireOptionalNativeModule<{ getUsedDatabaseBytes(): Promise<number> }>("FaltkartaStorage");
    if (!storage) return false; // Older development clients need rebuilding.
    const bytes = await storage.getUsedDatabaseBytes();
    const mb = bytes / (1024 * 1024);
    const level = mb >= 28 ? 2 : mb >= 25 ? 1 : 0;
    if (level <= warnedLevel) {
      warnedLevel = level;
      return false;
    }
    warnedLevel = level;
    Alert.alert(
      level === 2 ? "Databasen är nästan full" : "Databasen börjar bli full",
      `Appens databas använder ${mb.toFixed(1).replace(".", ",")} av 30 MB. ` +
      (level === 2 ? "Det finns mycket lite plats kvar för nya observationer. " : "") +
      "Exportera och kontrollera det du vill behålla. Rensa sedan gamla observationer via kartans meny → Radera observationer. Foton och kartbilder lagras separat."
    );
    return true;
  } catch {
    // A failed diagnostic must never prevent saving or exporting observations.
    return false;
  } finally {
    checking = false;
  }
}

export function storageErrorMessage(error: unknown): string {
  const detail = String(error);
  if (/SQLITE_FULL|database or disk is full|ENOSPC|No space left/i.test(detail)) {
    return "Appens databas eller telefonens lagring är full. Exportera och kontrollera dina uppgifter och rensa sedan gamla observationer via kartans meny. Kontrollera också telefonens lediga lagring. Rensa inte appdata och avinstallera inte appen.\n\n" + detail;
  }
  return detail;
}
