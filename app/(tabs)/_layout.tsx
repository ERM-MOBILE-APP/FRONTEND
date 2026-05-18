import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const ACTIVE = '#FFFFFF';
const INACTIVE = 'rgba(255,255,255,0.7)';
const GREEN = '#4CAF50';

export default function TabLayout() {
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
          height: 72,
          paddingBottom: 8,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <Ionicons name="home-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="leave"
        options={{
          title: 'Leave',
          tabBarIcon: ({ color }) => (
            <Ionicons name="add-circle-outline" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="allowance"
        options={{
          title: 'Allowance',
          tabBarIcon: ({ color }) => (
            <Ionicons name="briefcase-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="payslip"
        options={{
          title: 'Pay Slip',
          tabBarIcon: ({ color }) => (
            <Ionicons name="receipt-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <Ionicons name="person-circle-outline" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
