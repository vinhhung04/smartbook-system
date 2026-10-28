import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, brand, fontFamily, radii, space } from '../design-system';

type Props = {
  visible: boolean;
  onCaptured: (dataUrl: string) => void;
  onClose: () => void;
};

/**
 * Photo capture (evidence, cover search): a shutter camera, not the barcode
 * scanner. Same permission states and close placement as the scanner, so the
 * two cameras feel like one tool; the shutter is a large round target at the
 * thumb and shows that it is working while the photo is taken.
 */
export function PhotoCaptureModal({ visible, onCaptured, onClose }: Props) {
  const insets = useSafeAreaInsets();
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
      <View style={{ flex: 1, backgroundColor: '#000000' }}>
        {!permission?.granted ? (
          <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.lg, backgroundColor: brand.inkDeep }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="camera-outline" size={30} color="#FFFFFF" />
            </View>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: 24, lineHeight: 30, color: '#FFFFFF' }} accessibilityRole="header">Cần quyền dùng camera</Text>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 23, color: '#C9CCEA' }}>
              {canAskAgain ? 'Ứng dụng cần camera để chụp ảnh.' : 'Bạn đã từ chối quyền camera. Hãy bật lại trong Cài đặt của máy.'}
            </Text>
            <Button
              label={canAskAgain ? 'Cho phép dùng camera' : 'Mở Cài đặt'}
              icon={canAskAgain ? 'camera' : 'settings-outline'}
              variant="inverse"
              onPress={() => (canAskAgain ? void requestPermission() : void Linking.openSettings())}
            />
          </View>
        ) : (
          <>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} />
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: space.lg, paddingBottom: insets.bottom + space.xl, alignItems: 'center', gap: space.lg, backgroundColor: 'rgba(0,0,0,0.45)' }}>
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: 15, color: '#FFFFFF', textAlign: 'center', paddingHorizontal: space.xl }}>
                Giữ máy chắc tay, chụp rõ toàn bộ vật cần ghi lại
              </Text>
              <Pressable
                onPress={handleShutter}
                disabled={isCapturing}
                accessibilityRole="button"
                accessibilityLabel="Chụp ảnh"
                accessibilityState={{ busy: isCapturing }}
                style={({ pressed }) => ({
                  width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                })}
              >
                <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: isCapturing ? 'rgba(255,255,255,0.5)' : '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                  {isCapturing ? <ActivityIndicator color={brand.ink} /> : null}
                </View>
              </Pressable>
            </View>
          </>
        )}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Đóng camera"
          style={({ pressed }) => ({
            position: 'absolute', top: insets.top + space.sm, left: space.lg, width: 48, height: 48, borderRadius: radii.pill,
            alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.16)',
          })}
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
    </Modal>
  );
}
