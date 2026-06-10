import { Stack } from 'expo-router'

// Minimal root layout — Session 1 scaffold. Screens get fleshed out in later
// migration sessions.
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
