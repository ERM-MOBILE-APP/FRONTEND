import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  Modal,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/Colors';
import { leaveAPI } from '../../services/api';

type TabKey = 'apply' | 'permission';

const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Unpaid Leave'];
const PERMISSION_TYPES = ['Personal', 'Medical', 'Official', 'Other'];

export default function LeaveScreen() {
  const [activeTab, setActiveTab] = useState<TabKey>('apply');

  // -------- Apply Leave state --------
  const [leaveType, setLeaveType] = useState('Casual Leave');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [leaveReason, setLeaveReason] = useState('');

  // -------- Permission state --------
  const [permissionType, setPermissionType] = useState('Casual Leave');
  const [permissionDate, setPermissionDate] = useState('11/02/2023');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [permissionReason, setPermissionReason] = useState('');

  // -------- Dropdown modal --------
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownTarget, setDropdownTarget] = useState<'leave' | 'permission'>('leave');

  const [submitting, setSubmitting] = useState(false);

  const openDropdown = (target: 'leave' | 'permission') => {
    setDropdownTarget(target);
    setDropdownOpen(true);
  };

  const pickOption = (val: string) => {
    if (dropdownTarget === 'leave') setLeaveType(val);
    else setPermissionType(val);
    setDropdownOpen(false);
  };

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      if (activeTab === 'apply') {
        if (!startDate || !endDate || !leaveReason) {
          Alert.alert('Missing info', 'Please fill all fields');
          setSubmitting(false);
          return;
        }
        await leaveAPI.applyLeave({
          leaveType,
          startDate,
          endDate,
          isHalfDay,
          reason: leaveReason,
        });
        Alert.alert('Success', 'Leave request submitted successfully');
        setStartDate('');
        setEndDate('');
        setIsHalfDay(false);
        setLeaveReason('');
      } else {
        if (!permissionDate || !startTime || !endTime || !permissionReason) {
          Alert.alert('Missing info', 'Please fill all fields');
          setSubmitting(false);
          return;
        }
        await leaveAPI.applyPermission({
          permissionType,
          date: permissionDate,
          startTime,
          endTime,
          reason: permissionReason,
        });
        Alert.alert('Success', 'Permission request submitted successfully');
        setStartTime('');
        setEndTime('');
        setPermissionReason('');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Tabs */}
      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={styles.tabItem}
          activeOpacity={0.7}
          onPress={() => setActiveTab('apply')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'apply' && styles.tabTextActive,
            ]}
          >
            Apply Leave
          </Text>
          {activeTab === 'apply' && <View style={styles.tabUnderline} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          activeOpacity={0.7}
          onPress={() => setActiveTab('permission')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'permission' && styles.tabTextActive,
            ]}
          >
            Permission
          </Text>
          {activeTab === 'permission' && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
      </View>
      <View style={styles.tabsDivider} />

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentPad}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'apply' ? (
          <>
            {/* Leave Type */}
            <Text style={styles.label}>Leave Type</Text>
            <TouchableOpacity
              style={styles.inputBox}
              activeOpacity={0.7}
              onPress={() => openDropdown('leave')}
            >
              <Text style={styles.inputValue}>{leaveType}</Text>
            </TouchableOpacity>

            {/* Start / End Date */}
            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={styles.label}>Start Date</Text>
                <TextInput
                  style={styles.inputBox}
                  placeholder="Casual Leave"
                  placeholderTextColor="#9A9A9A"
                  value={startDate}
                  onChangeText={setStartDate}
                />
              </View>
              <View style={styles.colSpacer} />
              <View style={styles.col}>
                <Text style={styles.label}>End Date</Text>
                <TextInput
                  style={styles.inputBox}
                  placeholder="Casual Leave"
                  placeholderTextColor="#9A9A9A"
                  value={endDate}
                  onChangeText={setEndDate}
                />
              </View>
            </View>

            {/* Half day toggle */}
            <View style={styles.halfDayBox}>
              <Text style={styles.halfDayLabel}>Applying for Half Day?</Text>
              <Switch
                value={isHalfDay}
                onValueChange={setIsHalfDay}
                trackColor={{ false: '#E0E0E0', true: Colors.primary }}
                thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
                ios_backgroundColor="#E0E0E0"
              />
            </View>

            {/* Reason */}
            <Text style={styles.label}>Reason for leave</Text>
            <TextInput
              style={styles.textArea}
              placeholder="Enter reason for leave..."
              placeholderTextColor="#9A9A9A"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              value={leaveReason}
              onChangeText={setLeaveReason}
            />
          </>
        ) : (
          <>
            {/* Permission Type */}
            <Text style={styles.label}>Permission Type</Text>
            <TouchableOpacity
              style={styles.inputBox}
              activeOpacity={0.7}
              onPress={() => openDropdown('permission')}
            >
              <Text style={styles.inputValue}>{permissionType}</Text>
            </TouchableOpacity>

            {/* Date */}
            <Text style={styles.label}>Select Date</Text>
            <View style={styles.inputBoxRow}>
              <TextInput
                style={styles.inputBoxText}
                placeholder="DD/MM/YYYY"
                placeholderTextColor="#9A9A9A"
                value={permissionDate}
                onChangeText={setPermissionDate}
              />
              <Text style={styles.calendarIcon}>📅</Text>
            </View>

            {/* Times */}
            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={styles.label}>Start Time</Text>
                <TextInput
                  style={styles.inputBox}
                  placeholder="Casual Leave"
                  placeholderTextColor="#9A9A9A"
                  value={startTime}
                  onChangeText={setStartTime}
                />
              </View>
              <View style={styles.colSpacer} />
              <View style={styles.col}>
                <Text style={styles.label}>End Time</Text>
                <TextInput
                  style={styles.inputBox}
                  placeholder="Casual Leave"
                  placeholderTextColor="#9A9A9A"
                  value={endTime}
                  onChangeText={setEndTime}
                />
              </View>
            </View>

            {/* Reason */}
            <Text style={styles.label}>Reason for leave</Text>
            <TextInput
              style={styles.textArea}
              placeholder="Enter reason for leave..."
              placeholderTextColor="#9A9A9A"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              value={permissionReason}
              onChangeText={setPermissionReason}
            />
          </>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={styles.submitBtn}
          activeOpacity={0.85}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Submit Leave Request</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Dropdown modal */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDropdownOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {dropdownTarget === 'leave' ? 'Select Leave Type' : 'Select Permission Type'}
            </Text>
            {(dropdownTarget === 'leave' ? LEAVE_TYPES : PERMISSION_TYPES).map(opt => (
              <TouchableOpacity
                key={opt}
                style={styles.modalOption}
                onPress={() => pickOption(opt)}
              >
                <Text style={styles.modalOptionText}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const CREAM = '#FFFBEE';
const BORDER = '#E6E2D5';
const DARK_GREEN = '#1B5E20';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: CREAM },

  // Tabs
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: CREAM,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#7A7A7A',
  },
  tabTextActive: {
    color: '#111',
    fontWeight: '700',
  },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 24,
    right: 24,
    height: 3,
    backgroundColor: DARK_GREEN,
    borderRadius: 2,
  },
  tabsDivider: {
    height: 1,
    backgroundColor: '#EEE7CF',
  },

  // Content
  content: { flex: 1, backgroundColor: CREAM },
  contentPad: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },

  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 8,
    marginTop: 14,
  },

  inputBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  inputValue: {
    fontSize: 14,
    color: '#9A9A9A',
  },
  inputBoxRow: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputBoxText: {
    flex: 1,
    fontSize: 14,
    color: '#111',
    paddingVertical: 12,
  },
  calendarIcon: {
    fontSize: 18,
    color: '#555',
    marginLeft: 6,
  },

  row: { flexDirection: 'row', alignItems: 'flex-start' },
  col: { flex: 1 },
  colSpacer: { width: 12 },

  halfDayBox: {
    marginTop: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
  },
  halfDayLabel: { fontSize: 14, color: '#111', fontWeight: '500' },

  textArea: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 110,
    fontSize: 14,
    color: '#111',
  },

  submitBtn: {
    marginTop: 28,
    backgroundColor: DARK_GREEN,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: DARK_GREEN,
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  submitText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.3,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 6,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalOption: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  modalOptionText: { fontSize: 15, color: '#222' },
});
