import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  Modal,
  Pressable,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { profileAPI } from '../../services/api';

type UserProfile = {
  _id?: string;
  userId?: string;
  name?: string;
  designation?: string;
  email?: string;
  phone?: string;
  dob?: string;
  gender?: string;
  bloodGroup?: string;
  photoUrl?: string;
  address?: string;
};

// What we show for a missing/empty field. Keeping this in one place so
// we never accidentally render a hard-coded placeholder like the previous
// "20-09-2005" / "Bhvhjh@Gmail.Com" / "+91 9988776655" again.
const EMPTY = 'Not set';
const show = (v?: string) => (v && String(v).trim()) ? String(v).trim() : EMPTY;

export default function ProfileScreen() {
  const [user, setUser] = useState<UserProfile>({});
  const [editing, setEditing] = useState<keyof UserProfile | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const loadProfile = useCallback(async () => {
    // Try local first for fast paint
    try {
      const cached = await AsyncStorage.getItem('user');
      if (cached) setUser(JSON.parse(cached));
    } catch {}

    try {
      const res = await profileAPI.getProfile();
      const data = res?.data || {};
      setUser(data);
      AsyncStorage.setItem('user', JSON.stringify(data)).catch(() => {});
    } catch {
      // ignore — show cached/seeded data
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleLogout = async () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.multiRemove(['token', 'user']);
          router.replace('/(auth)/login' as any);
        },
      },
    ]);
  };

  const openEdit = (field: keyof UserProfile) => {
    setEditing(field);
    setEditValue(String(user[field] || ''));
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload: any = { [editing]: editValue.trim() };
      const res = await profileAPI.updateProfile(payload);
      if (res?.data?.user) {
        setUser(res.data.user);
        AsyncStorage.setItem('user', JSON.stringify(res.data.user)).catch(() => {});
      } else {
        setUser((u) => ({ ...u, [editing]: editValue.trim() }));
      }
      setEditing(null);
    } catch (err: any) {
      Alert.alert(
        'Error',
        err?.response?.data?.message || 'Could not update'
      );
    } finally {
      setSaving(false);
    }
  };

  // Derived from the real name — no hard-coded "V" fallback. Shows "?"
  // only if the user has somehow logged in without a name on record.
  const initial = (user.name && user.name.trim()[0]?.toUpperCase()) || '?';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* GREEN HEADER */}
        <View style={styles.greenHeader} />

        {/* AVATAR */}
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            {user.photoUrl ? (
              <Image source={{ uri: user.photoUrl }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarInitial}>{initial}</Text>
            )}
          </View>
        </View>

        {/* NAME + DESIGNATION */}
        <Text style={styles.name}>{user.name || EMPTY}</Text>
        <Text style={styles.designation}>
          {show(user.designation).toUpperCase()}
        </Text>

        {/* INFO CARDS — every value is whatever's stored in MongoDB.
            "Not set" means HR / the user hasn't filled it in yet. Tap any
            row to edit (Employee ID is read-only). */}
        <View style={styles.infoList}>
          <InfoRow
            label="Employee ID"
            value={show(user.userId)}
            editable={false}
          />
          <InfoRow
            label="Mobile No"
            value={show(user.phone)}
            onPress={() => openEdit('phone')}
          />
          <InfoRow
            label="Email ID"
            value={show(user.email)}
            onPress={() => openEdit('email')}
          />
          <InfoRow
            label="DOB"
            value={show(user.dob)}
            onPress={() => openEdit('dob')}
          />
          <InfoRow
            label="Blood Group"
            value={show(user.bloodGroup)}
            onPress={() => openEdit('bloodGroup')}
          />
          <InfoRow
            label="Gender"
            value={show(user.gender)}
            onPress={() => openEdit('gender')}
          />
          <InfoRow
            label="Designation"
            value={show(user.designation)}
            onPress={() => openEdit('designation')}
          />
          <InfoRow
            label="Address"
            value={show(user.address)}
            onPress={() => openEdit('address')}
          />
        </View>

        {/* LOG OUT */}
        <TouchableOpacity
          style={styles.logoutRow}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Text style={styles.logoutText}>Log out</Text>
          <Feather name="log-out" size={16} color="#F44336" style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      </ScrollView>

      {/* EDIT MODAL */}
      <Modal visible={!!editing} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setEditing(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>
              Edit {editing ? prettyLabel(editing) : ''}
            </Text>
            <TextInput
              value={editValue}
              onChangeText={setEditValue}
              autoFocus
              placeholder={`Enter ${editing ? prettyLabel(editing) : ''}`}
              placeholderTextColor="#aaa"
              style={styles.editInput}
            />
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setEditing(null)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={saveEdit}
                disabled={saving}
              >
                <Text style={styles.saveBtnText}>
                  {saving ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function prettyLabel(key: string) {
  const map: Record<string, string> = {
    phone:       'Mobile No',
    email:       'Email ID',
    dob:         'DOB',
    bloodGroup:  'Blood Group',
    gender:      'Gender',
    name:        'Name',
    designation: 'Designation',
    address:     'Address',
  };
  return map[key] || key;
}

function InfoRow({
  label,
  value,
  onPress,
  editable = true,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  editable?: boolean;
}) {
  const content = (
    <View style={styles.infoCard}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
  if (!editable || !onPress) return content;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      {content}
    </TouchableOpacity>
  );
}

const GREEN = '#4CAF50';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

  greenHeader: {
    backgroundColor: GREEN,
    height: 140,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },

  avatarWrap: {
    alignItems: 'center',
    marginTop: -65,
  },
  avatar: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 6,
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontSize: 50,
    color: '#2E7D32',
    fontWeight: '800',
  },

  name: {
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: '#1A1A1A',
    marginTop: 12,
  },
  designation: {
    textAlign: 'center',
    fontSize: 12,
    color: '#2E7D32',
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 4,
    marginBottom: 18,
  },

  infoList: {
    paddingHorizontal: 16,
  },
  infoCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  infoLabel: { fontSize: 12, color: '#777', fontWeight: '500' },
  infoValue: { fontSize: 14, color: '#1A1A1A', fontWeight: '700' },

  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 22,
    marginTop: 8,
  },
  logoutText: {
    color: '#F44336',
    fontSize: 14,
    fontWeight: '700',
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    maxHeight: '60%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    marginBottom: 12,
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#1A1A1A',
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 22,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  cancelBtn: {
    backgroundColor: '#F0F0F0',
  },
  cancelBtnText: { color: '#1A1A1A', fontWeight: '700', fontSize: 13 },
  saveBtn: {
    backgroundColor: GREEN,
  },
  saveBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});
