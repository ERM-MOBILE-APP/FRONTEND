import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { complaintAPI } from '../services/api';

type Priority = 'low' | 'medium' | 'high' | 'critical';

const PRIORITY_OPTIONS: { value: Priority; label: string; color: string; bg: string }[] = [
  { value: 'low',      label: 'Low',      color: '#2E7D32', bg: '#E8F5E9' },
  { value: 'medium',   label: 'Medium',   color: '#A47B00', bg: '#FFF7DA' },
  { value: 'high',     label: 'High',     color: '#C25400', bg: '#FFE5D0' },
  { value: 'critical', label: 'Critical', color: '#C62828', bg: '#FFE3E3' },
];

const MAX_DESCRIPTION = 500;
const MAX_SUBJECT     = 120;

export default function ComplaintScreen() {
  const [subject, setSubject]         = useState('');
  const [priority, setPriority]       = useState<Priority>('low');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  // #440 — mounted guard for the submit request (hardware-back mid-flight).
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const subjectValid = subject.trim().length > 0;
  const canSubmit = useMemo(
    () => subjectValid && description.length <= MAX_DESCRIPTION && !submitting,
    [subjectValid, description.length, submitting]
  );

  const handleSubmit = async () => {
    if (!canSubmit) {
      if (!subjectValid) {
        Alert.alert('Subject required', 'Please enter a short subject for your complaint.');
      }
      return;
    }
    try {
      setSubmitting(true);
      await complaintAPI.create({
        subject: subject.trim(),
        priority,
        description: description.trim(),
      });
      Alert.alert(
        'Complaint submitted',
        'Thank you — HR has been notified and will follow up shortly.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (err: any) {
      Alert.alert(
        'Could not submit',
        err?.response?.data?.message || 'Please try again in a moment.'
      );
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Back arrow */}
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={22} color="#1A1A1A" />
          </TouchableOpacity>

          {/* Headline */}
          <Text style={styles.title}>We're listening.</Text>
          <Text style={styles.subtitle}>
            Your feedback helps us create a better workplace for everyone.
            Please provide the details below.
          </Text>

          {/* Subject */}
          <Text style={styles.label}>Subject</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Broken AC in Floor 3"
            placeholderTextColor="#B7B7B7"
            value={subject}
            onChangeText={(t) => setSubject(t.slice(0, MAX_SUBJECT))}
            maxLength={MAX_SUBJECT}
          />

          {/* Priority */}
          <Text style={styles.label}>Priority Level</Text>
          <View style={styles.pillsWrap}>
            {PRIORITY_OPTIONS.map((opt) => {
              const active = priority === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.pill,
                    { backgroundColor: active ? opt.bg : '#F5F5F5' },
                    active && { borderColor: opt.color },
                  ]}
                  onPress={() => setPriority(opt.value)}
                  activeOpacity={0.85}
                >
                  <View
                    style={[
                      styles.pillDot,
                      { backgroundColor: opt.color, opacity: active ? 1 : 0.55 },
                    ]}
                  />
                  <Text
                    style={[
                      styles.pillLabel,
                      { color: active ? opt.color : '#666' },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Description */}
          <View style={styles.descHeader}>
            <Text style={styles.label}>Detailed Description</Text>
            <Text style={styles.counter}>
              {description.length} / {MAX_DESCRIPTION}
            </Text>
          </View>
          <TextInput
            style={styles.textarea}
            placeholder="Describe the issue in detail..."
            placeholderTextColor="#B7B7B7"
            value={description}
            onChangeText={(t) => setDescription(t.slice(0, MAX_DESCRIPTION))}
            multiline
            maxLength={MAX_DESCRIPTION}
            textAlignVertical="top"
          />

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            activeOpacity={0.9}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.submitText}>Submit Complaint</Text>
                <Ionicons name="paper-plane" size={16} color="#fff" style={{ marginLeft: 8 }} />
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const GREEN = '#3FAE3B';
const GREEN_DARK = '#2E7D32';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { paddingHorizontal: 24, paddingBottom: 40 },

  backBtn: {
    marginTop: 8,
    marginBottom: 18,
    width: 32,
    height: 32,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },

  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111',
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 13,
    color: '#7A7A7A',
    lineHeight: 19,
    marginBottom: 22,
  },

  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
    marginTop: 10,
  },

  input: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 13.5,
    color: '#111',
  },

  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EAEAEA',
  },
  pillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  pillLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },

  descHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 6,
  },
  counter: {
    fontSize: 11,
    color: '#9A9A9A',
    marginBottom: 8,
  },
  textarea: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 13.5,
    color: '#111',
    minHeight: 110,
  },

  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
    borderRadius: 28,
    paddingVertical: 15,
    marginTop: 26,
    shadowColor: GREEN_DARK,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 5,
  },
  submitBtnDisabled: {
    backgroundColor: '#C6E5BF',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
