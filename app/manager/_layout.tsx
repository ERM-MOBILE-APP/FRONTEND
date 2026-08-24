import React from 'react';
import { Stack } from 'expo-router';

/**
 * Manager section stack. Header is hidden — each screen renders its own
 * green ManagerHeader (matches the rest of the app's look). Screens:
 *   index         — Manager hub (team + section cards)
 *   approvals     — Leave/Permission + Allowance approvals
 *   attendance    — Team monthly attendance report
 *   tracking      — Team live locations
 *   announcements — Team announcements
 */
export default function ManagerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="team" />
      <Stack.Screen name="approvals" />
      <Stack.Screen name="attendance" />
      <Stack.Screen name="tracking" />
      <Stack.Screen name="announcements" />
    </Stack>
  );
}
