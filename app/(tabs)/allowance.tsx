import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import { allowanceAPI } from '../../services/api';


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

type AllowanceType = 'travel' | 'petrol';
type AllowanceStatus = 'pending' | 'approved' | 'rejected';

type AllowanceItem = {
  _id: string;
  type: AllowanceType;
  purpose: string;
  fromLocation: string;
  toLocation: string;
  date: string;
  distance?: number;
  amount: number;
  notes?: string;
  status: AllowanceStatus;
  hrComment?: string;
};

type Summary = {
  approved: number;
  rejected: number;
  pending: number;
  totalDistance: number;
};

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Petrol allowance is reimbursed at ₹10 per km by default. Change this in
// one place if HR updates the policy. The amount is auto-calculated when
// the user taps "Calculate" so it always matches distance × rate.
const PETROL_RATE_PER_KM = 10;

// Tamil Nadu locations — comprehensive list covering all 38 district
// headquarters, every taluk centre, major industrial / tourist / hill /
// pilgrimage towns, plus the high-traffic Chennai / Coimbatore / Madurai
// suburbs employees actually commute between. Curated (not fetched) so
// it works offline and renders instantly on low-end Androids.
//
// The picker's bottom-sheet has a search box — typing any 1+ characters
// filters via substring match (case-insensitive), so "kov" matches both
// "Kovilpatti" and "Vadakkankulam (Kovilpatti)" etc.
const TN_LOCATIONS = [
  // ── District headquarters (all 38) ───────────────────────────────
  'Ariyalur', 'Chengalpattu', 'Chennai', 'Coimbatore', 'Cuddalore',
  'Dharmapuri', 'Dindigul', 'Erode', 'Kallakurichi', 'Kanchipuram',
  'Kanyakumari', 'Karur', 'Krishnagiri', 'Madurai', 'Mayiladuthurai',
  'Nagapattinam', 'Namakkal', 'Nilgiris (Udhagamandalam)', 'Perambalur',
  'Pudukkottai', 'Ramanathapuram', 'Ranipet', 'Salem', 'Sivaganga',
  'Tenkasi', 'Thanjavur', 'Theni', 'Thoothukudi (Tuticorin)', 'Tiruchirappalli (Trichy)',
  'Tirunelveli', 'Tirupathur', 'Tiruppur', 'Tiruvallur', 'Tiruvannamalai',
  'Tiruvarur', 'Vellore', 'Viluppuram', 'Virudhunagar',
  // ── Major / industrial / tourist / pilgrimage towns ─────────────
  'Ambasamudram', 'Ambattur', 'Ambur', 'Aranthangi', 'Aravakurichi',
  'Arakkonam', 'Arani', 'Arcot', 'Arumbavur', 'Aruppukkottai',
  'Attur', 'Avinashi', 'Bhavani', 'Bodinayakanur', 'Chidambaram',
  'Chinnamanur', 'Coonoor', 'Courtallam (Kuttralam)', 'Cumbum',
  'Denkanikottai', 'Devakottai', 'Dharapuram', 'Dharmapuri',
  'Edappadi', 'Eraniel', 'Gingee (Senji)', 'Gobichettipalayam',
  'Gudalur', 'Gudiyatham', 'Hosur', 'Idappadi', 'Jayankondam',
  'Jolarpettai', 'Kadayanallur', 'Kallakkurichi', 'Kambam',
  'Kangayam', 'Karaikal', 'Karaikudi', 'Karambakkudi', 'Karumandurai',
  'Kaveripattinam', 'Kayalpattinam', 'Killiyoor', 'Kodaikanal',
  'Kodumudi', 'Kolathur', 'Kolli Hills', 'Kotagiri', 'Kovilpatti',
  'Kulithalai', 'Kumbakonam', 'Kunnam', 'Kurinjipadi', 'Madavaram',
  'Madukkarai', 'Madurantakam', 'Mahabalipuram (Mamallapuram)',
  'Manapparai', 'Manamadurai', 'Mannargudi', 'Marakanam', 'Mecheri',
  'Melur', 'Mettupalayam', 'Mettur', 'Musiri', 'Muthupettai',
  'Nagercoil', 'Nanguneri', 'Neyveli', 'Omalur', 'Ottapidaram',
  'Padmanabhapuram', 'Palani', 'Palladam', 'Pallavaram', 'Pallipalayam',
  'Panruti', 'Papanasam', 'Paramakudi', 'Pattukkottai', 'Periyakulam',
  'Perundurai', 'Pollachi', 'Ponneri', 'Pudur', 'Puliyangudi',
  'Rajapalayam', 'Rameswaram', 'Rasipuram', 'Sankarankovil', 'Sankari',
  'Sathyamangalam', 'Sholinghur', 'Sirkali (Sirkazhi)', 'Sivakasi',
  'Srimushnam', 'Srivilliputhur', 'Tambaram', 'Tenkasi',
  'Thiruchendur', 'Thirukoilur', 'Thiruparankundram',
  'Thiruporur', 'Thirupparankunram', 'Thiruthuraipoondi',
  'Thiruvaiyaru', 'Thiruvallur', 'Thiruvarur', 'Thiruvotriyur',
  'Thondi', 'Thuraiyur', 'Tindivanam', 'Tiruchengode', 'Tirukoilur',
  'Tirukkalukundram', 'Tirukoyilur', 'Tirupanandal', 'Tiruttani',
  'Turaiyur', 'Udumalaipettai', 'Ulundurpet', 'Usilampatti',
  'Uthukottai', 'Valangaiman', 'Valliyoor', 'Valparai', 'Vandavasi',
  'Vaniyambadi', 'Vedaranyam', 'Vellakoil', 'Vellore', 'Vembakkam',
  'Vikravandi', 'Villupuram', 'Virudhachalam', 'Walajapet', 'Yercaud',
  // ── Chennai metro / suburbs ─────────────────────────────────────
  'Chennai - Adyar', 'Chennai - Alandur', 'Chennai - Anna Nagar',
  'Chennai - Ashok Nagar', 'Chennai - Avadi', 'Chennai - Besant Nagar',
  'Chennai - Chromepet', 'Chennai - Egmore', 'Chennai - Ennore',
  'Chennai - Guindy', 'Chennai - K.K. Nagar', 'Chennai - Kilpauk',
  'Chennai - Kodambakkam', 'Chennai - Madhavaram', 'Chennai - Madipakkam',
  'Chennai - Manapakkam', 'Chennai - Medavakkam', 'Chennai - Meenambakkam',
  'Chennai - Mylapore', 'Chennai - Nungambakkam', 'Chennai - OMR (Old Mahabalipuram Rd)',
  'Chennai - Pallavaram', 'Chennai - Pallikaranai', 'Chennai - Perambur',
  'Chennai - Perungudi', 'Chennai - Porur', 'Chennai - Royapettah',
  'Chennai - Royapuram', 'Chennai - Saidapet', 'Chennai - Sholinganallur',
  'Chennai - Siruseri', 'Chennai - T. Nagar', 'Chennai - Tambaram',
  'Chennai - Thiruvanmiyur', 'Chennai - Thoraipakkam', 'Chennai - Triplicane',
  'Chennai - Vadapalani', 'Chennai - Velachery', 'Chennai - Washermanpet',
  // ── Coimbatore suburbs / nearby ─────────────────────────────────
  'Coimbatore - Gandhipuram', 'Coimbatore - Peelamedu',
  'Coimbatore - R.S. Puram', 'Coimbatore - Saibaba Colony',
  'Coimbatore - Saravanampatti', 'Coimbatore - Singanallur',
  'Coimbatore - Sulur', 'Coimbatore - Thudiyalur', 'Coimbatore - Ukkadam',
  'Coimbatore - Vadavalli',
  // ── Madurai suburbs ─────────────────────────────────────────────
  'Madurai - Anna Nagar', 'Madurai - K.K. Nagar', 'Madurai - Mattuthavani',
  'Madurai - Palanganatham', 'Madurai - Thirunagar', 'Madurai - Vilangudi',
  // ── Tiruchirappalli suburbs ─────────────────────────────────────
  'Trichy - K.K. Nagar', 'Trichy - Srirangam', 'Trichy - Thillai Nagar',
  'Trichy - Thuvakudi', 'Trichy - Woraiyur',
  // ── Salem / Coimbatore ring towns ───────────────────────────────
  'Salem - Hasthampatti', 'Salem - Suramangalam', 'Salem - Yercaud Road',
  // ── Hill stations & tourist destinations ────────────────────────
  'Ooty (Udhagamandalam)', 'Kotagiri', 'Coonoor', 'Yercaud', 'Kodaikanal',
  'Valparai', 'Topslip', 'Yelagiri', 'Kolli Hills', 'Sirumalai',
  // ── Pilgrimage centres ──────────────────────────────────────────
  'Tiruchendur', 'Palani', 'Rameswaram', 'Thiruvannamalai', 'Madurai (Meenakshi Temple)',
  'Srirangam', 'Chidambaram', 'Velankanni', 'Tirukkalukundram',
  // ── Beach / coastal towns ───────────────────────────────────────
  'Mahabalipuram (Mamallapuram)', 'Pondicherry (via Tindivanam)',
  'Marina Beach (Chennai)', 'Kanyakumari', 'Tranquebar (Tharangambadi)',
  'Poompuhar', 'Kovalam (Tamil Nadu)',
];
// De-dup + sort once so we never ship duplicates.
const TN_LOCATIONS_UNIQUE = Array.from(new Set(TN_LOCATIONS)).sort((a, b) =>
  a.localeCompare(b)
);

/**
 * Geocode an address via OpenStreetMap's Nominatim service (free, no API key).
 * Returns { lat, lng } or null if the address couldn't be resolved.
 * Note: Nominatim asks callers to set a custom User-Agent.
 */
async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address || !address.trim()) return null;
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
    encodeURIComponent(address.trim());
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'TescoERM/1.0 (allowance)' } });
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

/**
 * Great-circle distance between two lat/lng points in km (haversine).
 * Good enough as an estimate — actual driving distance is usually 20-40%
 * longer, so the user can bump the number up before submitting if needed.
 */
function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const c =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  const distance = 2 * R * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
  return Math.round(distance * 100) / 100;
}
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function AllowanceScreen() {
  const [type, setType] = useState<AllowanceType>('travel');
  const [fromLoc, setFromLoc] = useState('');
  const [toLoc, setToLoc] = useState('');
  // Which picker is open ('from' | 'to' | null). One modal serves both.
  const [pickerOpen, setPickerOpen] = useState<null | 'from' | 'to'>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [date, setDate] = useState('');
  const [distance, setDistance] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [calculating, setCalculating] = useState(false);

  // History
  // Production launch floor: ERM rolled out to all employees in June
  // 2026, so the month / year picker must NOT let employees navigate
  // back to anything earlier — there's simply no data there. The floor
  // also drives the default state (current month, but never older than
  // the launch month).
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
  const [history, setHistory] = useState<AllowanceItem[]>([]);
  const [summary, setSummary] = useState<Summary>({
    approved: 0, rejected: 0, pending: 0, totalDistance: 0,
  });

  const loadAll = useCallback(async () => {
    try {
      // Each tab now strictly fetches its own type. Previously the petrol
      // tab pulled the employee's travel records and computed a petrol
      // breakdown from them — that meant a Travel allowance the user
      // submitted (with type='travel') ended up listed under the Petrol
      // section, which confused both employees and HR. Now Travel rows
      // only show in the Travel tab and Petrol rows only in the Petrol
      // tab, matching what HRMS shows.
      const [hRes, sRes] = await Promise.all([
        allowanceAPI.getMyAllowances({ month: histMonth, year: histYear, type }),
        allowanceAPI.getSummary    ({ month: histMonth, year: histYear, type }),
      ]);
      setHistory(Array.isArray(hRes.data) ? hRes.data : []);
      setSummary({
        approved:     sRes.data?.approved      || 0,
        rejected:     sRes.data?.rejected      || 0,
        pending:      sRes.data?.pending       || 0,
        totalDistance: sRes.data?.totalDistance || 0,
      });
    } catch {
      setHistory([]);
      setSummary({ approved: 0, rejected: 0, pending: 0, totalDistance: 0 });
    }
  }, [histMonth, histYear, type]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // For PETROL only — auto-recalculate distance + amount the moment both
  // From and To are set (debounced ~600 ms so we don't geocode on every
  // keystroke). The user can still hit Calculate manually for travel.
  useEffect(() => {
    if (type !== 'petrol') return;
    if (!fromLoc.trim() || !toLoc.trim()) return;
    const id = setTimeout(() => { calculate(); }, 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLoc, toLoc, type]);

  // Auto-fill distance + amount for petrol by geocoding From / To and
  // computing the straight-line distance × ₹/km rate. The user can still
  // edit either field after — useful when the road distance differs from
  // the bird's-eye distance.
  const calculate = async () => {
    if (!fromLoc.trim() || !toLoc.trim()) {
      Alert.alert('From and To required', 'Enter both addresses before calculating.');
      return;
    }
    try {
      setCalculating(true);
      const [a, b] = await Promise.all([geocode(fromLoc), geocode(toLoc)]);
      if (!a || !b) {
        Alert.alert(
          'Could not locate',
          'One of the addresses could not be found. Try adding more detail ' +
          '(city, state, pincode) or enter the distance manually.'
        );
        return;
      }
      const km = haversineKm(a, b);
      const amt = Math.round(km * PETROL_RATE_PER_KM);
      setDistance(String(km));
      setAmount(String(amt));
    } catch {
      Alert.alert('Calculation failed', 'Could not look up the route. Enter the distance manually.');
    } finally {
      setCalculating(false);
    }
  };

  const submit = async () => {
    if (!fromLoc.trim() || !toLoc.trim() || !date || !amount) {
      Alert.alert('Required', 'Please fill From, To, Date and Amount.');
      return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Invalid', 'Please enter a valid amount.');
      return;
    }
    const dist = parseFloat(distance);
    if (type === 'petrol' && (isNaN(dist) || dist <= 0)) {
      Alert.alert('Invalid', 'Please enter the distance in km.');
      return;
    }
    if (!(await confirmAsync('Submit allowance claim?', 'HR will review the claim once you confirm.'))) return;
    setSubmitting(true);
    try {
      await allowanceAPI.submit({
        type,
        fromLocation: fromLoc.trim(),
        toLocation: toLoc.trim(),
        date,
        amount: amt,
        distance: isNaN(dist) ? 0 : dist,
        notes: notes.trim(),
        purpose: type === 'petrol' ? 'Daily Commute' : 'Official Meeting',
        transport: type === 'petrol' ? 'Bike' : 'Car',
      });
      Alert.alert('Submitted', 'Your allowance request has been submitted.');
      setFromLoc('');
      setToLoc('');
      setDate('');
      setDistance('');
      setAmount('');
      setNotes('');
      loadAll();
    } catch (err: any) {
      Alert.alert(
        'Error',
        err?.response?.data?.message || 'Could not submit allowance'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  } catch { return String(iso); }
};

  // dd-mm-yyyy — matches HRMS / ERM Web display format across the whole stack.
  const formatFullDate = (iso: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso + 'T00:00:00');
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${dd}-${mm}-${d.getFullYear()}`;
    } catch {
      return iso;
    }
  };

  const rupee = (n: number) => '₹' + (n || 0).toLocaleString('en-IN');
  // ERM production rollout is June 2026 — floor the year picker at 2026
  // (data simply doesn't exist before then). The list goes up to the
  // current year + 1 so the picker still works in early-January edge
  // cases.
  const years = (() => {
    const top = Math.max(now.getFullYear() + 1, LAUNCH_YEAR);
    const out: number[] = [];
    for (let y = LAUNCH_YEAR; y <= top; y++) out.push(y);
    return out;
  })();
  // Helper used by both the month + year pickers to disable rows that
  // would otherwise let an employee select a pre-launch month.
  const _isMonthAllowed = (mIdx0: number) =>
    histYear > LAUNCH_YEAR || (histYear === LAUNCH_YEAR && mIdx0 + 1 >= LAUNCH_MONTH);

  const isPetrol = type === 'petrol';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* TYPE SELECTOR */}
        <Text style={styles.sectionLabel}>Select Allowance Type</Text>
        <View style={styles.typeRow}>
          <TypeCard
            active={!isPetrol}
            onPress={() => setType('travel')}
            icon={
              <MaterialCommunityIcons
                name="car"
                size={22}
                color={!isPetrol ? '#FFFFFF' : '#777'}
              />
            }
            title="Travel"
            subtitle="Official Meetings"
          />
          <TypeCard
            active={isPetrol}
            onPress={() => setType('petrol')}
            icon={
              <MaterialCommunityIcons
                name="gas-station"
                size={22}
                color={isPetrol ? '#FFFFFF' : '#777'}
              />
            }
            title="Petrol"
            subtitle="Daily Commute"
          />
        </View>

        {/* FORM — Travel only. The Petrol tab shows reimbursement derived
            from the Travel records (this-month summary + history below). */}
        {!isPetrol && (
        <View style={styles.form}>
          <Text style={styles.label}>From</Text>
          <View style={styles.input}>
            <Ionicons name="locate-outline" size={18} color="#888" style={{ marginRight: 8 }} />
            <TextInput
              value={fromLoc}
              onChangeText={setFromLoc}
              placeholder="Enter From Location"
              placeholderTextColor="#9A9A9A"
              style={styles.textInput}
            />
          </View>

          <Text style={styles.label}>To</Text>
          <View style={styles.input}>
            <Ionicons name="location-outline" size={18} color="#888" style={{ marginRight: 8 }} />
            <TextInput
              value={toLoc}
              onChangeText={setToLoc}
              placeholder="Enter To Location"
              placeholderTextColor="#9A9A9A"
              style={styles.textInput}
            />
          </View>

          <Text style={styles.label}>Date</Text>
          <TouchableOpacity
            style={styles.input}
            onPress={() => setShowDate(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="calendar-outline" size={18} color="#888" style={{ marginRight: 8 }} />
            <Text style={[styles.textInput, !date && { color: '#9A9A9A' }]}>
              {date ? formatDate(date) : 'Pick a date'}
            </Text>
          </TouchableOpacity>

          {isPetrol && (
            <>
              {/* Tap to auto-fill distance + amount from From / To addresses */}
              <TouchableOpacity
                style={[styles.calcBtn, calculating && { opacity: 0.6 }]}
                onPress={calculate}
                disabled={calculating}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="calculator-variant" size={18} color="#FFFFFF" />
                <Text style={styles.calcBtnText}>
                  {calculating ? 'Calculating…' : 'Calculate Distance & Amount'}
                </Text>
              </TouchableOpacity>

              <Text style={styles.label}>Distance (km)</Text>
              <View style={styles.input}>
                <MaterialCommunityIcons
                  name="map-marker-distance"
                  size={18}
                  color="#888"
                  style={{ marginRight: 8 }}
                />
                <TextInput
                  value={distance}
                  onChangeText={(v) => {
                    setDistance(v);
                    // If the user edits distance manually, also recompute amount
                    // at the standard rate so the two always agree.
                    const n = parseFloat(v);
                    if (!isNaN(n)) setAmount(String(Math.round(n * PETROL_RATE_PER_KM)));
                  }}
                  placeholder="Auto-filled — tap Calculate"
                  placeholderTextColor="#9A9A9A"
                  keyboardType="numeric"
                  style={styles.textInput}
                />
              </View>
              <Text style={styles.rateHint}>
                Reimbursed at ₹{PETROL_RATE_PER_KM} / km
              </Text>
            </>
          )}

          <Text style={styles.label}>Amount</Text>
          <View style={styles.input}>
            <Text style={{ color: '#888', marginRight: 6, fontWeight: '700' }}>₹</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder={isPetrol ? 'Auto-filled from distance' : 'Enter Amount'}
              placeholderTextColor="#9A9A9A"
              keyboardType="numeric"
              style={styles.textInput}
              editable={!isPetrol}      /* lock the field for petrol — derived from distance */
            />
          </View>

          <Text style={styles.label}>Notes</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            style={styles.textArea}
          />

          <TouchableOpacity
            style={[styles.submitBtn, submitting && { opacity: 0.85 }]}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={[styles.submitBtnText, { marginLeft: 8 }]}>Submitting…</Text>
              </View>
            ) : (
              <Text style={styles.submitBtnText}>Submit</Text>
            )}
          </TouchableOpacity>
        </View>
        )}

        {/* MONTH PICKER */}
        <View style={styles.monthRow}>
          <Text style={styles.monthLabel}>This Month</Text>
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

        {/* SUMMARY CARDS */}
        {isPetrol ? (
          <View style={styles.summaryGrid}>
            <View style={styles.summaryGridRow}>
              {/* Label corrected Jun 2026: this tile sums every petrol
                  row's distance for the month — not just travel — so it
                  reads "TOTAL DISTANCE" to match what HR briefed. */}
              <BigCard
                color="#2196F3"
                label="TOTAL DISTANCE"
                value={`${summary.totalDistance} km`}
              />
              <BigCard
                color="#4CAF50"
                label="APPROVED AMOUNT"
                value={rupee(summary.approved)}
              />
            </View>
            <View style={styles.summaryGridRow}>
              <BigCard
                color="#FFA726"
                label="PENDING AMOUNT"
                value={rupee(summary.pending)}
              />
              <BigCard
                color="#F44336"
                label="REJECTED AMOUNT"
                value={rupee(summary.rejected)}
              />
            </View>
          </View>
        ) : (
          <View style={styles.summaryRow}>
            <SummaryCard color="#4CAF50" label="APPROVED" amount={summary.approved} />
            <SummaryCard color="#F44336" label="REJECTED" amount={summary.rejected} />
            <SummaryCard color="#FFA726" label="PENDING" amount={summary.pending} />
          </View>
        )}

        {/* HISTORY */}
        <Text style={styles.historyHeading}>History</Text>

        {history.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              No {isPetrol ? 'petrol' : 'travel'} records this month.
            </Text>
          </View>
        ) : isPetrol ? (
          history.map((a) => (
            <View key={a._id} style={styles.histCard}>
              <Text style={styles.histDate}>{formatFullDate(a.date)}</Text>
              <View style={styles.histDivider} />
              <View style={styles.histPetrolRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.histColHead}>Distance</Text>
                  <Text style={styles.histColVal}>{(a.distance || 0)} Km</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.histColHead}>Amount</Text>
                  <Text style={styles.histColVal}>{rupee(a.amount)}</Text>
                </View>
                <StatusBadge status={a.status} />
              </View>
              <RejectRemarks item={a} />
            </View>
          ))
        ) : (
          history.map((a) => (
            <View key={a._id} style={styles.histCard}>
              <View style={styles.histTopRow}>
                <Text style={styles.histDate}>{formatFullDate(a.date)}</Text>
                <StatusBadge status={a.status} />
              </View>
              <View style={styles.histDivider} />
              <View style={styles.histInfoRow}>
                <View style={styles.histCol}>
                  <Text style={styles.histColHead}>From</Text>
                  <Text style={styles.histColVal}>{a.fromLocation}</Text>
                </View>
                <View style={styles.histCol}>
                  <Text style={styles.histColHead}>To</Text>
                  <Text style={styles.histColVal}>{a.toLocation}</Text>
                </View>
                <View style={[styles.histCol, { alignItems: 'flex-end' }]}>
                  <Text style={styles.histColHead}>Amount</Text>
                  <Text style={styles.histColVal}>{rupee(a.amount)}</Text>
                </View>
              </View>
              {a.notes ? (
                <View style={styles.notesBar}>
                  <Text style={styles.notesText}>
                    <Text style={{ fontWeight: '700' }}>Notes: </Text>
                    {a.notes}
                  </Text>
                </View>
              ) : null}
              <RejectRemarks item={a} />
            </View>
          ))
        )}
      </ScrollView>

      {/* MODALS */}
      <Modal visible={showDate} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowDate(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Select Date</Text>
            <Calendar
              onDayPress={(day: { dateString: string }) => {
                setDate(day.dateString);
                setShowDate(false);
              }}
              markedDates={
                date ? { [date]: { selected: true, selectedColor: '#4CAF50' } } : {}
              }
              theme={{
                todayTextColor: '#2E7D32',
                arrowColor: '#2E7D32',
                selectedDayBackgroundColor: '#4CAF50',
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showHistMonth} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowHistMonth(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select Month</Text>
            <ScrollView>
              {MONTHS_LONG.map((m, i) => {
                const allowed = _isMonthAllowed(i);
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

      {/* ─── Tamil Nadu location picker (shared by From / To) ──────────── */}
      <Modal
        visible={pickerOpen !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setPickerOpen(null)}>
          <Pressable style={styles.locPickerSheet} onPress={() => {}}>
            <View style={styles.locPickerHeader}>
              <Text style={styles.locPickerTitle}>
                {pickerOpen === 'from' ? 'Pickup location' : 'Destination'}
              </Text>
              <TouchableOpacity onPress={() => setPickerOpen(null)} hitSlop={{ top:8,bottom:8,left:8,right:8 }}>
                <Ionicons name="close" size={22} color="#666" />
              </TouchableOpacity>
            </View>
            <Text style={styles.locPickerSub}>Tamil Nadu places — type to filter</Text>

            <View style={styles.locSearchWrap}>
              <Ionicons name="search" size={16} color="#999" />
              <TextInput
                value={pickerSearch}
                onChangeText={setPickerSearch}
                placeholder="Search city / town"
                placeholderTextColor="#9A9A9A"
                style={styles.locSearchInput}
                autoFocus
              />
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 380 }}
            >
              {TN_LOCATIONS_UNIQUE
                .filter((p) => {
                  if (!pickerSearch) return true;
                  const q   = pickerSearch.toLowerCase();
                  const low = p.toLowerCase();
                  // Match whole string, OR any whitespace/dash/comma-separated
                  // token within. Lets the user type "adyar" and hit
                  // "Chennai - Adyar", or "peelamedu" for "Coimbatore - Peelamedu".
                  if (low.includes(q)) return true;
                  const parts = low.split(/[\s\-,()]+/).filter(Boolean);
                  return parts.some((tok) => tok.startsWith(q));
                })
                .map((place) => {
                  const active =
                    (pickerOpen === 'from' && place === fromLoc) ||
                    (pickerOpen === 'to'   && place === toLoc);
                  return (
                    <TouchableOpacity
                      key={place}
                      style={[styles.locRow, active && styles.locRowActive]}
                      onPress={() => {
                        if (pickerOpen === 'from') setFromLoc(place);
                        else                       setToLoc(place);
                        setPickerOpen(null);
                      }}
                    >
                      <Ionicons
                        name="location-outline"
                        size={16}
                        color={active ? '#2E7D32' : '#777'}
                        style={{ marginRight: 10 }}
                      />
                      <Text style={[styles.locRowText, active && { color: '#2E7D32', fontWeight: '700' }]}>
                        {place}
                      </Text>
                      {active && <Ionicons name="checkmark" size={16} color="#2E7D32" />}
                    </TouchableOpacity>
                  );
                })}
              {TN_LOCATIONS_UNIQUE.filter((p) => {
                if (!pickerSearch) return true;
                const q   = pickerSearch.toLowerCase();
                const low = p.toLowerCase();
                if (low.includes(q)) return true;
                const parts = low.split(/[\s\-,()]+/).filter(Boolean);
                return parts.some((tok) => tok.startsWith(q));
              }).length === 0 && (
                <Text style={styles.locEmpty}>No matching places.</Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

/* ============ helpers ============ */
function TypeCard({
  active,
  onPress,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onPress: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.typeCard, active ? styles.typeCardActive : styles.typeCardInactive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View
        style={[
          styles.typeIconWrap,
          { backgroundColor: active ? 'rgba(255,255,255,0.18)' : '#EFEFEF' },
        ]}
      >
        {icon}
      </View>
      <Text style={[styles.typeTitle, { color: active ? '#FFFFFF' : '#1A1A1A' }]}>
        {title}
      </Text>
      <Text
        style={[styles.typeSubtitle, { color: active ? 'rgba(255,255,255,0.85)' : '#888' }]}
      >
        {subtitle}
      </Text>
    </TouchableOpacity>
  );
}

function RejectRemarks({ item }: { item: any }) {
  const status = String(item?.status || '').toLowerCase();
  const mgrStatus = String(item?.managerStatus || '').toLowerCase();
  const isRejected = status === 'rejected' || mgrStatus === 'rejected';
  if (!isRejected) return null;
  const mgrName = item?.managerStatusBy || item?.managerName || '';
  const isManagerReject = mgrStatus === 'rejected';
  const extra = isManagerReject ? (item?.managerComment || item?.managerRejectionReason) : item?.hrComment;
  const text = isManagerReject
    ? `Manager rejected${mgrName ? ` (${mgrName})` : ''}${extra ? ` - ${extra}` : ''}`
    : `HR rejected${extra ? ` - ${extra}` : ''}`;
  return (
    <View style={[styles.notesBar, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
      <Text style={[styles.notesText, { color: '#B91C1C' }]}>{text}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: AllowanceStatus }) {
  const map: Record<AllowanceStatus, { bg: string; text: string }> = {
    approved: { bg: '#4CAF50', text: 'Approved' },
    pending: { bg: '#FFA726', text: 'Pending' },
    rejected: { bg: '#F44336', text: 'Rejected' },
  };
  const conf = map[status] || map.pending;
  return (
    <View style={[styles.badge, { backgroundColor: conf.bg }]}>
      <Text style={styles.badgeText}>{conf.text}</Text>
    </View>
  );
}

function SummaryCard({
  color,
  label,
  amount,
}: {
  color: string;
  label: string;
  amount: number;
}) {
  return (
    <View style={[styles.sumCard, { backgroundColor: color }]}>
      <Text style={styles.sumCardLabel}>{label}</Text>
      <Text style={styles.sumCardLabel}>AMOUNT</Text>
      <Text style={styles.sumCardValue}>₹{(amount || 0).toLocaleString('en-IN')}</Text>
    </View>
  );
}

function BigCard({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.bigCard, { backgroundColor: color }]}>
      <Text style={styles.bigCardLabel}>{label}</Text>
      <Text style={styles.bigCardValue}>{value}</Text>
    </View>
  );
}

/* ============ styles ============ */
const GREEN = '#4CAF50';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A1A1A',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 10,
  },

  typeRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 6 },
  typeCard: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  typeCardActive: {
    backgroundColor: GREEN,
    shadowColor: GREEN,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  typeCardInactive: {
    backgroundColor: '#F4F4F4',
    borderWidth: 1,
    borderColor: '#EAEAEA',
  },
  typeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  typeTitle: { fontSize: 14, fontWeight: '700' },
  typeSubtitle: { fontSize: 11, marginTop: 2 },

  form: { paddingHorizontal: 16, paddingTop: 14 },
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
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    marginBottom: 14,
  },
  textInput: { flex: 1, fontSize: 14, color: '#1A1A1A', padding: 0 },
  textArea: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 14,
    padding: 14,
    minHeight: 80,
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
    marginHorizontal: 30,
    shadowColor: GREEN,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 5,
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  /* Calculate button (petrol only) */
  calcBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1565C0',
    borderRadius: 22,
    paddingVertical: 11,
    marginBottom: 10,
  },
  calcBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
  },
  rateHint: {
    fontSize: 10.5,
    color: '#7A7A7A',
    marginTop: -8,
    marginBottom: 8,
    marginLeft: 4,
    fontStyle: 'italic',
  },

  /* MONTH PICKER ROW */
  monthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 22,
    marginBottom: 12,
  },
  monthLabel: { fontSize: 13, color: '#1A1A1A', fontWeight: '700' },
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

  /* SUMMARY (travel — 3 cards) */
  summaryRow: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 14 },
  sumCard: {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 2,
  },
  sumCardLabel: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  sumCardValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 6,
  },

  /* SUMMARY (petrol — 4 cards 2x2) */
  summaryGrid: {
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  summaryGridRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  bigCard: {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  bigCardLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  bigCardValue: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 10,
  },

  /* HISTORY */
  historyHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
    marginTop: 10,
    marginBottom: 10,
    marginHorizontal: 16,
  },
  histCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  histTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  histDate: { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  badge: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  histDivider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 12 },
  histInfoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  histCol: { flex: 1 },
  histColHead: { fontSize: 12, color: '#2E7D32', fontWeight: '700' },
  histColVal: { fontSize: 13, color: '#1A1A1A', marginTop: 4 },
  histPetrolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  notesBar: {
    marginTop: 10,
    backgroundColor: '#F4F4F4',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  notesText: { fontSize: 12, color: '#666' },

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

  /* ─── Shared modal overlay (backdrop) used by the location picker ─ */
  // Without this, <Modal>'s child Pressable has no positioning / dim
  // background and the From/To picker appears empty or unreachable.
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },

  /* ─── Location picker sheet (TN places) ──────────────────────────── */
  locPickerSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    maxHeight: '85%',
  },
  locPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  locPickerTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  locPickerSub:   { fontSize: 11, color: '#777', marginBottom: 12 },

  locSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    marginBottom: 10,
  },
  locSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#111',
    padding: 0,
  },

  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F2',
  },
  locRowActive: { backgroundColor: '#F1F9EE' },
  locRowText:   { flex: 1, fontSize: 14, color: '#222' },
  locEmpty:     { paddingVertical: 20, textAlign: 'center', color: '#999', fontSize: 13 },
});
