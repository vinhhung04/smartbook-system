import { useCallback, useEffect, useRef, useState } from 'react';

import * as homeApi from '../api/customerHome';
import { ApiError } from '../api/client';
import { buildRecommendationShelf, type RecommendedBook } from '../lib/recommendationShelf';

type RecommendationState =
  | { status: 'loading' }
  | { status: 'ready'; personalized: boolean; items: RecommendedBook[] }
  | { status: 'unavailable' };

// Each recommendation call asks the LLM to word the reasons: keep one result per reader
// for a while instead of re-asking on every visit to the tab.
const RECOMMENDATION_TTL_MS = 10 * 60 * 1000;
const recommendationCache = new Map<string, { at: number; value: Extract<RecommendationState, { status: 'ready' }> }>();

export function useCustomerHome(userId: string | null) {
  const [home, setHome] = useState<homeApi.CatalogHome | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationState>({ status: 'loading' });
  const requestRef = useRef(0);

  const loadRecommendations = useCallback(
    async (requestId: number, force: boolean) => {
      const cacheKey = userId ?? 'anonymous';
      const cached = recommendationCache.get(cacheKey);
      if (!force && cached && Date.now() - cached.at < RECOMMENDATION_TTL_MS) {
        setRecommendations(cached.value);
        return;
      }
      setRecommendations({ status: 'loading' });
      try {
        const result = await homeApi.getRecommendations(8);
        const books = await homeApi.getCatalogBooksByIds(result.recommendations.map((r) => r.book_id));
        if (requestId !== requestRef.current) return;
        const value = { status: 'ready' as const, personalized: result.personalized, items: buildRecommendationShelf(result.recommendations, books) };
        recommendationCache.set(cacheKey, { at: Date.now(), value });
        setRecommendations(value);
      } catch {
        // AI down or rate-limited: the home still works from the catalog's own sections.
        if (requestId === requestRef.current) setRecommendations({ status: 'unavailable' });
      }
    },
    [userId],
  );

  const load = useCallback(
    async (force = false) => {
      const requestId = ++requestRef.current;
      setError(null);
      void loadRecommendations(requestId, force);
      try {
        const result = await homeApi.getCatalogHome();
        if (requestId === requestRef.current) setHome(result);
      } catch (err) {
        if (requestId === requestRef.current) setError(err instanceof ApiError ? err.message : 'Không tải được trang chủ');
      }
    },
    [loadRecommendations],
  );

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await load(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [load]);

  return { home, isLoading, isRefreshing, error, recommendations, refresh, retry: () => void load() };
}
