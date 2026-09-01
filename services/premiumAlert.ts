/**
 * #504 — premiumAlert: a drop-in, Alert.alert-compatible API that renders a
 * branded premium dialog instead of the bare OS alert. Call it exactly like
 * Alert.alert:
 *
 *   premiumAlert('Title');
 *   premiumAlert('Title', 'Message');
 *   premiumAlert('Title', 'Message', [{ text: 'Cancel', style: 'cancel' },
 *                                      { text: 'Submit', onPress: () => {} }]);
 *
 * The <PremiumAlertHost/> mounted once at the app root subscribes to these
 * calls and shows the card. If the host isn't mounted yet (very early cold
 * start), it falls back to the native Alert so no message is ever lost.
 */
export type PremiumButtonStyle = 'default' | 'cancel' | 'destructive';
export type PremiumButton = { text: string; style?: PremiumButtonStyle; onPress?: () => void };
export type PremiumAlertOptions = { cancelable?: boolean; onDismiss?: () => void };
export type PremiumAlertPayload = {
  title: string;
  message?: string;
  buttons?: PremiumButton[];
  options?: PremiumAlertOptions;
};

type Listener = (p: PremiumAlertPayload) => void;
let listener: Listener | null = null;

/** Internal: the host binds/unbinds itself here. */
export function _bindPremiumAlert(fn: Listener | null) {
  listener = fn;
}

export function premiumAlert(
  title: string,
  message?: string,
  buttons?: PremiumButton[],
  options?: PremiumAlertOptions,
): void {
  if (listener) {
    listener({ title, message, buttons, options });
  } else {
    // Host not mounted yet — never drop the message.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Alert } = require('react-native');
      Alert.alert(title, message, buttons as any, options as any);
    } catch { /* nothing else we can do */ }
  }
}
