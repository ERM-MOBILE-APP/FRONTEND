/**
 * CheckInButton — stub component (Jun 2026, fix E).
 *
 * This file was previously 0 bytes which caused a silent module-parse
 * error whenever anything tried to import it, manifesting as an
 * unexplained app reload. The actual check-in button logic lives inline
 * in app/(tabs)/index.tsx — this stub exists so no import ever fails.
 */
import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

type Props = {
  label?: string;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
};

export default function CheckInButton({ label = 'Check In', onPress, disabled, busy }: Props) {
  return (
    <TouchableOpacity
      style={[styles.btn, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled || busy}
      activeOpacity={0.85}
    >
      <Text style={styles.text}>{busy ? 'Please wait…' : label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 22,
  },
  disabled: { opacity: 0.5 },
  text: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
