/**
 * X-Posed Mobile App - Batch Lookup Component
 * Look up multiple users at once
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, glassShadow } from '@/styles/commonStyles';
import { IconSymbol } from '@/components/IconSymbol';
import { LocationEntry, LookupMode, Session } from '../types';
import { NetworkManager } from '../services/NetworkManager';
import { getFlag, getDeviceEmoji } from '../utils/countryFlags';

interface BatchResult {
  username: string;
  data: LocationEntry | null;
  error?: string;
}

interface BatchLookupProps {
  mode: LookupMode;
  session?: Session;
  onResultSelect?: (username: string, data: LocationEntry) => void;
}

export function BatchLookup({ mode, session, onResultSelect }: BatchLookupProps) {
  const [input, setInput] = useState('');
  const [results, setResults] = useState<BatchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  /**
   * Parse usernames from input
   */
  const parseUsernames = useCallback((text: string): string[] => {
    // Split by newlines, commas, or spaces
    const parts = text.split(/[\n,\s]+/);
    
    // Clean each username
    return parts
      .map(part => {
        let clean = part.trim();
        // Extract from URLs
        const match = clean.match(/(?:x|twitter)\.com\/([a-zA-Z0-9_]+)/);
        if (match) clean = match[1];
        // Remove @ prefix
        clean = clean.replace(/^@/, '');
        return clean.toLowerCase();
      })
      .filter(u => u.length >= 1 && u.length <= 15 && /^[a-zA-Z0-9_]+$/.test(u));
  }, []);

  /**
   * Perform batch lookup
   */
  const handleBatchLookup = useCallback(async () => {
    const usernames = parseUsernames(input);
    
    if (usernames.length === 0) {
      return;
    }

    // Deduplicate
    const uniqueUsernames = [...new Set(usernames)];
    
    setIsLoading(true);
    setResults([]);
    setProgress({ current: 0, total: uniqueUsernames.length });

    const batchResults: BatchResult[] = [];

    // Process in batches of 5
    const batchSize = 5;
    for (let i = 0; i < uniqueUsernames.length; i += batchSize) {
      const batch = uniqueUsernames.slice(i, i + batchSize);
      
      // Process batch concurrently
      const batchPromises = batch.map(async (username) => {
        try {
          const data = await NetworkManager.lookupUser(username, mode, session);
          return { username, data, error: undefined };
        } catch (err) {
          return {
            username,
            data: null,
            error: err instanceof Error ? err.message : 'Unknown error',
          };
        }
      });

      const batchData = await Promise.all(batchPromises);
      batchResults.push(...batchData);
      
      setResults([...batchResults]);
      setProgress({ current: batchResults.length, total: uniqueUsernames.length });

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < uniqueUsernames.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setIsLoading(false);
  }, [input, mode, session, parseUsernames]);

  /**
   * Clear results
   */
  const handleClear = useCallback(() => {
    setInput('');
    setResults([]);
    setProgress({ current: 0, total: 0 });
  }, []);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <IconSymbol
          ios_icon_name="list.bullet"
          android_material_icon_name="format-list-bulleted"
          size={20}
          color={colors.primary}
        />
        <Text style={styles.title}>Batch Lookup</Text>
      </View>

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Enter usernames (one per line, comma-separated, or paste URLs)"
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          numberOfLines={4}
          editable={!isLoading}
        />
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.clearButton}
          onPress={handleClear}
          disabled={isLoading}
        >
          <Text style={styles.clearButtonText}>Clear</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.lookupButton, isLoading && styles.buttonDisabled]}
          onPress={handleBatchLookup}
          disabled={isLoading || !input.trim()}
        >
          <LinearGradient
            colors={[colors.primary, colors.primaryDark]}
            style={styles.lookupButtonGradient}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <>
                <IconSymbol
                  ios_icon_name="magnifyingglass"
                  android_material_icon_name="search"
                  size={18}
                  color={colors.text}
                />
                <Text style={styles.lookupButtonText}>Look Up All</Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Progress */}
      {isLoading && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${(progress.current / progress.total) * 100}%` },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {progress.current} / {progress.total}
          </Text>
        </View>
      )}

      {/* Results */}
      {results.length > 0 && (
        <ScrollView style={styles.results} showsVerticalScrollIndicator={false}>
          {results.map((result, index) => (
            <TouchableOpacity
              key={`${result.username}-${index}`}
              style={styles.resultItem}
              onPress={() => result.data && onResultSelect?.(result.username, result.data)}
              disabled={!result.data}
            >
              {/* Avatar */}
              <View style={[styles.avatar, !result.data && styles.avatarError]}>
                <Text style={styles.avatarText}>
                  {result.username.charAt(0).toUpperCase()}
                </Text>
              </View>

              {/* Info */}
              <View style={styles.resultInfo}>
                <Text style={styles.resultUsername}>@{result.username}</Text>
                {result.data ? (
                  <Text style={styles.resultData}>
                    {getFlag(result.data.location)} {result.data.location} • {getDeviceEmoji(result.data.device)}
                  </Text>
                ) : (
                  <Text style={styles.resultError}>
                    {result.error || 'Not found'}
                  </Text>
                )}
              </View>

              {/* Status */}
              <View style={[styles.statusBadge, result.data ? styles.statusSuccess : styles.statusFail]}>
                <IconSymbol
                  ios_icon_name={result.data ? 'checkmark' : 'xmark'}
                  android_material_icon_name={result.data ? 'check' : 'close'}
                  size={12}
                  color={result.data ? colors.secondary : colors.error}
                />
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    ...glassShadow,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  inputContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 12,
  },
  input: {
    padding: 12,
    fontSize: 14,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  clearButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  lookupButton: {
    flex: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  lookupButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  lookupButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: colors.textMuted,
    width: 50,
    textAlign: 'right',
  },
  results: {
    maxHeight: 300,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarError: {
    backgroundColor: colors.error + '30',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  resultInfo: {
    flex: 1,
  },
  resultUsername: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  resultData: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  resultError: {
    fontSize: 12,
    color: colors.error,
  },
  statusBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusSuccess: {
    backgroundColor: colors.secondary + '20',
  },
  statusFail: {
    backgroundColor: colors.error + '20',
  },
});

export default BatchLookup;