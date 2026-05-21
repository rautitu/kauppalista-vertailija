"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComparisonRunItem, ComparisonRunTotals, MatchStatus, StoreSource } from "@kauppalista/domain";
import {
  getStoreRehydrationQuery,
  mergeStoreOptions,
  normalizeSavedStoreOption,
  resolveSelectedStoreOption,
  type StoreOption,
} from "./store-selection";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api").replace(/\/$/, "");
const STORAGE_KEY = "kauppalista-vertailija:mvp-inputs";

type SavedInputs = {
  selectedKStore: StoreOption | null;
  selectedSStore: StoreOption | null;
  searchTerms: string[];
};

type ComparisonRunResponse = {
  id: string;
  totals: ComparisonRunTotals;
  matchedRows?: ComparisonRunItem[];
  items?: ComparisonRunItem[];
};

type ApiErrorResponse = {
  error?: string;
};

type ComparisonProgress = {
  percent: number;
  label: string;
  detail: string;
  status: "idle" | "running" | "complete" | "error";
};

const idleProgress: ComparisonProgress = {
  percent: 0,
  label: "Valmis",
  detail: "Vertailua ei ole käynnissä.",
  status: "idle",
};

function createProgressLogger(setProgress: (progress: ComparisonProgress) => void) {
  return (progress: ComparisonProgress) => {
    setProgress(progress);
    console.info("[comparison:progress]", {
      percent: progress.percent,
      label: progress.label,
      status: progress.status,
    });
  };
}

function createClientRequestId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `comparison-${Date.now()}`;
}

const emptyInputs: SavedInputs = {
  selectedKStore: null,
  selectedSStore: null,
  searchTerms: [""],
};

const statusLabels: Record<MatchStatus, string> = {
  matched: "Matched",
  ambiguous: "Ambiguous",
  not_found: "Not found",
  mismatch: "Mismatch",
};

const statusOrder: MatchStatus[] = ["matched", "ambiguous", "not_found", "mismatch"];

function formatStore(store: StoreOption) {
  return [store.storeName, store.city, store.address].filter(Boolean).join(" · ");
}

function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "–";
  }

  return new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" }).format(value);
}

function normalizeTerms(terms: string[]) {
  const trimmed = terms.map((term) => term.trim()).filter(Boolean);
  return trimmed.length > 0 ? trimmed : [""];
}

async function readApiError(response: Response) {
  const body = (await response.json().catch(() => null)) as ApiErrorResponse | null;
  return body?.error ?? `API request failed with status ${response.status}`;
}

function StoreSelect({
  label,
  source,
  selected,
  onSelect,
}: {
  label: string;
  source: StoreSource;
  selected: StoreOption | null;
  onSelect: (store: StoreOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchId = useRef(0);
  const rehydrateId = useRef(0);

  useEffect(() => {
    if (!selected || isOpen || query.trim() !== "") {
      return;
    }

    const resolvedFromStores = resolveSelectedStoreOption(selected, stores);
    if (resolvedFromStores) {
      if (resolvedFromStores.storeId !== selected.storeId) {
        onSelect(resolvedFromStores);
      }

      return;
    }

    const currentRehydrateId = ++rehydrateId.current;
    const params = new URLSearchParams({
      source,
      q: getStoreRehydrationQuery(selected),
      includeInactive: "true",
      limit: "20",
    });

    let isCancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/stores?${params.toString()}`);
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const body = (await response.json()) as { stores: StoreOption[] };
        if (isCancelled || currentRehydrateId !== rehydrateId.current) {
          return;
        }

        const resolved = resolveSelectedStoreOption(selected, body.stores) ?? selected;
        setStores((currentStores) => mergeStoreOptions(currentStores, resolved));
        if (resolved.storeId !== selected.storeId) {
          onSelect(resolved);
        }
      } catch {
        if (!isCancelled && currentRehydrateId === rehydrateId.current) {
          setStores((currentStores) => mergeStoreOptions(currentStores, selected));
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, onSelect, query, selected, source, stores]);

  useEffect(() => {
    if (!isOpen && selected && query === "") {
      return;
    }

    const currentSearchId = ++searchId.current;
    const timeout = window.setTimeout(async () => {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams({
        source,
        limit: "20",
      });
      const trimmedQuery = query.trim();
      if (trimmedQuery) {
        params.set("q", trimmedQuery);
      }

      try {
        const response = await fetch(`${API_BASE_URL}/stores?${params.toString()}`);
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const body = (await response.json()) as { stores: StoreOption[] };
        if (currentSearchId === searchId.current) {
          setStores(body.stores);
        }
      } catch (requestError) {
        if (currentSearchId === searchId.current) {
          setError(requestError instanceof Error ? requestError.message : "Kauppojen haku epäonnistui.");
          setStores([]);
        }
      } finally {
        if (currentSearchId === searchId.current) {
          setIsLoading(false);
        }
      }
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [isOpen, query, selected, source]);

  const selectedText = selected ? formatStore(selected) : "";

  return (
    <div className="field">
      <label className="field-label" htmlFor={`store-${source}`}>
        {label}
      </label>
      <div className="combo">
        <input
          id={`store-${source}`}
          value={isOpen ? query : selectedText}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setQuery("");
            setIsOpen(true);
          }}
          placeholder="Hae nimellä, kaupungilla tai osoitteella"
          autoComplete="off"
        />
        {selected ? (
          <button
            className="clear-button"
            type="button"
            aria-label={`Tyhjennä ${label}`}
            onClick={() => {
              onSelect(null);
              setQuery("");
              setIsOpen(true);
            }}
          >
            ×
          </button>
        ) : null}
        {isOpen ? (
          <div className="combo-panel">
            {isLoading ? <div className="combo-row muted">Haetaan kauppoja…</div> : null}
            {error ? <div className="combo-row error-text">{error}</div> : null}
            {!isLoading && !error && stores.length === 0 ? <div className="combo-row muted">Ei tuloksia.</div> : null}
            {stores.map((store) => (
              <button
                className="combo-option"
                type="button"
                key={store.id ?? store.storeId}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(store);
                  setQuery("");
                  setIsOpen(false);
                }}
              >
                <strong>{store.storeName}</strong>
                <span>{[store.city, store.address].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SearchTermsInput({ terms, onChange }: { terms: string[]; onChange: (terms: string[]) => void }) {
  const visibleTerms = useMemo(() => {
    const next = [...terms];
    if (next.length === 0 || next[next.length - 1].trim() !== "") {
      next.push("");
    }
    return next;
  }, [terms]);

  const updateTerm = useCallback(
    (index: number, value: string) => {
      const next = [...visibleTerms];
      next[index] = value;

      while (next.length > 1 && next[next.length - 1].trim() === "" && next[next.length - 2].trim() === "") {
        next.pop();
      }

      onChange(next);
    },
    [onChange, visibleTerms],
  );

  return (
    <div className="field">
      <label className="field-label">Hakusanat</label>
      <div className="term-list">
        {visibleTerms.map((term, index) => (
          <input
            // Index is stable enough here because rows are append-only except trailing empty cleanup.
            key={index}
            value={term}
            onChange={(event) => updateTerm(index, event.target.value)}
            placeholder={index === 0 ? "esim. Valio kevytmaito 1 l" : "Lisää hakusana"}
            aria-label={`Hakusana ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

function ProductCell({ label, match }: { label: string; match: ComparisonRunItem["kMatch"] }) {
  const candidate = match?.candidate;

  return (
    <div className="product-cell">
      <span className="source-label">{label}</span>
      {candidate ? (
        <>
          <strong>{candidate.name}</strong>
          <span>{[candidate.brand, candidate.size ? `${candidate.size} ${candidate.unit ?? ""}`.trim() : null].filter(Boolean).join(" · ")}</span>
          <span>{formatMoney(candidate.price)} {candidate.comparisonPrice ? `/ vert. ${formatMoney(candidate.comparisonPrice)}` : ""}</span>
          <span>Score {Math.round(match.score)} · Confidence {Math.round(match.confidence * 100)}%</span>
        </>
      ) : (
        <span className="muted">Ei osumaa</span>
      )}
    </div>
  );
}

function ResultsView({ run }: { run: ComparisonRunResponse }) {
  const rows = run.matchedRows ?? run.items ?? [];
  const counts = statusOrder.reduce(
    (acc, status) => ({ ...acc, [status]: rows.filter((row) => row.status === status).length }),
    {} as Record<MatchStatus, number>,
  );

  return (
    <section className="results">
      <div className="section-heading">
        <div>
          <h2>Vertailun tulos</h2>
        </div>
        <div className="status-summary">
          {statusOrder.map((status) => (
            <span className={`status-pill status-${status}`} key={status}>
              {statusLabels[status]} {counts[status]}
            </span>
          ))}
        </div>
      </div>

      <div className="totals">
        <div>
          <span>K-ruoka yhteensä</span>
          <strong>{formatMoney(run.totals.kTotal)}</strong>
        </div>
        <div>
          <span>S-kaupat yhteensä</span>
          <strong>{formatMoney(run.totals.sTotal)}</strong>
        </div>
        <div>
          <span>Erotus</span>
          <strong>{formatMoney(run.totals.difference)}</strong>
        </div>
      </div>

      <div className="result-list">
        {rows.map((row, index) => (
          <article className="result-row" key={row.canonicalItem.id}>
            <div className="result-header">
              <div>
                <span className="row-index">{index + 1}</span>
                <strong>{row.canonicalItem.name}</strong>
              </div>
              <span className={`status-pill status-${row.status}`}>{statusLabels[row.status]}</span>
            </div>
            <div className="product-grid">
              <ProductCell label="K" match={row.kMatch} />
              <ProductCell label="S" match={row.sMatch} />
            </div>
            {row.crossStoreValidation ? (
              <p className="reason">
                {row.crossStoreValidation.reason}
                {row.crossStoreValidation.details.length > 0 ? `: ${row.crossStoreValidation.details.join(", ")}` : ""}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function ComparisonProgressView({ progress }: { progress: ComparisonProgress }) {
  if (progress.status === "idle") {
    return null;
  }

  return (
    <section className={`progress-panel progress-${progress.status}`} aria-live="polite">
      <div className="progress-heading">
        <div>
          <strong>{progress.label}</strong>
          <span>{progress.detail}</span>
        </div>
        <span>{progress.percent}%</span>
      </div>
      <div className="progress-track" aria-label={`Vertailun eteneminen ${progress.percent}%`}>
        <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
      </div>
    </section>
  );
}

export default function HomePage() {
  const [selectedKStore, setSelectedKStore] = useState<StoreOption | null>(emptyInputs.selectedKStore);
  const [selectedSStore, setSelectedSStore] = useState<StoreOption | null>(emptyInputs.selectedSStore);
  const [searchTerms, setSearchTerms] = useState<string[]>(emptyInputs.searchTerms);
  const [result, setResult] = useState<ComparisonRunResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ComparisonProgress>(idleProgress);
  const [hasLoadedSavedInputs, setHasLoadedSavedInputs] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setHasLoadedSavedInputs(true);
      return;
    }

    try {
      const saved = JSON.parse(raw) as Partial<SavedInputs>;
      setSelectedKStore(normalizeSavedStoreOption(saved.selectedKStore, "k-ruoka"));
      setSelectedSStore(normalizeSavedStoreOption(saved.selectedSStore, "s-kaupat"));
      setSearchTerms(normalizeTerms(saved.searchTerms ?? [""]));
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHasLoadedSavedInputs(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedSavedInputs) {
      return;
    }

    const payload: SavedInputs = {
      selectedKStore,
      selectedSStore,
      searchTerms: normalizeTerms(searchTerms),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [hasLoadedSavedInputs, selectedKStore, selectedSStore, searchTerms]);

  const submittedTerms = searchTerms.map((term) => term.trim()).filter(Boolean);
  const canSubmit = Boolean(selectedKStore?.storeId && selectedSStore?.storeId && submittedTerms.length > 0 && !isSubmitting);

  async function submitComparison(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    const logProgress = createProgressLogger(setProgress);
    logProgress({
      percent: 5,
      label: "Tarkistetaan syötteet",
      detail: "Varmistetaan kauppavalinnat ja hakusanat.",
      status: "running",
    });

    if (!selectedKStore || !selectedSStore || submittedTerms.length === 0) {
      setError("Valitse molemmat kaupat ja lisää vähintään yksi hakusana.");
      logProgress({
        percent: 0,
        label: "Vertailu keskeytyi",
        detail: "Valitse molemmat kaupat ja lisää vähintään yksi hakusana.",
        status: "error",
      });
      return;
    }

    const clientRequestId = createClientRequestId();
    setIsSubmitting(true);
    try {
      logProgress({
        percent: 20,
        label: "Lähetetään vertailu",
        detail: "Lähetetään vertailu valituilla kaupoilla.",
        status: "running",
      });

      const response = await fetch(`${API_BASE_URL}/comparison-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId,
          selectedKStoreId: selectedKStore.storeId,
          selectedSStoreId: selectedSStore.storeId,
          searchTerms: submittedTerms,
        }),
      });

      logProgress({
        percent: 70,
        label: "Käsitellään tuloksia",
        detail: "Tuotehaut, matchaus ja tallennus ovat valmistumassa.",
        status: "running",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const body = (await response.json()) as { comparisonRun: ComparisonRunResponse };
      setResult(body.comparisonRun);
      logProgress({
        percent: 100,
        label: "Vertailu valmis",
        detail: "Tulokset ladattu käyttöliittymään.",
        status: "complete",
      });
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Vertailun suoritus epäonnistui.";
      setError(message);
      logProgress({
        percent: 100,
        label: "Vertailu epäonnistui",
        detail: message,
        status: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Kauppalista-vertailija</h1>
          <p>Valitse kaupat, syötä hakusanat ja aja vertailu.</p>
        </div>
      </header>

      <form className="comparison-form" onSubmit={submitComparison}>
        <div className="store-grid">
          <StoreSelect label="K-ruoka kauppa" source="k-ruoka" selected={selectedKStore} onSelect={setSelectedKStore} />
          <StoreSelect label="S-kaupat kauppa" source="s-kaupat" selected={selectedSStore} onSelect={setSelectedSStore} />
        </div>

        <SearchTermsInput terms={searchTerms} onChange={setSearchTerms} />

        {error ? <div className="alert">{error}</div> : null}

        <div className="actions">
          <button type="submit" disabled={!canSubmit}>
            {isSubmitting ? "Vertaillaan…" : "Suorita vertailu"}
          </button>
          <span>{submittedTerms.length} hakusanaa</span>
        </div>
      </form>

      <ComparisonProgressView progress={progress} />
      {result ? <ResultsView run={result} /> : null}
    </main>
  );
}
