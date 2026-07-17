// Profile Screen — Settings & Configuration
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../src/Theme/Colors';
import { getSettings, saveSettings, fetchAiModels, AppSettings } from '../src/API/Client';

export default function ProfileScreen() {
  const [settings, setSettings] = useState<AppSettings>({
    EnableBankingAppId: '', EnableBankingKey: '', AiEndpoint: '', AiApiKey: '', AiModel: '',
  });
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);

  const loadSettings = useCallback(async () => {
    const s = await getSettings();
    setSettings(s);
  }, []);

  React.useEffect(() => { loadSettings(); }, [loadSettings]);

  const update = (key: keyof AppSettings, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    await saveSettings(settings);
    setSaving(false);
    Alert.alert('Saved', 'Settings saved.');
  };

  const handleFetchModels = async () => {
    if (!settings.AiEndpoint) {
      Alert.alert('Error', 'Enter an AI endpoint first.');
      return;
    }
    setLoadingModels(true);
    try {
      const models = await fetchAiModels();
      setAiModels(models);
      if (models.length === 0) {
        Alert.alert('No models', 'Endpoint returned no models. Check your endpoint and API key.');
      } else {
        setShowModelPicker(true);
      }
    } catch (e: any) {
      Alert.alert('Error', `Could not fetch models: ${e.message}`);
    } finally {
      setLoadingModels(false);
    }
  };

  const selectModel = (model: string) => {
    update('AiModel', model);
    setShowModelPicker(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Profile & Settings</Text>
        </View>

        {/* ── Enable Banking ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Enable Banking</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Application ID</Text>
            <TextInput
              style={styles.input}
              placeholder="your-app-id"
              placeholderTextColor={Colors.TextMuted}
              value={settings.EnableBankingAppId}
              onChangeText={v => update('EnableBankingAppId', v)}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[styles.label, { marginTop: 12 }]}>Private Key (.pem)</Text>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              placeholder="-----BEGIN RSA PRIVATE KEY-----"
              placeholderTextColor={Colors.TextMuted}
              value={settings.EnableBankingKey}
              onChangeText={v => update('EnableBankingKey', v)}
              multiline
              autoCapitalize="none"
            />
            <Text style={styles.hint}>Used to sign JWT requests to Enable Banking API.</Text>
          </View>
        </View>

        {/* ── AI / BankBot ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI / BankBot</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Endpoint</Text>
            <TextInput
              style={styles.input}
              placeholder="https://api.openai.com/v1"
              placeholderTextColor={Colors.TextMuted}
              value={settings.AiEndpoint}
              onChangeText={v => update('AiEndpoint', v)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <Text style={[styles.label, { marginTop: 12 }]}>API Key</Text>
            <TextInput
              style={styles.input}
              placeholder="sk-..."
              placeholderTextColor={Colors.TextMuted}
              value={settings.AiApiKey}
              onChangeText={v => update('AiApiKey', v)}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />

            {/* Model selector */}
            <Text style={[styles.label, { marginTop: 12 }]}>Model</Text>
            <TouchableOpacity
              style={styles.modelSelector}
              onPress={() => aiModels.length > 0 ? setShowModelPicker(true) : handleFetchModels()}
            >
              <Text style={[styles.modelSelectorText, !settings.AiModel && { color: Colors.TextMuted }]}>
                {settings.AiModel || 'Select a model...'}
              </Text>
              <Ionicons name="chevron-down" size={16} color={Colors.TextSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.fetchBtn}
              onPress={handleFetchModels}
              disabled={loadingModels || !settings.AiEndpoint}
            >
              {loadingModels ? (
                <ActivityIndicator size="small" color={Colors.Accent} />
              ) : (
                <Text style={styles.fetchBtnText}>Fetch Models</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Save Button ── */}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color={Colors.Background} />
          ) : (
            <Text style={styles.saveBtnText}>Save Settings</Text>
          )}
        </TouchableOpacity>

        {/* ── App Info ── */}
        <View style={styles.appInfo}>
          <Text style={styles.appInfoText}>Roan's Banking App v0.0.1</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Model Picker Modal ── */}
      <Modal visible={showModelPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Model</Text>
              <TouchableOpacity onPress={() => setShowModelPicker(false)}>
                <Ionicons name="close" size={24} color={Colors.TextPrimary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={aiModels}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modelItem, item === settings.AiModel && styles.modelItemActive]}
                  onPress={() => selectModel(item)}
                >
                  <Text style={[styles.modelItemText, item === settings.AiModel && styles.modelItemTextActive]}>
                    {item}
                  </Text>
                  {item === settings.AiModel && (
                    <Ionicons name="checkmark" size={18} color={Colors.Accent} />
                  )}
                </TouchableOpacity>
              )}
              style={{ maxHeight: 400 }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.Background },
  scroll: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  title: { color: Colors.TextPrimary, fontSize: 22, fontWeight: '700' },
  section: { marginBottom: 16 },
  sectionTitle: {
    color: Colors.TextSecondary, fontSize: 13, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1,
    paddingHorizontal: 16, marginBottom: 8,
  },
  card: {
    backgroundColor: Colors.Card, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.CardBorder, padding: 16, marginHorizontal: 16,
  },
  label: { color: Colors.TextSecondary, fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: Colors.InputBg, borderRadius: 8, borderWidth: 1,
    borderColor: Colors.InputBorder, paddingHorizontal: 12, paddingVertical: 10,
    color: Colors.TextPrimary, fontSize: 14,
  },
  hint: { color: Colors.TextMuted, fontSize: 12, marginTop: 8 },
  modelSelector: {
    backgroundColor: Colors.InputBg, borderRadius: 8, borderWidth: 1,
    borderColor: Colors.InputBorder, paddingHorizontal: 12, paddingVertical: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  modelSelectorText: { color: Colors.TextPrimary, fontSize: 14 },
  fetchBtn: {
    backgroundColor: Colors.Accent + '22', borderRadius: 8, paddingVertical: 10,
    alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: Colors.Accent + '44',
  },
  fetchBtnText: { color: Colors.Accent, fontSize: 14, fontWeight: '600' },
  saveBtn: {
    backgroundColor: Colors.Accent, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginHorizontal: 16, marginTop: 8,
  },
  saveBtnText: { color: Colors.Background, fontSize: 16, fontWeight: '700' },
  appInfo: { alignItems: 'center', marginTop: 24 },
  appInfoText: { color: Colors.TextMuted, fontSize: 12 },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.Card, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingTop: 16, paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, marginBottom: 12,
  },
  modalTitle: { color: Colors.TextPrimary, fontSize: 18, fontWeight: '600' },
  modelItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.CardBorder,
  },
  modelItemActive: { backgroundColor: Colors.Accent + '15' },
  modelItemText: { color: Colors.TextSecondary, fontSize: 14, flex: 1 },
  modelItemTextActive: { color: Colors.Accent, fontWeight: '600' },
});
