import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { profileAPI } from '../../services/api';
import { Colors } from '../../constants/Colors';

export default function ProfileScreen() {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState<any>({});

  useEffect(() => { loadProfile(); }, []);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const res = await profileAPI.getProfile();
      setProfile(res.data);
      setEditData({
        name: res.data.name,
        email: res.data.email,
        phone: res.data.phone,
        dob: res.data.dob,
        gender: res.data.gender,
        designation: res.data.designation,
      });
    } catch (err) {
      Alert.alert('Error', 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await profileAPI.updateProfile(editData);
      setProfile({ ...profile, ...res.data.user });
      setEditMode(false);
      Alert.alert('✅ Success', 'Profile updated!');
    } catch {
      Alert.alert('Error', 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout', style: 'destructive', onPress: async () => {
          await AsyncStorage.clear();
          router.replace('/(auth)/login');
        }
      }
    ]);
  };

  const getInitials = (name: string) =>
    name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'U';

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.headerCard}>
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(profile?.name)}</Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.userName}>{profile?.name}</Text>
              <Text style={styles.userId}>Employee ID: #{profile?.userId}</Text>
              <View style={styles.statusBadge}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>{profile?.status} • {profile?.workType}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => setEditMode(true)} style={styles.editIconBtn}>
              <Ionicons name="pencil-outline" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
          <Text style={styles.designation}>{profile?.designation}</Text>
        </View>

        {/* Balance Cards */}
        <View style={styles.balanceRow}>
          <View style={[styles.balanceCard, { backgroundColor: '#1a237e' }]}>
            <View style={styles.balanceCircle}>
              <Text style={styles.balanceNum}>{profile?.leaveBalance ?? 0}</Text>
            </View>
            <Text style={styles.balanceLabel}>Leave Balance</Text>
          </View>
          <View style={[styles.balanceCard, { backgroundColor: '#6a1b9a' }]}>
            <View style={[styles.balanceCircle, { borderColor: '#ce93d8' }]}>
              <Text style={styles.balanceNum}>{profile?.permissionBalance ?? 0}</Text>
            </View>
            <Text style={styles.balanceLabel}>Permission Balance</Text>
          </View>
        </View>

        {/* Personal Info */}
        <View style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Ionicons name="person-outline" size={18} color={Colors.primary} />
            <Text style={styles.infoTitle}>Personal Info</Text>
          </View>
          <View style={styles.infoGrid}>
            {[
              { label: 'Full Name', value: profile?.name },
              { label: 'DOB', value: profile?.dob },
              { label: 'Email Address', value: profile?.email },
              { label: 'Gender', value: profile?.gender },
              { label: 'Phone', value: profile?.phone },
              { label: 'Designation', value: profile?.designation },
            ].map((item, i) => (
              <View key={i} style={styles.infoItem}>
                <Text style={styles.infoLabel}>{item.label}</Text>
                <Text style={styles.infoValue}>{item.value || '—'}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#F44336" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>

        <View style={{ height: 30 }} />
      </ScrollView>

      {/* Edit Modal */}
      <Modal visible={editMode} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setEditMode(false)}>
                <Ionicons name="close-outline" size={26} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {[
                { label: 'Full Name', key: 'name' },
                { label: 'Designation', key: 'designation' },
                { label: 'Email Address', key: 'email' },
                { label: 'Phone', key: 'phone' },
                { label: 'Date of Birth', key: 'dob' },
                { label: 'Gender', key: 'gender' },
              ].map(field => (
                <View key={field.key} style={styles.modalField}>
                  <Text style={styles.modalLabel}>{field.label}</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={editData[field.key]}
                    onChangeText={val => setEditData({ ...editData, [field.key]: val })}
                    placeholder={`Enter ${field.label}`}
                    placeholderTextColor={Colors.gray}
                  />
                </View>
              ))}
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveText}>Save Changes</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: Colors.gray },
  headerCard: { backgroundColor: Colors.primaryDark, padding: 20, paddingTop: 56 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  avatarText: { fontSize: 20, fontWeight: '800', color: Colors.primaryDark },
  headerInfo: { flex: 1 },
  userName: { color: '#fff', fontSize: 18, fontWeight: '700' },
  userId: { color: '#c8e6c9', fontSize: 12, marginTop: 2 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary,
    borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-start', marginTop: 6,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#69f0ae', marginRight: 4 },
  statusText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  editIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center',
  },
  designation: { color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 4 },
  balanceRow: { flexDirection: 'row', gap: 12, padding: 16 },
  balanceCard: { flex: 1, borderRadius: 14, padding: 20, alignItems: 'center', elevation: 4 },
  balanceCircle: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 3,
    borderColor: '#7986cb', justifyContent: 'center', alignItems: 'center', marginBottom: 10,
  },
  balanceNum: { color: '#fff', fontSize: 20, fontWeight: '800' },
  balanceLabel: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  infoCard: {
    backgroundColor: '#fff', marginHorizontal: 16,
    borderRadius: 14, padding: 16, elevation: 2,
  },
  infoHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  infoTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginLeft: 8 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  infoItem: { width: '50%', marginBottom: 16, paddingRight: 8 },
  infoLabel: { fontSize: 11, color: Colors.gray, marginBottom: 4 },
  infoValue: { fontSize: 13, fontWeight: '600', color: Colors.text },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    margin: 16, padding: 14, backgroundColor: '#fff',
    borderRadius: 12, borderWidth: 1, borderColor: '#FFCDD2', gap: 8, elevation: 1,
  },
  logoutText: { color: '#F44336', fontWeight: '700', fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#fff', borderTopLeftRadius: 24,
    borderTopRightRadius: 24, padding: 24, maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  modalField: { marginBottom: 14 },
  modalLabel: { fontSize: 12, color: Colors.gray, marginBottom: 6, fontWeight: '600' },
  modalInput: {
    borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8,
    padding: 12, fontSize: 14, color: Colors.text,
  },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: 10,
    padding: 16, alignItems: 'center', marginTop: 8, marginBottom: 20,
  },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});