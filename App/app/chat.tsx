// Chat Screen — BankBot AI Assistant
import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../src/Theme/Colors';
import { sendChatMessage, fetchAiModels, getLocalAccounts, getLocalTransactions } from '../src/API/Client';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [showModels, setShowModels] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  React.useEffect(() => {
    fetchAiModels().then(m => {
      setModels(m);
      if (m.length && !selectedModel) setSelectedModel(m[0]);
    }).catch(() => {});
  }, []);

  const buildContext = async () => {
    const [accounts, txs] = await Promise.all([getLocalAccounts(), getLocalTransactions()]);
    const parts: string[] = [];
    if (accounts.length) {
      parts.push('ACCOUNTS:');
      accounts.forEach(a => parts.push(`  ${a.name}: ${a.currency} ${a.balance}`));
    }
    const recent = txs.slice(0, 20);
    if (recent.length) {
      parts.push('RECENT TRANSACTIONS:');
      recent.forEach(t => {
        const sign = t.amount > 0 ? '+' : '-';
        parts.push(`  ${t.booking_date} | ${t.description || t.merchant_name || '?'} | ${sign}${Math.abs(t.amount)}`);
      });
    }
    return parts.join('\n');
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setSending(true);

    try {
      const context = await buildContext();
      const reply = await sendChatMessage(text, selectedModel, context);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, sending, selectedModel]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <Text style={styles.title}>BankBot</Text>
          {models.length > 0 ? (
            <TouchableOpacity style={styles.modelBtn} onPress={() => setShowModels(!showModels)}>
              <Text style={styles.modelText} numberOfLines={1}>{selectedModel || 'Select model'}</Text>
              <Ionicons name="chevron-down" size={14} color={Colors.Accent} />
            </TouchableOpacity>
          ) : null}
        </View>

        {showModels ? (
          <View style={styles.modelList}>
            <ScrollView style={{ maxHeight: 150 }}>
              {models.map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modelItem, m === selectedModel && styles.modelItemActive]}
                  onPress={() => { setSelectedModel(m); setShowModels(false); }}
                >
                  <Text style={[styles.modelItemText, m === selectedModel && styles.modelItemTextActive]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={48} color={Colors.TextMuted} />
              <Text style={styles.emptyTitle}>Ask BankBot</Text>
              <Text style={styles.emptyText}>
                Questions about your finances, spending, accounts, and transactions.
              </Text>
            </View>
          ) : null}

          {messages.map((m, i) => (
            <View key={i} style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
              <Text style={styles.bubbleText}>{m.content}</Text>
            </View>
          ))}

          {sending ? (
            <View style={[styles.bubble, styles.assistantBubble]}>
              <ActivityIndicator size="small" color={Colors.Accent} />
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Ask about your finances..."
            placeholderTextColor={Colors.TextMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={send}
            returnKeyType="send"
            multiline
            maxLength={2000}
          />
          <TouchableOpacity style={styles.sendBtn} onPress={send} disabled={sending || !input.trim()}>
            <Ionicons name="send" size={20} color={input.trim() && !sending ? Colors.Background : Colors.TextMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.Background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8,
  },
  title: { color: Colors.TextPrimary, fontSize: 22, fontWeight: '700' },
  modelBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.InputBg, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.InputBorder, maxWidth: 180,
  },
  modelText: { color: Colors.Accent, fontSize: 12 },
  modelList: {
    marginHorizontal: 16, marginBottom: 8, backgroundColor: Colors.Card,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.CardBorder, overflow: 'hidden',
  },
  modelItem: { paddingHorizontal: 12, paddingVertical: 10 },
  modelItemActive: { backgroundColor: Colors.Accent + '22' },
  modelItemText: { color: Colors.TextSecondary, fontSize: 13 },
  modelItemTextActive: { color: Colors.Accent, fontWeight: '600' },
  messages: { flex: 1 },
  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { color: Colors.TextPrimary, fontSize: 18, fontWeight: '600' },
  emptyText: { color: Colors.TextMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 12, marginBottom: 8 },
  userBubble: { backgroundColor: Colors.Accent, alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  assistantBubble: {
    backgroundColor: Colors.Card, alignSelf: 'flex-start',
    borderBottomLeftRadius: 4, borderWidth: 1, borderColor: Colors.CardBorder,
  },
  bubbleText: { color: Colors.TextPrimary, fontSize: 14, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', padding: 12, gap: 8,
    borderTopWidth: 1, borderTopColor: Colors.CardBorder, backgroundColor: Colors.Card,
  },
  input: {
    flex: 1, backgroundColor: Colors.InputBg, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.InputBorder, paddingHorizontal: 14,
    paddingVertical: 10, color: Colors.TextPrimary, fontSize: 14, maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: Colors.Accent, borderRadius: 10, width: 42, height: 42,
    alignItems: 'center', justifyContent: 'center',
  },
});
