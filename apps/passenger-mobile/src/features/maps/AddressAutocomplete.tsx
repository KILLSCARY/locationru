import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '@/api/client';
import { searchAddressSuggestions } from './api';
import type { AddressSuggestion, GeoPoint } from './types';
import { useDebouncedValue } from './useDebouncedValue';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 350;

type AddressAutocompleteProps = {
  placeholder: string;
  resolvedAddress: string | null;
  bias?: GeoPoint;
  onSelect: (suggestion: AddressSuggestion) => void;
};

/**
 * Debounced address search: typing under 350ms apart never reaches the
 * network, and an in-flight request is aborted the moment newer input makes
 * it stale, so only the latest query's response is ever used.
 */
export function AddressAutocomplete({
  placeholder,
  resolvedAddress,
  bias,
  onSelect,
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortControllerRef.current?.abort();

    if (debouncedQuery.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsSearching(true);

    searchAddressSuggestions({
      query: debouncedQuery,
      bias,
      limit: 5,
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        setSuggestions(response.suggestions);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 400) {
          setSuggestions([]);
          return;
        }
        // Network/provider errors: leave prior suggestions, just stop spinning.
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsSearching(false);
      });

    return () => controller.abort();
  }, [debouncedQuery]);

  return (
    <View style={styles.container}>
      <TextInput
        placeholder={placeholder}
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setSuggestions([]);
        }}
        style={styles.input}
      />
      {resolvedAddress && (
        <Text style={styles.resolved}>Выбрано: {resolvedAddress}</Text>
      )}
      {isSearching && <ActivityIndicator size="small" />}
      {suggestions.map((suggestion) => (
        <Pressable
          key={suggestion.id}
          style={styles.suggestion}
          onPress={() => {
            onSelect(suggestion);
            setQuery(suggestion.fullAddress);
            setSuggestions([]);
          }}
        >
          <Text style={styles.suggestionTitle}>{suggestion.title}</Text>
          {suggestion.subtitle ? (
            <Text style={styles.suggestionSubtitle}>{suggestion.subtitle}</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
  },
  resolved: { color: '#2a7a2a' },
  suggestion: {
    padding: 10,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
  },
  suggestionTitle: { fontWeight: '600' },
  suggestionSubtitle: { color: '#666' },
});
