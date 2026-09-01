import React from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { _bindPremiumAlert, PremiumAlertPayload, PremiumButton } from '../services/premiumAlert';

/**
 * #504 — Single host for premiumAlert(). Mounted once at the app root. Renders
 * a branded card matching the app's premium confirm dialogs, deriving the icon
 * + accent colour from the button set and the message:
 *   • any destructive button → red "alert-triangle"
 *   • a 2-button choice       → green "help-circle"
 *   • an error-ish 1-button   → amber "alert-circle"
 *   • otherwise (info/success)→ green "check-circle"
 */
export default function PremiumAlertHost() {
  const [payload, setPayload] = React.useState<PremiumAlertPayload | null>(null);

  React.useEffect(() => {
    _bindPremiumAlert((p) => setPayload(p));
    return () => _bindPremiumAlert(null);
  }, []);

  if (!payload) return null;

  const close = () => setPayload(null);
  const buttons: PremiumButton[] =
    payload.buttons && payload.buttons.length ? payload.buttons : [{ text: 'OK' }];

  const isCancel = (b: PremiumButton) =>
    b.style === 'cancel' || /^(cancel|no|not now|dismiss|back)$/i.test(String(b.text).trim());

  const hasDestructive = buttons.some((b) => b.style === 'destructive');
  const isChoice = buttons.length >= 2;
  const text = `${payload.title} ${payload.message || ''}`.toLowerCase();
  const errorLike =
    /error|failed|invalid|unable|cannot|can'?t|couldn'?t|required|not allowed|denied|wrong|at most|too |limit|expired|please/.test(
      text,
    );

  let accent = '#4CAF50';
  let soft = '#E9F7EC';
  let icon: keyof typeof Feather.glyphMap = 'check-circle';
  if (hasDestructive) { accent = '#E5484D'; soft = '#FDECEC'; icon = 'alert-triangle'; }
  else if (isChoice)  { accent = '#4CAF50'; soft = '#E9F7EC'; icon = 'help-circle'; }
  else if (errorLike) { accent = '#F59E0B'; soft = '#FEF3E2'; icon = 'alert-circle'; }

  const onBackdrop = () => {
    if (payload.options?.cancelable === false) return;
    const dismiss = payload.options?.onDismiss;
    close();
    if (dismiss) setTimeout(() => { try { dismiss(); } catch {} }, 0);
  };
  const run = (b: PremiumButton) => {
    close();
    if (b.onPress) setTimeout(() => { try { b.onPress!(); } catch {} }, 0);
  };

  const stacked = buttons.length > 2;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onBackdrop}>
      <Pressable style={styles.backdrop} onPress={onBackdrop}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={[styles.iconCircle, { backgroundColor: soft }]}>
            <Feather name={icon} size={28} color={accent} />
          </View>

          <Text style={styles.title}>{payload.title}</Text>
          {!!payload.message && <Text style={styles.message}>{payload.message}</Text>}

          <View style={[styles.btnRow, stacked && { flexDirection: 'column' }]}>
            {buttons.map((b, i) => {
              const cancel = isCancel(b);
              const bg = cancel ? '#F1F5F9' : (b.style === 'destructive' ? '#E5484D' : accent);
              return (
                <TouchableOpacity
                  key={`${b.text}-${i}`}
                  style={[
                    styles.btn,
                    { backgroundColor: bg },
                    stacked && { marginBottom: i < buttons.length - 1 ? 10 : 0, alignSelf: 'stretch' },
                  ]}
                  onPress={() => run(b)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.btnText, { color: cancel ? '#334155' : '#FFFFFF' }]}>{b.text}</Text>
                </TouchableOpacity>
              );
            })}
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
  btnText: { fontSize: 14.5, fontWeight: '700' },
});
