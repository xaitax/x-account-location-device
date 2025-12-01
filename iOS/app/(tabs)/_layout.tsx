import React from 'react';
import { Stack } from 'expo-router';

export default function TabLayout() {
  // Single-screen layout - no tabs needed for X-Posed
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'none',
      }}
    >
      <Stack.Screen key="home" name="(home)" />
    </Stack>
  );
}
