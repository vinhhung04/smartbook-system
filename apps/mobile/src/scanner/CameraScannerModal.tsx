import { useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { colors, radius, spacing } from '../theme/tokens';

type Props = {
  visible: boolean;
  onScanned: (code: string) => void;
  onClose: () => void;
};

export function CameraScannerModal({ visible, onScanned, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  if (!visible) return null;

  function handleBarcodeScanned(result: { data: string }) {
    if (locked) return;
    setLocked(true);
    onScanned(result.data);
  }

  // Once the user has permanently denied camera access, requestPermission() no longer
  // shows the OS dialog — canAskAgain flips to false and the only way back is Settings.
  const canAskAgain = permission?.canAskAgain ?? true;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => {
        setLocked(false);
        setTorchOn(false);
      }}
    >
      <View style={styles.container}>
        {!permission?.granted ? (
          <View style={styles.permissionBox}>
            <Text style={styles.permissionText}>Cần quyền truy cập camera để quét mã</Text>
            <Pressable
              style={styles.button}
              onPress={() => (canAskAgain ? requestPermission() : Linking.openSettings())}
            >
              <Text style={styles.buttonText}>
                {canAskAgain ? 'Cấp quyền camera' : 'Mở cài đặt để cấp quyền'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              enableTorch={torchOn}
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8'] }}
              onBarcodeScanned={handleBarcodeScanned}
            />
            <View style={styles.viewfinderOverlay} pointerEvents="none">
              <View style={styles.viewfinderFrame} />
              <Text style={styles.viewfinderHint}>Đưa mã vào khung để quét</Text>
            </View>
            <Pressable style={styles.torchButton} onPress={() => setTorchOn((v) => !v)} hitSlop={8}>
              <Text style={styles.closeText}>{torchOn ? 'Tắt đèn' : 'Bật đèn'}</Text>
            </Pressable>
          </>
        )}
        <Pressable style={styles.closeButton} onPress={onClose} hitSlop={8}>
          <Text style={styles.closeText}>Đóng</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  permissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
  },
  permissionText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  buttonText: {
    color: colors.onPrimary,
    fontWeight: '600',
  },
  viewfinderOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  viewfinderFrame: {
    width: '72%',
    aspectRatio: 1.6,
    borderRadius: radius.lg,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  viewfinderHint: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  torchButton: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  closeButton: {
    position: 'absolute',
    top: 48,
    right: 24,
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  closeText: {
    color: '#fff',
    fontWeight: '600',
  },
});
