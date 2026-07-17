// Profile Screen — Settings & Configuration
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../src/Theme/Colors';
import {
  getSettings, saveSettings, fetchAiModels, fetchBanks,
  startBankAuth, openBankAuth, exchangeCode,
  getConnections, addConnection, removeConnection,
  AppSettings, BankConnection,
} from '../src/API/Client';

export default function ProfileScreen() {
  const [settings, setSettings] = useState<AppSettings>({
    EnableBankingAppId: '', EnableBankingKey: '', AiEndpoint: '', AiApiKey: '', AiModel: '',
  });
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);

  // Banks state
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [bankSearch, setBankSearch] = useState('');
  const [showBankPicker, setShowBankPicker] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const loadSettings = useCallback(async () => {
    const s = await getSettings();
    setSettings(s);
    const conns = await getConnections();
    setConnections(conns);
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

  // ── AI Models ──

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

  // ── Banks ──

  const handleLoadBanks = async () => {
    setLoadingBanks(true);
    try {
      const list = await fetchBanks();
      setBanks(list);
      setShowBankPicker(true);
    } catch (e: any) {
      Alert.alert('Error', `Could not load banks: ${e.message}`);
    } finally {
      setLoadingBanks(false);
    }
  };

  const handleConnectBank = async (bank: any) => {
    setShowBankPicker(false);
    setConnecting(true);
    try {
      const authData = await startBankAuth(bank.name, bank.country);
      const authUrl = authData.url || authData.redirect_url;
      if (!authUrl) throw new Error('No auth URL returned');

      const { code } = await openBankAuth(authUrl);
      const sessionData = await exchangeCode(code);

      const conn: BankConnection = {
        id: sessionData.session_id || Date.now().toString(),
        bankName: bank.name,
        bankCountry: bank.country || '',
        sessionId: sessionData.session_id || '',
        connectedAt: new Date().toISOString(),
      };

      await addConnection(conn);
      setConnections(prev => [...prev, conn]);
      Alert.alert('Connected', `${bank.name} connected successfully.`);
    } catch (e: any) {
      Alert.alert('Error', `Connection failed: ${e.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleRemoveConnection = (conn: BankConnection) => {
    Alert.alert('Remove', `Disconnect ${conn.bankName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          await removeConnection(conn.id);
          setConnections(prev => prev.filter(c => c.id !== conn.id));
        },
      },
    ]);
  };

  const filteredBanks = banks.filter(b =>
    !bankSearch || (b.name || '').toLowerCase().includes(bankSearch.toLowerCase())
  );

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

            {/* Redirect URL Info */}
            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => Alert.alert(
                'Redirect URL',
                'In your Enable Banking application settings, set the redirect URL to:\n\nhttps://roanh47.github.io/Roans-Banking-Dashboard/callback.html\n\nThis is needed for the OAuth flow to work.',
              )}
            >
              <Ionicons name="information-circle" size={18} color={Colors.Accent} />
              <Text style={styles.infoText}>Where do I set the redirect URL?</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Banks ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Banks</Text>
          <View style={styles.card}>
            {/* Connected Banks */}
            {connections.length > 0 ? (
              <>
                <Text style={styles.label}>Connected Banks</Text>
                {connections.map(conn => (
                  <View key={conn.id} style={styles.connectionRow}>
                    <View style={styles.connectionInfo}>
                      <Ionicons name="card" size={18} color={Colors.Accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.connectionName}>{conn.bankName}</Text>
                        <Text style={styles.connectionSub}>
                          Connected {new Date(conn.connectedAt).toLocaleDateString('nl-NL')}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => handleRemoveConnection(conn)}>
                      <Ionicons name="trash-outline" size={18} color={Colors.Red} />
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={{ height: 12 }} />
              </>
            ) : null}

            {/* Connect Bank Button */}
            <TouchableOpacity
              style={styles.connectBtn}
              onPress={handleLoadBanks}
              disabled={loadingBanks || connecting || !settings.EnableBankingAppId}
            >
              {loadingBanks ? (
                <ActivityIndicator size="small" color={Colors.Accent} />
              ) : connecting ? (
                <ActivityIndicator size="small" color={Colors.Accent} />
              ) : (
                <>
                  <Ionicons name="add-circle-outline" size={18} color={Colors.Accent} />
                  <Text style={styles.connectBtnText}>Connect Bank</Text>
                </>
              )}
            </TouchableOpacity>
            {!settings.EnableBankingAppId ? (
              <Text style={styles.hint}>Set your Enable Banking App ID first.</Text>
            ) : null}
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

      {/* ── Bank Picker Modal ── */}
      <Modal visible={showBankPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Bank</Text>
              <TouchableOpacity onPress={() => setShowBankPicker(false)}>
                <Ionicons name="close" size={24} color={Colors.TextPrimary} />
              </TouchableOpacity>
            </View>
            <View style={styles.bankSearchBox}>
              <Ionicons name="search" size={16} color={Colors.TextMuted} />
              <TextInput
                style={styles.bankSearchInput}
                placeholder="Search banks..."
                placeholderTextColor={Colors.TextMuted}
                value={bankSearch}
                onChangeText={setBankSearch}
              />
            </View>
            <FlatList
              data={filteredBanks.slice(0, 50)}
              keyExtractor={(item, i) => item.name + i}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.bankItem}
                  onPress={() => handleConnectBank(item)}
                >
                  <Ionicons name="card-outline" size={18} color={Colors.TextSecondary} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.bankItemName}>{item.name}</Text>
                    <Text style={styles.bankItemCountry}>{item.country || ''}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.TextMuted} />
                </TouchableOpacity>
              )}
              style={{ maxHeight: 400 }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No banks found</Text>
              }
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
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 12, paddingVertical: 4,
  },
  infoText: { color: Colors.Accent, fontSize: 13, textDecorationLine: 'underline' },
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
  connectionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.CardBorder,
  },
  connectionInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  connectionName: { color: Colors.TextPrimary, fontSize: 14, fontWeight: '500' },
  connectionSub: { color: Colors.TextMuted, fontSize: 12, marginTop: 2 },
  connectBtn: {
    backgroundColor: Colors.Accent + '22', borderRadius: 8, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.Accent + '44',
  },
  connectBtnText: { color: Colors.Accent, fontSize: 14, fontWeight: '600' },
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
  bankSearchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.InputBg,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.InputBorder,
    marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  bankSearchInput: { flex: 1, color: Colors.TextPrimary, fontSize: 14, marginLeft: 8, padding: 0 },
  bankItem: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.CardBorder,
  },
  bankItemName: { color: Colors.TextPrimary, fontSize: 14, fontWeight: '500' },
  bankItemCountry: { color: Colors.TextMuted, fontSize: 12, marginTop: 2 },
  emptyText: { color: Colors.TextMuted, fontSize: 13, textAlign: 'center', padding: 24 },
});
