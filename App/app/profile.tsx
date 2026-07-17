// Profile Screen — Settings & Configuration
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../src/Theme/Colors';
import {
  getSettings, saveSettings, testConnection, AppSettings,
  fetchConnections, deleteConnection, fetchAiModels, BankConnection,
} from '../src/API/Client';

export default function ProfileScreen() {
  const [settings, setSettings] = useState<AppSettings>({
    ServerUrl: '', EnableBankingAppId: '', AiEndpoint: '', AiApiKey: '', AiModel: '',
  });
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [showModels, setShowModels] = useState(false);

  const loadSettings = useCallback(async () => {
    const s = await getSettings();
    setSettings(s);
    if (s.ServerUrl) {
      try {
        const conns = await fetchConnections();
        setConnections(conns.connections);
      } catch {}
    }
  }, []);

  React.useEffect(() => { loadSettings(); }, [loadSettings]);

  const update = (key: keyof AppSettings, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleTestConnection = async () => {
    setTesting(true);
    const ok = await testConnection(settings.ServerUrl);
    setConnected(ok);
    setTesting(false);
    if (ok) {
      try {
        const conns = await fetchConnections();
        setConnections(conns.connections);
      } catch {}
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await saveSettings(settings);
    setSaving(false);
    Alert.alert('Saved', 'Settings saved successfully.');
  };

  const handleDeleteConnection = (id: number, name: string) => {
    Alert.alert('Delete', `Remove ${name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteConnection(id);
          setConnections(prev => prev.filter(c => c.id !== id));
        },
      },
    ]);
  };

  const handleFetchModels = async () => {
    if (!settings.AiEndpoint) return;
    try {
      const data = await fetchAiModels();
      setAiModels(data.models);
      setShowModels(true);
    } catch {
      Alert.alert('Error', 'Could not fetch models from AI endpoint.');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile & Settings</Text>
      </View>

      {/* ── Server Connection ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Server</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Server URL</Text>
          <TextInput
            style={styles.input}
            placeholder="https://banking.example.com"
            placeholderTextColor={Colors.TextMuted}
            value={settings.ServerUrl}
            onChangeText={v => update('ServerUrl', v)}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          {/* Connection Status */}
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: connected === true ? Colors.Green : connected === false ? Colors.Red : Colors.TextMuted }]} />
            <Text style={styles.statusText}>
              {connected === true ? 'Connected' : connected === false ? 'Cannot reach server' : 'Not tested'}
            </Text>
          </View>

          <TouchableOpacity style={styles.testBtn} onPress={handleTestConnection} disabled={testing || !settings.ServerUrl}>
            {testing ? (
              <ActivityIndicator size="small" color={Colors.Accent} />
            ) : (
              <Text style={styles.testBtnText}>Test Connection</Text>
            )}
          </TouchableOpacity>
        </View>
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

          {connections.length > 0 ? (
            <>
              <Text style={[styles.label, { marginTop: 16 }]}>Linked Banks</Text>
              {connections.map(c => (
                <View key={c.id} style={styles.connectionRow}>
                  <View style={styles.connectionInfo}>
                    <Ionicons name="card" size={16} color={Colors.Accent} />
                    <Text style={styles.connectionName}>{c.bank_name}</Text>
                    <Text style={styles.connectionSub}>{c.account_count} account{c.account_count !== 1 ? 's' : ''}</Text>
                  </View>
                  <TouchableOpacity onPress={() => handleDeleteConnection(c.id, c.bank_name)}>
                    <Ionicons name="trash-outline" size={18} color={Colors.Red} />
                  </TouchableOpacity>
                </View>
              ))}
            </>
          ) : (
            <Text style={styles.hint}>No banks linked. Connect via the web dashboard first.</Text>
          )}
        </View>
      </View>

      {/* ── AI / BankBot ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>AI / BankBot</Text>
        <View style={styles.card}>
          <Text style={styles.label}>AI Endpoint</Text>
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
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: Colors.TextSecondary, fontSize: 13 },
  testBtn: {
    backgroundColor: Colors.Accent + '22', borderRadius: 8, paddingVertical: 10,
    alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: Colors.Accent + '44',
  },
  testBtnText: { color: Colors.Accent, fontSize: 14, fontWeight: '600' },
  connectionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.CardBorder,
  },
  connectionInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  connectionName: { color: Colors.TextPrimary, fontSize: 14, fontWeight: '500' },
  connectionSub: { color: Colors.TextMuted, fontSize: 12 },
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
