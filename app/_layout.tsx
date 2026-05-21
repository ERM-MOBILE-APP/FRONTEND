import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)/login" />
      <Stack.Screen
        name="(auth)/email-verify"
        options={{ presentation: 'card', animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="(auth)/otp"
        options={{ presentation: 'card', animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="(auth)/new-password"
        options={{ presentation: 'card', animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="(auth)/success"
        options={{
          presentation: 'card',
          animation: 'fade',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="notifications" options={{ presentation: 'card' }} />
    </Stack>
  );
}
