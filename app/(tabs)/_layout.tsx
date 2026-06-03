import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ACTIVE = '#FFFFFF';
const INACTIVE = 'rgba(255,255,255,0.7)';
const GREEN = '#4CAF50';

export default function TabLayout() {
  // Bottom inset = height of the system gesture / navigation bar. On
  // gesture-navigation phones (most new Android devices) this is ~30 px;
  // on classic 3-button-nav phones it's 0. Adding it to the tab bar's
  // padding + height keeps the gesture pill in its own band UNDER the
  // tab bar, so Home / Attendance / Leave / Allowance / Profile labels
  // are never sliced by the system overlay (the issue HR reported in
  // the Jun 2026 prod screenshot).
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginBottom: 6 },
        tabBarStyle: {
          backgroundColor: GREEN,
          borderTopWidth: 0,
          elevation: 12,
          height: 64 + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <View style={{ width: 44, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: focused ? 'rgba(255,255,255,0.18)' : 'transparent' }}>
              <Ionicons name="home-outline" size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Attendance',
          tabBarIcon: ({ color, focused }) => (
            <View style={{ width: 44, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: focused ? 'rgba(255,255,255,0.18)' : 'transparent' }}>
              <Ionicons name="person-outline" size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="leave"
        options={{
          title: 'Leave',
          tabBarIcon: ({ color, focused }) => (
            <View style={{ width: 44, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: focused ? 'rgba(255,255,255,0.18)' : 'transparent' }}>
              <Ionicons name="add-circle-outline" size={28} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="allowance"
        options={{
          title: 'Allowance',
          tabBarIcon: ({ color, focused }) => (
            <View style={{ width: 44, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: focused ? 'rgba(255,255,255,0.18)' : 'transparent' }}>
              <Ionicons name="briefcase-outline" size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <View style={{ width: 44, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: focused ? 'rgba(255,255,255,0.18)' : 'transparent' }}>
              <Ionicons name="person-circle-outline" size={24} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="payslip"
        options={{
          href: null,
          title: 'Pay Slip',
        }}
      />
    </Tabs>
  );
}
