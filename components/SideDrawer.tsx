import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Modal,
  Pressable,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';

type Props = {
  visible: boolean;
  onClose: () => void;
  user?: {
    name?: string;
    designation?: string;
    photoUrl?: string;
  };
};

type MenuItem = {
  label: string;
  icon: React.ReactNode;
  route: string;
};

const { width: SCREEN_W } = Dimensions.get('window');
const DRAWER_W = Math.min(310, SCREEN_W * 0.82);

export default function SideDrawer({ visible, onClose, user }: Props) {
  const slide = useRef(new Animated.Value(-DRAWER_W)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : -DRAWER_W,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  const go = (route: string) => {
    onClose();
    setTimeout(() => router.push(route as any), 60);
  };

  const menu: MenuItem[] = [
    {
      label: 'Profile',
      icon: <Ionicons name="person-outline" size={20} color="#1A1A1A" />,
      route: '/(tabs)/profile',
    },
    {
      label: 'Leave',
      icon: <Ionicons name="add-circle-outline" size={20} color="#1A1A1A" />,
      route: '/(tabs)/leave',
    },
    {
      label: 'Attendance',
      icon: (
        <MaterialCommunityIcons name="account-check-outline" size={20} color="#1A1A1A" />
      ),
      route: '/(tabs)/attendance',
    },
    {
      label: 'Allowance',
      icon: <Feather name="credit-card" size={18} color="#1A1A1A" />,
      route: '/(tabs)/allowance',
    },
    {
      label: 'Pay Slip',
      icon: <Ionicons name="receipt-outline" size={20} color="#1A1A1A" />,
      route: '/(tabs)/payslip',
    },
    {
      label: 'Complaint',
      icon: (
        <MaterialCommunityIcons name="account-question-outline" size={20} color="#1A1A1A" />
      ),
      route: '/complaint',
    },
    {
      label: 'Announcement',
      icon: <Ionicons name="megaphone-outline" size={20} color="#1A1A1A" />,
      route: '/(tabs)/',
    },
  ];

  const initial = (user?.name && user.name[0]) || 'V';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <Animated.View
          style={[
            styles.drawer,
            { width: DRAWER_W, transform: [{ translateX: slide }] },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.avatar}>
              {user?.photoUrl ? (
                <Image source={{ uri: user.photoUrl }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarInitial}>{initial}</Text>
              )}
            </View>
            <Text style={styles.name}>{user?.name || 'Vijay'}</Text>
            <Text style={styles.role}>{user?.designation || 'UX/UI Designer'}</Text>
          </View>

          <View style={styles.divider} />

          {/* Menu */}
          <View style={styles.menu}>
            {menu.map((m) => (
              <TouchableOpacity
                key={m.label}
                style={styles.menuItem}
                onPress={() => go(m.route)}
                activeOpacity={0.7}
              >
                <View style={styles.menuIcon}>{m.icon}</View>
                <Text style={styles.menuLabel}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawer: {
    backgroundColor: '#FFFFFF',
    height: '100%',
    paddingTop: 60,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 2, height: 0 },
    shadowRadius: 12,
    elevation: 12,
  },

  header: {
    paddingHorizontal: 22,
    paddingBottom: 18,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 14,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontSize: 26,
    color: '#2E7D32',
    fontWeight: '800',
  },
  name: { fontSize: 17, fontWeight: '800', color: '#1A1A1A' },
  role: { fontSize: 12, color: '#8A8A8A', marginTop: 2 },

  divider: {
    height: 1,
    backgroundColor: '#EFEFEF',
    marginHorizontal: 22,
  },

  menu: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 6,
  },
  menuIcon: {
    width: 30,
    alignItems: 'center',
    marginRight: 8,
  },
  menuLabel: {
    fontSize: 15,
    color: '#1A1A1A',
    fontWeight: '600',
  },
});
