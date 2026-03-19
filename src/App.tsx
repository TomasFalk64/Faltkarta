import React, { useEffect } from "react";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { LogBox } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { MapListScreen } from "./screens/MapListScreen";
import { MapScreen } from "./screens/MapScreen";
import { ExportScreen } from "./screens/ExportScreen";
import { RootStackParamList } from "./navigation/types";
import { GpsProvider } from "./contexts/GpsContext";

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#f4f0e7",
    card: "#f4f0e7",
    text: "#172121",
    primary: "#005f73",
    border: "#c8b79f",
  },
};

export default function App() {
  useEffect(() => {
    LogBox.ignoreLogs([
      "[Reanimated] Reduced motion setting is enabled on this device.",
    ]);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <GpsProvider>
          <NavigationContainer theme={theme}>
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: "#f4f0e7" },
              headerTintColor: "#172121",
              headerTitleStyle: { fontWeight: "700" },
            }}
          >
            <Stack.Screen
              name="MapList"
              component={MapListScreen}
              options={{ title: "Fältkarta" }}
            />
            <Stack.Screen
              name="Map"
              component={MapScreen}
              options={{ title: "Karta" }}
              //options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Export"
              component={ExportScreen}
              options={{ title: "Export" }}
            />
          </Stack.Navigator>
        </NavigationContainer>
        </GpsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
