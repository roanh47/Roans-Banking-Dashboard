// Profile Screen — Settings & Configuration
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../src/Theme/Colors';
import { getSettings, saveSettings, fetchAiModels, AppSettings } from '../src/API/Client';

export default function ProfileScreen() {
  const [settings, setSettings] = useState<AppSettings>({
    EnableBankingAppId: '', EnableBankingKey: '', AiEndpoint: '', AiApiKey: '', AiModel: '',
  });
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showModels, setShowModels] = useState(false);

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
    if (!settings.AiEndpoint) return;
    try {
      const models = await fetchAiModels();
      setAiModels(models);
      setShowModels(true);
    } catch {
      Alert.alert('Error', 'Could not fetch models.');
    }
  };

  return (
    <ScrollView style={styles.container}>
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
            placeholder="Paste your private key here"
            placeholderTextColor={Colors.TextMuted}
            value={settings.EnableBankingKey}
            onChangeText={v => update('EnableBankingKey', v)}
            multiline
            autoCapitalize="none"
          />
          <Text style={styles.hint}>Used to sign JWT requests to Enable Banking.</Text>
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

          <Text style={[styles.label, { marginTop: 12 }]}>Model</Text>
          {aiModels.length > 0 && showModels ? (
            <View style={styles.modelList}>
              {aiModels.map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modelItem, settings.AiModel === m && styles.modelItemActive]}
                  onPress={() => { update('AiModel', m); setShowModels(false); }}
                >
                  <Text style={[styles.modelItemText, settings.AiModel === m && styles.modelItemTextActive]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          <TextInput
            style={styles.input}
            placeholder="Model name (or fetch list)"
            placeholderTextColor={Colors.TextMuted}
            value={settings.AiModel}
            onChangeText={v => update('AiModel', v)}
            autoCapitalize="none"
          />

          <TouchableOpacity style={styles.testBtn} onPress={handleFetchModels} disabled={!settings.AiEndpoint}>
            <Text style={styles.testBtnText}>Fetch Models</Text>
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.Background },
  header: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12 },
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
  testBtn: {
    backgroundColor: Colors.Accent + '22', borderRadius: 8, paddingVertical: 10,
    alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: Colors.Accent + '44',
  },
  testBtnText: { color: Colors.Accent, fontSize: 14, fontWeight: '600' },
  modelList: {
    backgroundColor: Colors.InputBg, borderRadius: 8, borderWidth: 1,
    borderColor: Colors.InputBorder, marginBottom: 8, maxHeight: 150,
  },
  modelItem: { paddingHorizontal: 12, paddingVertical: 10 },
  modelItemActive: { backgroundColor: Colors.Accent + '22' },
  modelItemText: { color: Colors.TextSecondary, fontSize: 13 },
  modelItemTextActive: { color: Colors.Accent, fontWeight: '600' },
  saveBtn: {
    backgroundColor: Colors.Accent, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginHorizontal: 16, marginTop: 8,
  },
  saveBtnText: { color: Colors.Background, fontSize: 16, fontWeight: '700' },
  appInfo: { alignItems: 'center', marginTop: 24 },
  appInfoText: { color: Colors.TextMuted, fontSize: 12 },
});
