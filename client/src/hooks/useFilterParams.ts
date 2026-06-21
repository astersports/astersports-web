/**
 * useFilterParams — Sync filter state with URL search params
 * Supports: search, status, type, sort, page, favorites
 * Allows sharing links to specific filtered views.
 */
import { useState, useEffect, useCallback, useRef } from "react";

interface FilterState {
  search: string;
  status: string;
  type: string;
  sortBy: string;
  sortDir: string;
  page: number;
  favorites: boolean;
}

const DEFAULTS: FilterState = {
  search: "",
  status: "all",
  type: "all",
  sortBy: "date",
  sortDir: "desc",
  page: 0,
  favorites: false,
};

function parseParams(): FilterState {
  const params = new URLSearchParams(window.location.search);
  return {
    search: params.get("q") || DEFAULTS.search,
    status: params.get("status") || DEFAULTS.status,
    type: params.get("type") || DEFAULTS.type,
    sortBy: params.get("sort") || DEFAULTS.sortBy,
    sortDir: params.get("dir") || DEFAULTS.sortDir,
    page: parseInt(params.get("page") || "0", 10) || DEFAULTS.page,
    favorites: params.get("fav") === "1",
  };
}

function buildSearch(state: FilterState): string {
  const params = new URLSearchParams();
  if (state.search) params.set("q", state.search);
  if (state.status !== "all") params.set("status", state.status);
  if (state.type !== "all") params.set("type", state.type);
  if (state.sortBy !== "date") params.set("sort", state.sortBy);
  if (state.sortDir !== "desc") params.set("dir", state.sortDir);
  if (state.page > 0) params.set("page", String(state.page));
  if (state.favorites) params.set("fav", "1");
  const str = params.toString();
  return str ? `?${str}` : "";
}

export function useFilterParams() {
  const [state, setState] = useState<FilterState>(parseParams);
  const isInitialMount = useRef(true);

  // Update URL when state changes (skip initial mount to avoid replacing on load)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const newSearch = buildSearch(state);
    const currentSearch = window.location.search || "";
    if (newSearch !== currentSearch) {
      const url = window.location.pathname + newSearch;
      window.history.replaceState(null, "", url);
    }
  }, [state]);

  // Listen for popstate (back/forward navigation)
  useEffect(() => {
    const handlePopState = () => {
      setState(parseParams());
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const setSearch = useCallback((search: string) => {
    setState((s) => ({ ...s, search, page: 0 }));
  }, []);

  const setStatus = useCallback((status: string) => {
    setState((s) => ({ ...s, status, page: 0 }));
  }, []);

  const setType = useCallback((type: string) => {
    setState((s) => ({ ...s, type, page: 0 }));
  }, []);

  const setSortBy = useCallback((sortBy: string) => {
    setState((s) => ({ ...s, sortBy }));
  }, []);

  const setSortDir = useCallback((sortDir: string) => {
    setState((s) => ({ ...s, sortDir }));
  }, []);

  const setPage = useCallback((page: number | ((prev: number) => number)) => {
    setState((s) => ({
      ...s,
      page: typeof page === "function" ? page(s.page) : page,
    }));
  }, []);

  const setFavorites = useCallback((favorites: boolean) => {
    setState((s) => ({ ...s, favorites, page: 0 }));
  }, []);

  const clearAll = useCallback(() => {
    setState({ ...DEFAULTS });
  }, []);

  const hasActiveFilters =
    state.search !== "" ||
    state.status !== "all" ||
    state.type !== "all" ||
    state.favorites;

  return {
    ...state,
    hasActiveFilters,
    setSearch,
    setStatus,
    setType,
    setSortBy,
    setSortDir,
    setPage,
    setFavorites,
    clearAll,
  };
}
