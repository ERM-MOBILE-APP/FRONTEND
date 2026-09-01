import React from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';

/**
 * #502 — Premium confirmation dialog. Replaces the bare OS Alert.alert used
 * for "Are you sure you want to log out / check out?" with a branded card:
 * a tinted icon circle, title, message, and a two-button row (Cancel + a
 * coloured confirm). Reusable via `tone` — 'danger' (red, logout),
 * 'blue' (check-out), or 'primary' (green).
 */
export type ConfirmTone = 'danger' | 'blue' | 'primary';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  icon?: keyof typeof Feather.glyphMap;
  tone?: ConfirmTone;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const TONES: Record<ConfirmTone, { accent: string; soft: string }> = {
  danger:  { accent: '#E5484D', soft: '#FDECEC' },
  blue:    { accent: '#2563EB', soft: '#E7F0FE' },
  primary: { accent: '#4CAF50', soft: '#E9F7EC' },
};

export default function ConfirmModal({
  visible,
  title,
  message,
  icon = 'help-circle',
  tone = 'primary',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  const t = TONES[tone] || TONES.primary;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={[styles.iconCircle, { backgroundColor: t.soft }]}>
            <Feather name={icon} size={28} color={t.accent} />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, styles.cancelBtn]}
              onPress={onCancel}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelText}>{cancelText}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: t.accent }]}
              onPress={onConfirm}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmText}>{confirmText}</Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingTop: 26,
    paddingBottom: 18,
    paddingHorizontal: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 28,
    elevation: 12,
  },
  iconCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#0F172A', textAlign: 'center' },
  message: {
    fontSize: 13.5,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 22,
  },
  btnRow: { flexDirection: 'row', alignSelf: 'stretch', gap: 12 },
  btn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: { backgroundColor: '#F1F5F9' },
  cancelText: { color: '#334155', fontSize: 14.5, fontWeight: '700' },
  confirmText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
});
