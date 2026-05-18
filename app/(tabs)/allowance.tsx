import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { allowanceAPI } from '../../services/api';
import { Colors } from '../../constants/Colors';

const TRANSPORT_OPTIONS = ['Car', 'Bus', 'Train', 'Bike', 'Auto'];

export default function AllowanceScreen() {
  const [type, setType] = useState<'travel' | 'petrol'>('travel');
  const [purpose, setPurpose] = useState<'Client Meeting' | 'Sales Visit'>('Client Meeting');
  const [fromLocation, setFromLocation] = useState('San Francisco HQ');
  const [toLocation, setToLocation] = useState('');
  const [date, setDate] = useState('Nov 24, 2024');
  const [transport, setTransport] = useState('Car');
  const [showTransportMenu, setShowTransportMenu] = useState(false);
  const [amount, setAmount] = useState('310.00');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!fromLocation || !toLocation || !amount || !date) {
      Alert.alert('Error', 'Please fill all required fields');
      return;
    }
    try {
      setLoading(true);
      await allowanceAPI.submit({
        type,
        purpose,
        fromLocation,
        toLocation,
        date,
        transport,
        amount: parseFloat(amount),
        notes,
      });
      Alert.alert('✅ Success', 'Allowance submitted successfully!');
      // Reset form
      setFromLocation('');
      setToLocation('');
      setDate('');
      setAmount('');
      setNotes('');
      setTransport('Car');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Allowance</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>

        {/* Allowance Type */}
        <Text style={styles.sectionLabel}>SELECT ALLOWANCE TYPE</Text>
        <View style={styles.typeRow}>
          <TouchableOpacity
            style={[styles.typeCard, type === 'travel' && styles.typeCardActive]}
            onPress={() => setType('travel')}
          >
            <Ionicons name="airplane-outline" size={28} color={type === 'travel' ? '#fff' : Colors.primary} />
            <Text style={[styles.typeCardTitle, type === 'travel' && { color: '#fff' }]}>Travel</Text>
            <Text style={[styles.typeCardSub, type === 'travel' && { color: '#c8e6c9' }]}>Client Meetings</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.typeCard, type === 'petrol' && styles.typeCardActive]}
            onPress={() => setType('petrol')}
          >
            <Ionicons name="fuel" size={28} color={type === 'petrol' ? '#fff' : Colors.primary} />
            <Text style={[styles.typeCardTitle, type === 'petrol' && { color: '#fff' }]}>Petrol</Text>
            <Text style={[styles.typeCardSub, type === 'petrol' && { color: '#c8e6c9' }]}>Daily Commute</Text>
          </TouchableOpacity>
        </View>

        {/* Travel Purpose */}
        <Text style={styles.sectionLabel}>TRAVEL PURPOSE</Text>
        <View style={styles.purposeRow}>
          {['Client Meeting', 'Sales Visit'].map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.purposeBtn, purpose === p && styles.purposeBtnActive]}
              onPress={() => setPurpose(p as any)}
            >
              <Text style={[styles.purposeText, purpose === p && styles.purposeTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* From Location */}
        <Text style={styles.fieldLabel}>FROM LOCATION</Text>
        <View style={styles.inputRow}>
          <Ionicons name="location-outline" size={18} color={Colors.gray} style={styles.inputIcon} />
          <TextInput
            style={styles.inputFlex}
            placeholder="Enter starting location"
            placeholderTextColor={Colors.gray}
            value={fromLocation}
            onChangeText={setFromLocation}
          />
        </View>

        {/* To Location */}
        <Text style={styles.fieldLabel}>TO LOCATION</Text>
        <View style={styles.inputRow}>
          <Ionicons name="location-outline" size={18} color={Colors.primary} style={styles.inputIcon} />
          <TextInput
            style={styles.inputFlex}
            placeholder="Enter Destination"
            placeholderTextColor={Colors.gray}
            value={toLocation}
            onChangeText={setToLocation}
          />
        </View>

        {/* Date and Transport */}
        <View style={styles.twoCol}>
          <View style={styles.halfCol}>
            <Text style={styles.fieldLabel}>DATE</Text>
            <View style={styles.inputRow}>
              <Ionicons name="calendar-outline" size={16} color={Colors.gray} style={styles.inputIcon} />
              <TextInput
                style={styles.inputFlex}
                placeholder="DD/MM/YYYY"
                placeholderTextColor={Colors.gray}
                value={date}
                onChangeText={setDate}
              />
            </View>
          </View>

          <View style={styles.halfCol}>
            <Text style={styles.fieldLabel}>TRANSPORT</Text>
            <TouchableOpacity
              style={styles.inputRow}
              onPress={() => setShowTransportMenu(!showTransportMenu)}
            >
              <Ionicons name="car-outline" size={16} color={Colors.gray} style={styles.inputIcon} />
              <Text style={[styles.inputFlex, { color: Colors.text, paddingVertical: 12 }]}>{transport}</Text>
              <Ionicons name="chevron-down-outline" size={16} color={Colors.gray} />
            </TouchableOpacity>
            {showTransportMenu && (
              <View style={styles.dropdown}>
                {TRANSPORT_OPTIONS.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={styles.dropdownItem}
                    onPress={() => { setTransport(t); setShowTransportMenu(false); }}
                  >
                    <Text style={styles.dropdownText}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Amount */}
        <Text style={styles.fieldLabel}>AMOUNT</Text>
        <View style={styles.inputRow}>
          <Text style={[styles.inputIcon, { color: Colors.gray, fontSize: 14 }]}>$</Text>
          <TextInput
            style={styles.inputFlex}
            placeholder="0.00"
            placeholderTextColor={Colors.gray}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
          />
        </View>

        {/* Upload Receipt */}
        <TouchableOpacity style={styles.uploadBox}>
          <Ionicons name="camera-outline" size={28} color={Colors.gray} />
          <Text style={styles.uploadText}>Upload Receipt</Text>
          <Text style={styles.uploadSub}>PNG, JPG or PDF up to 10MB</Text>
        </TouchableOpacity>

        {/* Notes */}
        <Text style={styles.fieldLabel}>NOTES</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Add details about the client visit..."
          placeholderTextColor={Colors.gray}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />

        {/* Submit */}
        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitText}>Submit</Text>
          }
        </TouchableOpacity>

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: Colors.primary,
    paddingTop: 56, paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  scroll: { flex: 1, padding: 16 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.gray,
    letterSpacing: 1, marginTop: 16, marginBottom: 10,
  },
  typeRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  typeCard: {
    flex: 1, borderRadius: 12, padding: 16,
    alignItems: 'center', backgroundColor: '#fff',
    borderWidth: 2, borderColor: '#E0E0E0',
    elevation: 2,
  },
  typeCardActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  typeCardTitle: { fontWeight: '700', fontSize: 15, marginTop: 6, color: Colors.text },
  typeCardSub: { fontSize: 11, color: Colors.gray, marginTop: 2 },
  purposeRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  purposeBtn: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, backgroundColor: '#E8F5E9',
  },
  purposeBtnActive: { backgroundColor: Colors.primary },
  purposeText: { color: Colors.primary, fontWeight: '600', fontSize: 13 },
  purposeTextActive: { color: '#fff' },
  fieldLabel: {
    fontSize: 10, fontWeight: '700', color: Colors.gray,
    letterSpacing: 1, marginTop: 14, marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 8,
    borderWidth: 1, borderColor: '#E0E0E0',
    paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 8 },
  inputFlex: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 12 },
  twoCol: { flexDirection: 'row', gap: 12 },
  halfCol: { flex: 1 },
  dropdown: {
    backgroundColor: '#fff', borderRadius: 8,
    borderWidth: 1, borderColor: '#E0E0E0',
    marginTop: 4, elevation: 4, zIndex: 999,
  },
  dropdownItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  dropdownText: { fontSize: 14, color: Colors.text },
  uploadBox: {
    borderWidth: 1.5, borderColor: '#E0E0E0', borderStyle: 'dashed',
    borderRadius: 8, padding: 24, alignItems: 'center',
    backgroundColor: '#FAFAFA', marginTop: 14,
  },
  uploadText: { color: Colors.text, fontWeight: '600', marginTop: 8 },
  uploadSub: { color: Colors.gray, fontSize: 11, marginTop: 4 },
  notesInput: {
    backgroundColor: '#fff', borderRadius: 8,
    borderWidth: 1, borderColor: '#E0E0E0',
    padding: 12, fontSize: 14, color: Colors.text,
    height: 90, textAlignVertical: 'top',
  },
  submitBtn: {
    backgroundColor: Colors.primary, borderRadius: 10,
    padding: 16, alignItems: 'center', marginTop: 20,
    elevation: 4,
  },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});