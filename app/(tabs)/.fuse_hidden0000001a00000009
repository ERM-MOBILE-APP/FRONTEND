import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import { leaveAPI } from '../../services/api';
import SuccessModal from '../../components/SuccessModal';
import SubmitLoader from '../../components/SubmitLoader';
// #322 — Per-screen error boundary. If anything inside Leave throws
// during render, this catches it locally and shows a 'Try again' card.
// The rest of the app (other tabs, GPS task, session) stays alive
// instead of the whole app reloading.
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';



// confirmAsync — promise-based wrapper around Alert.alert so we can
// 'await' a yes/no in a normal submit handler without restructuring
// the surrounding try/catch.
function confirmAsync(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Submit', onPress: () => resolve(true) },
    ], { cancelable: true });
  });
}

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

/**
 * Quick-pick time options for the permission modal.
 *
 * Rules (Jun 2026 — HR request):
 *   • If the permission date is TODAY → start from the live current
 *     time rounded UP to the next 30-min slot. Past times are
 *     hidden because you can't apply for a permission that's
 *     already over.
 *   • If the permission date is FUTURE (or end-time picker)
 *     → standard office window 10:00 AM – 7:00 PM in 30-min steps.
 *
 * The end-time picker always uses the 10–19 window because end times
 * still need to fall inside office hours regardless of when the user
 * is filing the request.
 */
function generateTimeOptions(
  dateIso: string,
  picker: 'start' | 'end',
  // #317 — When the user opens the END time picker, we need to floor the
  // options at the already-chosen START time + 30 min. Without this the
  // list showed the same 10:00 AM – 7:00 PM slots for both pickers, so
  // an employee could pick Start = 12:30 PM, End = 10:00 AM and end up
  // stuck on a perpetually-disabled Submit button with no explanation
  // for why.
  startTime?: string,
): string[] {
  const fmt = (h: number, m: number) =>
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  // Always cap at 19:00 (7 PM end of standard office day).
  const DAY_END_HOUR = 19;

  // Detect "today" in local time. Compare YYYY-MM-DD strings to avoid
  // timezone drift on the device clock.
  const today = new Date();
  const todayIso =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isToday = dateIso === todayIso;

  // Start-of-day floor:
  //   • today + start picker  → live time rounded UP to next half-hour
  //   • end picker + start chosen → start + 30 min (strictly later)
  //   • otherwise              → 10:00 AM
  let startHour: number;
  let startMin: number;
  if (isToday && picker === 'start') {
    let h = today.getHours();
    let m = today.getMinutes();
    // Round up to next 30-min slot.
    if (m === 0)      m = 0;
    else if (m <= 30) m = 30;
    else { m = 0; h += 1; }
    startHour = h;
    startMin  = m;
  } else if (picker === 'end' && startTime && /^\d{2}:\d{2}$/.test(startTime)) {
    // End must be strictly after start. Add 30 minutes to the start so
    // the minimum permission duration is 30 minutes — anything shorter
    // is unrealistic for office permission and was the source of the
    // bug in the screenshot.
    const [sh, sm] = startTime.split(':').map(Number);
    let h = sh;
    let m = sm + 30;
    if (m >= 60) { m -= 60; h += 1; }
    startHour = h;
    startMin  = m;
  } else {
    startHour = 10;
    startMin  = 0;
  }

  const out: string[] = [];
  for (let h = startHour, m = startMin; h < DAY_END_HOUR || (h === DAY_END_HOUR && m === 0); ) {
    out.push(fmt(h, m));
    m += 30;
    if (m >= 60) { m = 0; h += 1; }
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

export default function LeaveScreen() {
  // #323 — Read the device's bottom safe-area inset so the bottom-sheet
  // pickers (Leave Type, Permission Type) clear the Android gesture
  // pill / 3-button nav. Without this padding the last option ("Other"
  // / "Earned Leave") is clipped by the system overlay — visible in
  // the user-reported screenshot.
  const insets = useSafeAreaInsets();

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

  // #305 — derived form-valid flags. Submit button stays disabled (grey)
  // until every mandatory field is filled with sensible content; the
  // instant the last field becomes valid the button flips to active
  // green. Clearing any field flips straight back to grey/disabled.
  const isLeaveFormValid = !!(
    leaveType &&
    startDate &&
    endDate &&
    reason.trim().length >= 3 &&
    endDate >= startDate
  );
  const isPermissionFormValid = !!(
    permissionType &&
    permDate &&
    startTime &&
    endTime &&
    permReason.trim().length >= 3 &&
    endTime > startTime
  );


  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showPermTypeModal, setShowPermTypeModal] = useState(false);
  // Designed success modal that replaces the stark white Alert.alert
  // for every form submission. null = hidden, object = visible.
  const [success, setSuccess] = useState<{ title: string; body: string } | null>(null);
  const [datePickerFor, setDatePickerFor] = useState<
    'start' | 'end' | 'perm' | null
  >(null);
  const [timePickerFor, setTimePickerFor] = useState<'start' | 'end' | null>(null);

  // History
  const [history, setHistory] = useState<LeaveItem[]>([]);
  // Production launch floor: ERM went live company-wide in June 2026,
  // so no leave history exists before that — the month + year picker
  // must not let the employee navigate back to anything earlier.
  const LAUNCH_MONTH = 6;
  const LAUNCH_YEAR  = 2026;
  const now = new Date();
  const _curM = now.getMonth() + 1;
  const _curY = now.getFullYear();
  const _isAtOrAfterLaunch =
    _curY > LAUNCH_YEAR || (_curY === LAUNCH_YEAR && _curM >= LAUNCH_MONTH);
  const [histMonth, setHistMonth] = useState(_isAtOrAfterLaunch ? _curM : LAUNCH_MONTH);
  const [histYear,  setHistYear]  = useState(_isAtOrAfterLaunch ? _curY : LAUNCH_YEAR);
  const [showHistMonth, setShowHistMonth] = useState(false);
  const [showHistYear, setShowHistYear] = useState(false);

  // #321 — mountedRef pattern. Stops setState-after-unmount when the
  // user swipes away mid-fetch. See app/(tabs)/attendance.tsx for the
  // full rationale; the same Android 9-10 reconciler crash can fire
  // here because the Render-cold-start delay is 30-60 s on first
  // morning launch.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await leaveAPI.getMyLeaves({
        month: histMonth,
        year: histYear,
        type: tab, // <— filter by current tab
      });
      if (!mountedRef.current) return;
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      console.warn('[leave.loadHistory] failed:', err?.message || err);
      if (!mountedRef.current) return;
      setHistory([]);
    }
  }, [histMonth, histYear, tab]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  /**
   * Check whether the employee already has a leave OR permission request
   * touching any of the dates in [from, to] (inclusive). Returns the first
   * matching date string (YYYY-MM-DD) or null if none.
   *
   * Used to block duplicate submissions BEFORE we hit the backend — the
   * user sees an immediate "already requested for this date" toast instead
   * of a vague server error.
   */
  // Build YYYY-MM-DD from LOCAL date components. toISOString() converts
  // to UTC first, which for IST users (UTC+5:30) shifts midnight back to
  // the previous day — so picking 30-May produced "2026-05-29" in the
  // duplicate-warning toast. Using local components keeps the date the
  // user actually sees on the calendar.
  const localISO = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Display helper — converts YYYY-MM-DD to dd-mm-yyyy so the alert
  // matches the format used everywhere else.
  const toDDMMYYYY = (iso: string) => {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso || '');
  };

  const findOverlappingRequest = (from: string, to: string): string | null => {
    if (!from) return null;
    const target = new Set<string>();
    const start  = new Date(from + 'T00:00:00');
    const end    = new Date((to || from) + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      target.add(localISO(d));
    }
    for (const h of history) {
      // Skip rejected/cancelled requests — re-applying after a rejection
      // is legitimate.
      const status = String((h as any).status || '').toLowerCase();
      if (status === 'rejected' || status === 'cancelled') continue;

      if (h.requestType === 'permission' && (h as any).date) {
        const iso = String((h as any).date).split('T')[0];
        if (target.has(iso)) return iso;
      } else if (h.startDate && h.endDate) {
        const s = new Date(h.startDate.split('T')[0] + 'T00:00:00');
        const e = new Date(h.endDate.split('T')[0]   + 'T00:00:00');
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          const iso = localISO(d);
          if (target.has(iso)) return iso;
        }
      }
    }
    return null;
  };

  const submitLeave = async () => {
    if (!startDate || !endDate || !reason.trim()) {
      Alert.alert('Required', 'Please fill leave type, start, end and reason.');
      return;
    }
    // Hard guard against end < start (#280). The calendar's minDate
    // already prevents this from the End picker, and setSelectedDate
    // auto-bumps end-when-start-moves, but we still validate here as
    // the last line of defence — the backend would 400 with a less
    // helpful message.
    if (endDate < startDate) {
      Alert.alert(
        'Invalid date range',
        'End Date cannot be before Start Date. Please pick an End Date on or after the Start Date.',
      );
      return;
    }
    // Block duplicates — the backend may also enforce this, but catching
    // it client-side is faster and the error message is much clearer.
    const dup = findOverlappingRequest(startDate, endDate);
    if (dup) {
      Alert.alert(
        'Already requested',
        `You have already submitted a request for ${toDDMMYYYY(dup)}. Wait for HR to act on it, or cancel the existing one before filing a new one.`
      );
      return;
    }
    if (!(await confirmAsync('Submit leave request?', 'HR will be notified once you confirm.'))) return;
    setSubmitting(true);
    try {
      await leaveAPI.applyLeave({
        leaveType,
        startDate,
        endDate,
        isHalfDay,
        reason: reason.trim(),
      });
      setSuccess({
        title: 'Leave Submitted',
        body: 'Your request was sent to HR and your manager. You\'ll be notified once it\'s reviewed.',
      });
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
    const dup = findOverlappingRequest(permDate, permDate);
    if (dup) {
      Alert.alert(
        'Already requested',
        `You have already submitted a request for ${toDDMMYYYY(dup)}. Wait for HR to act on it, or cancel the existing one before filing a new one.`
      );
      return;
    }
    if (!(await confirmAsync('Submit permission request?', 'HR will be notified once you confirm.'))) return;
    setSubmitting(true);
    try {
      await leaveAPI.applyPermission({
        permissionType,
        date: permDate,
        startTime,
        endTime,
        reason: permReason.trim(),
      });
      setSuccess({
        title: 'Permission Submitted',
        body: 'Your permission request was sent to HR and your manager. You\'ll be notified once it\'s reviewed.',
      });
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

  // dd-mm-yyyy — matches HRMS / ERM Web display format across the whole stack.
  const formatDisplay = (iso: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso + 'T00:00:00');
      return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
    } catch {
      return iso;
    }
  };

  const formatDDMMYYYY = (iso: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso + 'T00:00:00');
      return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
    } catch {
      return iso;
    }
  };

  const formatRange = (s?: string, e?: string) => {
    if (!s || !e) return '';
    try {
      if (s === e) return formatDisplay(s);
      return `${formatDisplay(s)} - ${formatDisplay(e)}`;
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
    if (datePickerFor === 'start') {
      setStartDate(date);
      // If the existing End Date is before the new Start Date, snap End
      // Date forward to match Start. Without this guard the user could
      // end up with End < Start (the screenshot bug — start 18-06,
      // end 16-06). We always preserve the user's intent to file a
      // multi-day leave by NEVER clearing endDate silently.
      if (endDate && endDate < date) {
        setEndDate(date);
      }
    } else if (datePickerFor === 'end') {
      // Defensive: if Start Date isn't picked yet, accept whatever the
      // user taps; otherwise clamp to >= startDate (the calendar's
      // minDate already prevents this, but a future refactor could
      // bypass the picker, so we double-guard).
      if (startDate && date < startDate) {
        setEndDate(startDate);
      } else {
        setEndDate(date);
      }
    } else if (datePickerFor === 'perm') {
      setPermDate(date);
    }
    setDatePickerFor(null);
  };

  const setSelectedTime = (t: string) => {
    if (timePickerFor === 'start') {
      setStartTime(t);
      // #317 — If a previously-chosen end time is now <= new start time,
      // clear it. Otherwise the form would silently sit in an invalid
      // state with Submit greyed out forever and no hint to the user
      // that the end time is the problem.
      if (endTime && endTime <= t) {
        setEndTime('');
      }
    } else if (timePickerFor === 'end') {
      // Belt-and-braces: if for any reason the end picker emitted a slot
      // <= start (shouldn't happen now that the generator filters them),
      // ignore the click rather than store an invalid pair.
      if (!startTime || t > startTime) {
        setEndTime(t);
      }
    }
    setTimePickerFor(null);
  };

  // ERM rolled out in June 2026 — floor the year picker so employees
  // can't browse to a time before the production launch. Cap at the
  // current calendar year so future years are never surfaced.
  // During 2026 → [2026]; from Jan 2027 → [2026, 2027]; etc.
  const years = (() => {
    const FLOOR = LAUNCH_YEAR;
    const top   = now.getFullYear();
    const out: number[] = [];
    for (let y = FLOOR; y <= top; y++) out.push(y);
    return out;
  })();

  return (
    <ScreenErrorBoundary name="Leave">
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
              style={[
                styles.submitBtn,
                { backgroundColor: (submitting || !isLeaveFormValid) ? '#94A3B8' : '#16A34A' },
                (submitting || !isLeaveFormValid) && { opacity: 0.7 },
              ]}
              onPress={submitLeave}
              disabled={submitting || !isLeaveFormValid}
              activeOpacity={0.85}
            >
              {submitting ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={[styles.submitBtnText, { marginLeft: 8 }]}>Submitting…</Text>
                </View>
              ) : (
                <Text style={styles.submitBtnText}>Submit Leave Request</Text>
              )}
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
                    {startTime ? formatTimeAmPm(startTime) : 'HH:MM'}
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
                    {endTime ? formatTimeAmPm(endTime) : 'HH:MM'}
                  </Text>
                  <Ionicons name="time-outline" size={16} color="#888" />
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.label}>Reason for permission</Text>
            <TextInput
              value={permReason}
              onChangeText={setPermReason}
              placeholder="Enter reason for permission"
              placeholderTextColor="#aaa"
              multiline
              style={styles.textArea}
            />

            <TouchableOpacity
              style={[
                styles.submitBtn,
                { backgroundColor: (submitting || !isPermissionFormValid) ? '#94A3B8' : '#16A34A' },
                (submitting || !isPermissionFormValid) && { opacity: 0.7 },
              ]}
              onPress={submitPermission}
              disabled={submitting || !isPermissionFormValid}
              activeOpacity={0.85}
            >
              {submitting ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={[styles.submitBtnText, { marginLeft: 8 }]}>Submitting…</Text>
                </View>
              ) : (
                <Text style={styles.submitBtnText}>Submit Permission Request</Text>
              )}
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
          history.map((l) => (
            <HistoryCard
              key={l._id}
              item={l}
              formatDisplay={formatDisplay}
              formatTimeAmPm={formatTimeAmPm}
              formatRange={formatRange}
            />
          ))
        )}
      </ScrollView>

      {/* ============ MODALS ============ */}

      <Modal visible={showTypeModal} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowTypeModal(false)}>
          {/* #323 — Inject gesture-bar inset as bottom padding so the
              last row ("Unpaid Leave" / "Other") isn't clipped by the
              Android system overlay on gesture-nav phones. */}
          <View style={[styles.modalSheet, { paddingBottom: 16 + Math.max(insets.bottom, 8) }]}>
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
          {/* #323 — Same inset fix for the Permission Type sheet — the
              user-reported screenshot shows "Other" being clipped on
              gesture-nav phones. */}
          <View style={[styles.modalSheet, { paddingBottom: 16 + Math.max(insets.bottom, 8) }]}>
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
              // minDate logic (#280 — Jun 2026 prod fix):
              //   • Start/Perm pickers → today. Employees can only file
              //     leave for today or future days; backdated requests
              //     require an HR-side adjustment.
              //   • End picker → max(today, startDate). The end date can
              //     never be earlier than the start date. Without this
              //     gate the user could set start=18-06 and end=16-06,
              //     producing a request the backend would reject — or
              //     worse, silently misinterpret.
              minDate={(() => {
                const today = new Date().toISOString().split('T')[0];
                if (datePickerFor === 'end' && startDate) {
                  return startDate > today ? startDate : today;
                }
                return today;
              })()}
              disableAllTouchEventsForDisabledDays={true}
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
                textDisabledColor: '#CCCCCC',
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
              {generateTimeOptions(
                permDate,
                timePickerFor === 'start' ? 'start' : 'end',
                // #317 — When the END picker is open, pass the chosen
                // start time so the generated slots floor at start+30m.
                timePickerFor === 'end' ? startTime : undefined,
              ).map((t) => (
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
              {MONTHS_LONG.map((m, i) => {
                // Pre-launch months are dimmed and inert. Without this
                // the employee could tap "January" with LAUNCH_YEAR
                // selected and get an empty result with no explanation.
                // Future months are also dimmed — if they haven't happened
                // yet there's no history to show.
                const _curM2 = new Date().getMonth() + 1;
                const _curY2 = new Date().getFullYear();
                const belowFloor =
                  histYear === LAUNCH_YEAR && i + 1 < LAUNCH_MONTH;
                const aboveCap =
                  histYear === _curY2 && i + 1 > _curM2;
                const allowed = !belowFloor && !aboveCap && histYear <= _curY2;
                return (
                <TouchableOpacity
                  key={m}
                  style={[styles.modalRow, !allowed && { opacity: 0.35 }]}
                  disabled={!allowed}
                  onPress={() => {
                    if (!allowed) return;
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
                );
              })}
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

      <SuccessModal
        visible={!!success}
        title={success?.title || ''}
        body={success?.body || ''}
        ctaLabel="Done"
        onClose={() => setSuccess(null)}
      />

      {/* Premium center-screen loader during request submission (#298).
          Driven by the same `submitting` boolean that already disables
          the submit button. Stays visible from tap → server response so
          users on a slow connection never wonder if their tap landed. */}
      <SubmitLoader
        visible={submitting}
        label={tab === 'permission' ? 'Submitting permission' : 'Submitting leave request'}
        sub="Hang tight — confirming with your manager and HR…"
      />
    </SafeAreaView>
    </ScreenErrorBoundary>
  );;
}

// #440 — Hoisted to MODULE SCOPE. It used to be declared INSIDE LeaveScreen,
// so it got a brand-new function identity on every render → React saw a
// different component TYPE each time and UNMOUNTED + REMOUNTED every history
// row on any parent re-render (e.g. every keystroke in the reason inputs, or
// every `submitting` toggle) → the history list flickered/blinked. As a stable
// module-level component it now only re-renders on prop change, never remounts.
// The pure date/time formatters are passed in as props.
function HistoryCard({ item, formatDisplay, formatTimeAmPm, formatRange }: {
  item: LeaveItem;
  formatDisplay: (iso: string) => string;
  formatTimeAmPm: (t: string) => string;
  formatRange: (s?: string, e?: string) => string;
}) {
    const statusConf: Record<LeaveStatus, { badge: string; edge: string; text: string }> = {
      approved: { badge: '#4CAF50', edge: '#4CAF50', text: 'Approved' },
      pending: { badge: '#FFA726', edge: '#FFA726', text: 'Pending' },
      rejected: { badge: '#F44336', edge: '#F44336', text: 'Rejected' },
    };
    // Effective status — defensive against the cross-backend race we
    // sometimes see when ERM Web manager rejects: status stays
    // 'pending' on the mobile DB until the ERM Web → mobile dual-write
    // env vars are configured, but `managerStatus` is already
    // 'Rejected' / 'Approved' on the same doc. We treat a rejection
    // by either side as final so the badge flips immediately, even
    // before the dual-write catches up.
    const mgr = String((item as any).managerStatus || '').toLowerCase();
    const effective: LeaveStatus =
      item.status === 'rejected'         ? 'rejected' :
      item.status === 'approved'         ? 'approved' :
      mgr === 'rejected'                 ? 'rejected' :
                                           item.status || 'pending';
    const conf = statusConf[effective] || statusConf.pending;
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

          {(() => {
            const it: any = item;
            const mgrStatus = String(it.managerStatus || '').toLowerCase();
            const mgrName   = it.managerStatusBy || it.managerName || '';
            const isReject  = effective === 'rejected';
            if (isReject && mgrStatus === 'rejected') {
              const extra = it.managerComment || it.managerRejectionReason;
              return (
                <View style={styles.hrCommentBar}>
                  <Text style={styles.hrCommentText}>
                    Manager rejected{mgrName ? ` (${mgrName})` : ''}{extra ? ` — ${extra}` : ''}
                  </Text>
                </View>
              );
            }
            if (isReject) {
              return (
                <View style={styles.hrCommentBar}>
                  <Text style={styles.hrCommentText}>
                    HR rejected{it.hrComment ? ` — ${it.hrComment}` : ''}
                  </Text>
                </View>
              );
            }
            if (it.hrComment) {
              return (
                <View style={styles.hrCommentBar}>
                  <Text style={styles.hrCommentText}>HR: {it.hrComment}</Text>
                </View>
              );
            }
            return null;
          })()}
        </View>
      </View>
    );
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
  hrCommentLabel: { fontSize: 10, fontWeight: '700', color: '#6B6B6B', letterSpacing: 0.3 },
  hrCommentText:  { fontSize: 12, color: '#1A1A1A', marginTop: 2 },

  /* Empty-state + dropdown modal styles (Jun 2026) -- were missing
     entirely, so the JSX referenced styles.modalBackdrop / modalSheet /
     etc. but RN silently dropped them. Result: the dropdown opened
     with no backdrop or padding and the "no leaves this month" message
     rendered flush-left with no margin. Adding these fixes both. */
  emptyBox: {
    marginHorizontal: 16,
    marginVertical: 12,
    paddingVertical: 26,
    paddingHorizontal: 18,
    backgroundColor: '#F5F7F6',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EEF1EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#6B6B6B',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalRowText: {
    fontSize: 14,
    color: '#111',
  },
});
