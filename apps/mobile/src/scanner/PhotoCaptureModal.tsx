import { useRef, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { colors, fonts, radius, spacing } from '../theme/tokens';

type Props = {
  visible: boolean;
  onCaptured: (dataUrl: string) => void;
  onClose: () => void;
};

/** Photo-evidence capture — shutter camera, not the barcode scanner. */
export function PhotoCaptureModal({ visible, onCaptured, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  if (!visible) return null;

  const canAskAgain = permission?.canAskAgain ?? true;

  async function handleShutter() {
    if (isCapturing || !cameraRef.current) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: true });
      if (photo?.base64) {
        onCaptured(`data:image/jpeg;base64,${photo.base64}`);
      }
    } finally {
      setIsCapturing(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {!permission?.granted ? (
          <View style={styles.permissionBox}>
            <Text style={styles.permissionText}>Cần quyền truy cập camera để chụp ảnh bằng chứng</Text>
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
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} />
            <View style={styles.hintOverlay} pointerEvents="none">
              <Text style={styles.hint}>Chụp ảnh sản phẩm/kiện hàng làm bằng chứng</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.shutter, (pressed || isCapturing) && styles.shutterActive]}
              onPress={handleShutter}
              disabled={isCapturing}
              accessibilityRole="button"
              accessibilityLabel="Chụp ảnh"
            >
              <View style={styles.shutterInner} />
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
    fontFamily: fonts.displayBold,
    color: colors.onPrimary,
  },
  hintOverlay: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: {
    color: '#fff',
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  shutter: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterActive: {
    opacity: 0.6,
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
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
    fontFamily: fonts.bodySemibold,
  },
});
