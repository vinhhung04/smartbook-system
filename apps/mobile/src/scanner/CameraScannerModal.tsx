import { useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, brand, fontFamily, radii, space, type IconName } from '../design-system';

type Props = {
  visible: boolean;
  onScanned: (code: string) => void;
  onClose: () => void;
};

const SHADE = 'rgba(0,0,0,0.55)';
const CORNER = 28;

/** One corner bracket of the viewfinder. */
function Corner({ position }: { position: 'tl' | 'tr' | 'bl' | 'br' }) {
  const top = position[0] === 't';
  const left = position[1] === 'l';
  return (
    <View
      style={{
        position: 'absolute', width: CORNER, height: CORNER, borderColor: '#FFFFFF',
        top: top ? -2 : undefined, bottom: top ? undefined : -2, left: left ? -2 : undefined, right: left ? undefined : -2,
        borderTopWidth: top ? 4 : 0, borderBottomWidth: top ? 0 : 4, borderLeftWidth: left ? 4 : 0, borderRightWidth: left ? 0 : 4,
        borderTopLeftRadius: top && left ? 10 : 0, borderTopRightRadius: top && !left ? 10 : 0,
        borderBottomLeftRadius: !top && left ? 10 : 0, borderBottomRightRadius: !top && !left ? 10 : 0,
      }}
    />
  );
}

function TopButton({ icon, label, onPress, active = false }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        minHeight: 48, minWidth: 48, paddingHorizontal: space.md, borderRadius: radii.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        backgroundColor: active ? '#FFFFFF' : pressed ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.16)',
      })}
    >
      <Ionicons name={icon} size={20} color={active ? '#000000' : '#FFFFFF'} />
      {label.length < 12 ? <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: active ? '#000000' : '#FFFFFF' }}>{label}</Text> : null}
    </Pressable>
  );
}

/**
 * Full-screen camera scanner for a worker standing in an aisle: the code goes in
 * a bright framed window, everything else is shaded; close and torch sit in the
 * thumb-reachable safe area; typing the code by hand is one tap away. One code
 * per opening (the `locked` guard), so a code held in front of the lens is never
 * submitted twice. No moving scan line: the camera keeps its frame rate.
 */
export function CameraScannerModal({ visible, onScanned, onClose }: Props) {
  const insets = useSafeAreaInsets();
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
      <View style={{ flex: 1, backgroundColor: '#000000' }}>
        {!permission?.granted ? (
          <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.lg, backgroundColor: brand.inkDeep }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="camera-outline" size={30} color="#FFFFFF" />
            </View>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: 24, lineHeight: 30, color: '#FFFFFF' }} accessibilityRole="header">Cần quyền dùng camera</Text>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 23, color: '#C9CCEA' }}>
              {canAskAgain
                ? 'Ứng dụng dùng camera để đọc mã vạch và mã QR. Ảnh không được lưu lại.'
                : 'Bạn đã từ chối quyền camera. Hãy bật lại trong Cài đặt của máy, hoặc nhập mã bằng tay.'}
            </Text>
            <Button
              label={canAskAgain ? 'Cho phép dùng camera' : 'Mở Cài đặt'}
              icon={canAskAgain ? 'camera' : 'settings-outline'}
              variant="inverse"
              onPress={() => (canAskAgain ? void requestPermission() : void Linking.openSettings())}
            />
            <Button label="Nhập mã bằng tay" variant="ghost" onPress={onClose} />
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              enableTorch={torchOn}
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8'] }}
              onBarcodeScanned={handleBarcodeScanned}
            />
            {/* Shade everything except the window the code goes in. */}
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <View style={{ flex: 1, backgroundColor: SHADE }} />
              <View style={{ flexDirection: 'row' }}>
                <View style={{ flex: 1, backgroundColor: SHADE }} />
                <View style={{ width: '78%', aspectRatio: 1.55 }}>
                  <Corner position="tl" />
                  <Corner position="tr" />
                  <Corner position="bl" />
                  <Corner position="br" />
                </View>
                <View style={{ flex: 1, backgroundColor: SHADE }} />
              </View>
              <View style={{ flex: 1, backgroundColor: SHADE, alignItems: 'center', paddingTop: space.xl, paddingHorizontal: space.xl }}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: 16, color: '#FFFFFF', textAlign: 'center' }}>Đưa mã vạch hoặc mã QR vào khung</Text>
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, color: 'rgba(255,255,255,0.75)', textAlign: 'center', marginTop: 4 }}>Ứng dụng tự quét khi mã nằm gọn trong khung.</Text>
              </View>
            </View>
          </>
        )}

        <View style={{ position: 'absolute', top: insets.top + space.sm, left: space.lg, right: space.lg, flexDirection: 'row', justifyContent: 'space-between' }}>
          <TopButton icon="close" label="Đóng máy quét" onPress={onClose} />
          {permission?.granted ? <TopButton icon={torchOn ? 'flashlight' : 'flashlight-outline'} label={torchOn ? 'Tắt đèn' : 'Bật đèn'} onPress={() => setTorchOn((v) => !v)} active={torchOn} /> : null}
        </View>

        {permission?.granted ? (
          <View style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: insets.bottom + space.lg }}>
            <Button label="Nhập mã bằng tay" icon="keypad-outline" variant="inverse" onPress={onClose} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
