import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Switch,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import { leaveAPI } from '../../services/api';

type Tab = 'leave' | 'permission';
type LeaveStatus = 'pending' | 'approved' | 'rejected';

type LeaveItem = {
  _id: string;
  requestType: 'leave' | 'permission';
  leaveType?: string;
  permissionType?: string;
  startDate?: string;
  endDate?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  isHalfDay?: boolean;
  daysCount?: number;
  durationHours?: number;
  reason: string;
  status: LeaveStatus;
  hrComment?: string;
  createdAt: string;
};

const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Unpaid Leave'];
const PERMISSION_TYPES = ['Personal', 'Medical', 'Official', 'Other'];

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Quick-pick hours for the time modal (08:00..20:00 every 30min)
const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 8; h <= 20; h++) {
    for (const m of [0, 30]) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

const pad = (n: number) => String(n).padStart(2, '0');

export default function LeaveScreen() {
  const [tab, setTab] = useState<Tab>('leave');

  // Apply Leave fields
  const [leaveType, setLeaveType] = useState(LEAVE_TYPES[0]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [reason, setReason] = useState('');

  // Permission fields
  const [permissionType, setPermissionType] = useState(PERMISSION_TYPES[0]);
  const [permDate, setPermDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [permReason, setPermReason] = useState('');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showPermTypeModal, setShowPermTypeModal] = useState(false);
  const [datePickerFor, setDatePickerFor] = useState<
    'start' | 'end' | 'perm' | null
  >(null);
  const [timePickerFor, setTimePickerFor] = useState<'start' | 'end' | null>(null);

  // History
  const [history, setHistory] = useState<LeaveItem[]>([]);
  const now = new Date();
  const [histMonth, setHistMonth] = useState(now.getMonth() + 1);
  const [histYear, setHistYear] = useState(now.getFullYear());
  const [showHistMonth, setShowHistMonth] = useState(false);
  const [showHistYear, setShowHistYear] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await leaveAPI.getMyLeaves({
        month: histMonth,
        year: histYear,
        type: tab, // <— filter by current tab
      });
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch {
      setHistory([]);
    }
  }, [histMonth, histYear, tab]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const submitLeave = async () => {
    if (!startDate || !endDate || !reason.trim()) {
      Alert.alert('Required', 'Please fill leave type, start, end and reason.');
      return;
    }
    setSubmitting(true);
    try {
      await leaveAPI.applyLeave({
        leaveType,
        startDate,
        endDate,
        isHalfDay,
        reason: reason.trim(),
      });
      Alert.alert('Submitted', 'Your leave request has been submitted.');
      setStartDate('');
      setEndDate('');
      setReason('');
      setIsHalfDay(false);
      loadHistory();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Could not submit leave');
    } finally {
      setSubmitting(false);
    }
  };

  const submitPermission = async () => {
    if (!permDate || !startTime || !endTime || !permReason.trim()) {
      Alert.alert('Required', 'Please fill all permission fields.');
      return;
    }
    setSubmitting(true);
    try {
      await leaveAPI.applyPermission({
        permissionType,
        date: permDate,
        startTime,
        endTime,
        reason: permReason.trim(),
      });
      Alert.alert('Submitted', 'Permission request submitted.');
      setPermDate('');
      setStartTime('');
      setEndTime('');
      setPermReason('');
      loadHistory();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Could not submit permission');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDisplay = (iso: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso + 'T00:00:00');
      return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    } catch {
      return iso;
    }
  };

  const formatDDMMYYYY = (iso: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso + 'T00:00:00');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    } catch {
      return iso;
    }
  };

  const formatRange = (s?: string, e?: string) => {
    if (!s || !e) return '';
    try {
      const ds = new Date(s + 'T00:00:00');
      const de = new Date(e + 'T00:00:00');
      const sm = MONTHS_SHORT[ds.getMonth()];
      const em = MONTHS_SHORT[de.getMonth()];
      if (s === e) return `${sm} ${ds.getDate()}`;
      return `${sm} ${ds.getDate()} - ${em} ${de.getDate()}`;
    } catch {
      return `${s} - ${e}`;
    }
  };

  const formatTimeAmPm = (t: string) => {
    if (!t) return '';
    const [hh, mm] = t.split(':');
    const h = parseInt(hh, 10);
    if (isNaN(h)) return t;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${pad(h12)}:${mm} ${ampm}`;
  };

  const setSelectedDate = (date: string) => {
    if (datePickerFor === 'start') setStartDate(date);
    else if (datePickerFor === 'end') setEndDate(date);
    else if (datePickerFor === 'perm') setPermDate(date);
    setDatePickerFor(null);
  };

  const setSelectedTime = (t: string) => {
    if (timePickerFor === 'start') setStartTime(t);
    else if (timePickerFor === 'end') setEndTime(t);
    setTimePickerFor(null);
  };

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* TABS */}
        <View style={styles.tabsRow}>
          <TouchableOpacity
            style={styles.tabBtn}
            onPress={() => setTab('leave')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, tab === 'leave' && styles.tabActiveText]}>
              Apply Leave
            </Text>
            {tab === 'leave' && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabBtn}
            onPress={() => setTab('permission')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, tab === 'permission' && styles.tabActiveText]}>
              Permission
            </Text>
            {tab === 'permission' && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
        </View>

        {/* APPLY LEAVE FORM */}
        {tab === 'leave' && (
          <View style={styles.form}>
            <Text style={styles.label}>Leave Type</Text>
            <TouchableOpacity
              style={styles.input}
              onPress={() => setShowTypeModal(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.inputText}>{leaveType}</Text>
              <Ionicons name="chevron-down" size={18} color="#888" />
            </TouchableOpacity>

            <View style={styles.row2}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Start Date</Text>
                <TouchableOpacity
                  style={styles.input}
                  onPress={() => setDatePickerFor('start')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.inputText, !startDate && styles.placeholder]}>
                    {startDate ? formatDisplay(startDate) : 'Pick a date'}
                  </Text>
                  <Ionicons name="calendar-outline" size={16} color="#888" />
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.label}>End Date</Text>
                <TouchableOpacity
                  style={styles.input}
                  onPress={() => setDatePickerFor('end')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.inputText, !endDate && styles.placeholder]}>
                    {endDate ? formatDisplay(endDate) : 'Pick a date'}
                  </Text>
                  <Ionicons name="calendar-outline" size={16} color="#888" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.toggleCard}>
              <Text style={styles.toggleLabel}>Applying for Half Day?</Text>
              <Switch
                value={isHalfDay}
                onValueChange={setIsHalfDay}
                trackColor={{ false: '#E0E0E0', true: '#A5D6A7' }}
                thumbColor={isHalfDay ? '#2E7D32' : '#FFFFFF'}
              />
            </View>

            <Text style={styles.label}>Reason for leave</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Enter reason for leave..."
              placeholderTextColor="#aaa"
              multiline
              style={styles.textArea}
            />

            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={submitLeave}
              disabled={submitting}
              activeOpacity={0.85}
            >
              <Text style={styles.submitBtnText}>
                {submitting ? 'Submitting...' : 'Submit Leave Request'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* PERMISSION FORM */}
        {tab === 'permission' && (
          <View style={styles.form}>
            <Text style={styles.label}>Permission Type</Text>
            <TouchableOpacity
              style={styles.input}
              onPress={() => setShowPermTypeModal(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.inputText}>{permissionType}</Text>
              <Ionicons name="chevron-down" size={18} color="#888" />
            </TouchableOpacity>

            <Text style={styles.label}>Select Date</Text>
            <TouchableOpacity
              style={styles.input}
              onPress={() => setDatePickerFor('perm')}
              activeOpacity={0.7}
            >
              <Text style={[styles.inputText, !permDate && styles.placeholder]}>
                {permDate ? formatDDMMYYYY(permDate) : 'dd/mm/yyyy'}
              </Text>
              <Ionicons name="calendar-outline" size={18} color="#888" />
            </TouchableOpacity>

            <View style={styles.row2}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Start Time</Text>
                <TouchableOpacity
                  style={styles.input}
                  onPress={() => setTimePickerFor('start')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.inputText, !startTime && styles.placeholder]}>
                    {startTime ? formatTimeAmPm(startTime) : 'HH:mm'}
                  </Text>
                  <Ionicons name="time-outline" size={16} color="#888" />
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.label}>End Time</Text>
                <TouchableOpacity
                  style={styles.input}
                  onPress={() => setTimePickerFor('end')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.inputText, !endTime && styles.placeholder]}>
                    {endTime ? formatTimeAmPm(endTime) : 'HH:mm'}
                  </Text>
                  <Ionicons name="time-outline" size={16} color="#888" />
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.label}>Reason for leave</Text>
            <TextInput
              value={permReason}
              onChangeText={setPermReason}
              placeholder="Enter reason for leave..."
              placeholderTextColor="#aaa"
              multiline
              style={styles.textArea}
            />

            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={submitPermission}
              disabled={submitting}
              activeOpacity={0.85}
            >
              <Text style={styles.submitBtnText}>
                {submitting ? 'Submitting...' : 'Submit Leave Request'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* HISTORY (tab-aware) */}
        <View style={styles.histHeader}>
          <Text style={styles.histTitle}>
            {tab === 'leave' ? 'Leave History' : 'Permission History'}
          </Text>
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity style={styles.picker} onPress={() => setShowHistMonth(true)}>
              <Text style={styles.pickerText}>{MONTHS_SHORT[histMonth - 1]}</Text>
              <Ionicons name="chevron-down" size={14} color="#333" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.picker} onPress={() => setShowHistYear(true)}>
              <Text style={styles.pickerText}>{histYear}</Text>
              <Ionicons name="chevron-down" size={14} color="#333" />
            </TouchableOpacity>
          </View>
        </View>

        {history.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              {tab === 'leave'
                ? 'No leave records this month.'
                : 'No permission records this month.'}
            </Text>
          </View>
        ) : (
          history.map((l) => <HistoryCard key={l._id} item={l} />)
        )}
      </ScrollView>

      {/* ============ MODALS ============ */}

      <Modal visible={showTypeModal} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowTypeModal(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select Leave Type</Text>
            {LEAVE_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={styles.modalRow}
                onPress={() => {
                  setLeaveType(t);
                  setShowTypeModal(false);
                }}
              >
                <Text
                  style={[
                    styles.modalRowText,
                    t === leaveType && { color: '#2E7D32', fontWeight: '700' },
                  ]}
                >
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showPermTypeModal} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowPermTypeModal(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select Permission Type</Text>
            {PERMISSION_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={styles.modalRow}
                onPress={() => {
                  setPermissionType(t);
                  setShowPermTypeModal(false);
                }}
              >
                <Text
                  style={[
                    styles.modalRowText,
                    t === permissionType && { color: '#2E7D32', fontWeight: '700' },
                  ]}
                >
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!datePickerFor} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setDatePickerFor(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>
              Select{' '}
              {datePickerFor === 'start'
                ? 'Start Date'
                : datePickerFor === 'end'
                ? 'End Date'
                : 'Date'}
            </Text>
            <Calendar
              onDayPress={(day: { dateString: string }) => setSelectedDate(day.dateString)}
              markedDates={{
                ...(startDate && datePickerFor === 'start'
                  ? { [startDate]: { selected: true, selectedColor: '#4CAF50' } }
                  : {}),
                ...(endDate && datePickerFor === 'end'
                  ? { [endDate]: { selected: true, selectedColor: '#4CAF50' } }
                  : {}),
                ...(permDate && datePickerFor === 'perm'
                  ? { [permDate]: { selected: true, selectedColor: '#4CAF50' } }
                  : {}),
              }}
              theme={{
                todayTextColor: '#2E7D32',
                arrowColor: '#2E7D32',
                selectedDayBackgroundColor: '#4CAF50',
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* TIME PICKER */}
      <Modal visible={!!timePickerFor} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setTimePickerFor(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>
              Select {timePickerFor === 'start' ? 'Start Time' : 'End Time'}
            </Text>
            <ScrollView style={{ maxHeight: 350 }}>
              {TIME_OPTIONS.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={styles.modalRow}
                  onPress={() => setSelectedTime(t)}
                >
                  <Text style={styles.modalRowText}>{formatTimeAmPm(t)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showHistMonth} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowHistMonth(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select Month</Text>
            <ScrollView>
              {MONTHS_LONG.map((m, i) => (
                <TouchableOpacity
                  key={m}
                  style={styles.modalRow}
                  onPress={() => {
                    setHistMonth(i + 1);
                    setShowHistMonth(false);
                  }}
                >
                  <Text
                    style={[
                      styles.modalRowText,
                      i === histMonth - 1 && { color: '#2E7D32', fontWeight: '700' },
                    ]}
                  >
                    {m}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showHistYear} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowHistYear(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select Year</Text>
            {years.map((y) => (
              <TouchableOpacity
                key={y}
                style={styles.modalRow}
                onPress={() => {
                  setHistYear(y);
                  setShowHistYear(false);
                }}
              >
                <Text
                  style={[
                    styles.modalRowText,
                    y === histYear && { color: '#2E7D32', fontWeight: '700' },
                  ]}
                >
                  {y}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );

  function HistoryCard({ item }: { item: LeaveItem }) {
    const statusConf: Record<LeaveStatus, { badge: string; edge: string; text: string }> = {
      approved: { badge: '#4CAF50', edge: '#4CAF50', text: 'Approved' },
      pending: { badge: '#FFA726', edge: '#FFA726', text: 'Pending' },
      rejected: { badge: '#F44336', edge: '#F44336', text: 'Rejected' },
    };
    const conf = statusConf[item.status] || statusConf.pending;
    const isPermission = item.requestType === 'permission';

    const title = isPermission
      ? `${item.permissionType || 'Permission'} Permission`
      : item.leaveType || 'Leave';

    const subtitle = isPermission
      ? formatDisplay(item.date || '')
      : item.reason;

    return (
      <View style={styles.histCard}>
        <View style={[styles.histEdge, { backgroundColor: conf.edge }]} />
        <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 12 }}>
          <View style={styles.histTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.histType}>{title}</Text>
              <Text style={styles.histReason}>{subtitle}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: conf.badge }]}>
              <Text style={styles.statusBadgeText}>{conf.text}</Text>
            </View>
          </View>

          <View style={styles.histDivider} />

          {isPermission ? (
            <View style={styles.histInfoRow}>
              <View>
                <Text style={styles.histInfoLabel}>Time Slot</Text>
                <Text style={styles.histInfoValue}>
                  {formatTimeAmPm(item.startTime || '')} -{' '}
                  {formatTimeAmPm(item.endTime || '')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.histInfoLabel}>Duration</Text>
                <Text style={styles.histInfoValue}>
                  {item.durationHours
                    ? `${item.durationHours} Hour${item.durationHours === 1 ? '' : 's'}`
                    : '—'}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.histInfoRow}>
              <View>
                <Text style={styles.histInfoLabel}>Duration</Text>
                <Text style={styles.histInfoValue}>
                  {formatRange(item.startDate, item.endDate)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.histInfoLabel}>Days</Text>
                <Text style={styles.histInfoValue}>
                  {item.daysCount
                    ? `${item.daysCount} Day${item.daysCount === 1 ? '' : 's'}`
                    : '—'}
                </Text>
              </View>
            </View>
          )}

          {item.hrComment ? (
            <View style={styles.hrCommentBar}>
              <Text style={styles.hrCommentText}>HR: {item.hrComment}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }
}

const GREEN = '#4CAF50';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
    paddingHorizontal: 16,
    marginTop: 4,
  },
  tabBtn: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { fontSize: 14, color: '#888', fontWeight: '600' },
  tabActiveText: { color: '#2E7D32', fontWeight: '700' },
  tabUnderline: {
    position: 'absolute',
    bottom: -1,
    width: '50%',
    height: 3,
    borderRadius: 2,
    backgroundColor: GREEN,
  },

  form: { paddingHorizontal: 16, paddingTop: 18 },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 14,
  },
  inputText: { fontSize: 14, color: '#1A1A1A' },
  placeholder: { color: '#9A9A9A' },
  row2: { flexDirection: 'row' },

  toggleCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F5F7FB',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 14,
    marginTop: 2,
  },
  toggleLabel: { fontSize: 13, color: '#1A1A1A', fontWeight: '600' },

  textArea: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 14,
    minHeight: 90,
    textAlignVertical: 'top',
    color: '#1A1A1A',
    fontSize: 14,
    marginBottom: 16,
  },

  submitBtn: {
    backgroundColor: GREEN,
    borderRadius: 26,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    shadowColor: GREEN,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 5,
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  histHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 22,
    marginBottom: 12,
  },
  histTitle: { fontSize: 16, fontWeight: '800', color: '#111' },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 8,
  },
  pickerText: { fontSize: 12, color: '#333', marginRight: 4, fontWeight: '600' },

  histCard: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEEEEE',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  histEdge: { width: 6 },
  histTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  histType: { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  histReason: { fontSize: 12, color: '#666', marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
  },
  statusBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },

  histDivider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginTop: 10,
    marginBottom: 10,
  },
  histInfoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  histInfoLabel: { fontSize: 11, color: '#9A9A9A', fontWeight: '600' },
  histInfoValue: { fontSize: 13, color: '#1A1A1A', fontWeight: '700', marginTop: 2 },

  hrCommentBar: {
    marginTop: 10,
    backgroundColor: '#F0F2F4',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  hrCommentText: { fontSize: 12, color: '#444' },

  emptyBox: {
    marginHorizontal: 16,
    padding: 20,
    backgroundColor: '#F5F7F6',
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyText: { color: '#777', fontSize: 13 },

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
    maxHeight: '75%',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 8 },
  modalRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalRowText: { fontSize: 14, color: '#222' },
});
