/**
 * SuccessModal — a designed replacement for the plain Alert.alert(
 * 'Submitted', '...') we use after every request submission (Leave,
 * Permission, Allowance, Attendance, Complaint, Payslip).
 *
 * Why this exists
 * ───────────────
 * The native Alert renders a stark white box with grey text and a
 * blue "OK" button — visually jarring against the otherwise polished
 * green-brand UI. HR asked for a branded success state so employees
 * feel the action completed cleanly.
 *
 * Usage:
 *   const [success, setSuccess] = useState<{ title: string; body: string } | null>(null);
 *   // after submit:
 *   setSuccess({ title: 'Leave Submitted', body: 'HR will review and respond shortly.' });
 *   // render:
 *   <SuccessModal
 *     visible={!!success}
 *     title={success?.title || ''}
 *     body={success?.body || ''}
 *     onClose={() => setSuccess(null)}
 *   />
 */
import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  visible: boolean;
  title: string;
  body?: string;
  /** Override the default "OK" button label, e.g. "Done", "Got it" */
  ctaLabel?: string;
  /** Brand colour for the checkmark + CTA. Defaults to Tesco green. */
  accent?: string;
  onClose: () => void;
};

export default function SuccessModal({
  visible,
  title,
  body,
  ctaLabel = 'OK',
  accent = '#2E7D32',
  onClose,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => { /* swallow */ }}>
          {/* Top accent ribbon */}
          <View style={[styles.ribbon, { backgroundColor: accent }]} />

          {/* Circular tick badge — the dominant visual cue */}
          <View style={[styles.tickBadge, { backgroundColor: accent + '15' }]}>
            <View style={[styles.tickInner, { backgroundColor: accent }]}>
              <Ionicons name="checkmark" size={28} color="#fff" />
            </View>
          </View>

          <Text style={styles.title}>{title}</Text>
          {!!body && <Text style={styles.body}>{body}</Text>}

          <TouchableOpacity
            style={[styles.cta, { backgroundColor: accent }]}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 22,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 32,
    elevation: 18,
    overflow: 'hidden',
  },
  ribbon: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 4,
  },
  tickBadge: {
    width: 86, height: 86, borderRadius: 43,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  tickInner: {
    width: 58, height: 58, borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 4,
  },
  cta: {
    marginTop: 22,
    alignSelf: 'stretch',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 4,
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.4,
  },
});
