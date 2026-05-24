/**
 * Deterministic keyword clustering for skill/gem grouping.
 *
 * Used by `cue discover suggest-profiles` and `cue profile suggest` to find
 * clusters of skills that share vocabulary and could justify a new profile.
 *
 * Algorithm: tokenize → drop stopwords → unigrams + bigrams → score by
 * frequency × inverse-doc-frequency → group items by their top-scoring term.
 *
 * Why not k-means / LDA / embeddings: this runs in the discover pipeline
 * which already spends API budget on `cmdAnalyze`. We want a fast, offline,
 * explainable signal that the user can sanity-check by reading the cluster's
 * top term. Sophistication moves to the optional Claude naming step.
 */

export interface ClusterItem {
  id: string;
  text: string;
}

export interface Cluster {
  /** The dominant n-gram that defined this cluster (e.g. "session memory"). */
  term: string;
  /** Items grouped under this term, sorted by descending term score. */
  items: ClusterItem[];
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "of", "for", "to", "in", "on",
  "at", "by", "with", "as", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "from", "into", "via", "over",
  "you", "your", "we", "our", "us", "they", "them", "their", "i", "me", "my",
  "have", "has", "had", "do", "does", "did", "will", "would", "can", "could",
  "should", "may", "might", "must", "not", "no", "yes",
  // Domain noise — these are everywhere in skill repos and don't differentiate.
  "claude", "code", "claude-code", "skill", "skills", "tool", "tools", "ai", "agent", "agents",
  "mcp", "server", "use", "uses", "using", "used", "new", "across",
  // English connectives that survive the basic stopword filter but carry no topic signal.
  "path", "paths", "system", "systems", "platform", "service", "services", "support",
  "build", "make", "get", "set", "run", "show", "list", "find", "based", "via",
]);

const TOKEN_RE = /[a-z][a-z0-9-]*/g;

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(lower)) !== null) {
    const t = m[0]!;
    if (t.length < 3 || t.length > 30) continue;
    if (STOPWORDS.has(t)) continue;
    if (/^\d/.test(t)) continue;
    tokens.push(t);
  }
  return tokens;
}

function ngrams(tokens: string[]): string[] {
  const out: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

/**
 * Cluster items by top scoring n-gram.
 *
 * Returns clusters with ≥ minSize items, sorted by size descending. Items
 * that don't fit any qualifying cluster are omitted (caller can detect them
 * by id and route to a fallback bucket).
 */
export function clusterByKeywords(
  items: ClusterItem[],
  opts: { minSize?: number; maxClusters?: number } = {},
): Cluster[] {
  const minSize = opts.minSize ?? 3;
  const maxClusters = opts.maxClusters ?? 10;
  if (items.length === 0) return [];

  // Doc-frequency: how many items contain each term at least once.
  const docFreq = new Map<string, number>();
  const itemTerms = new Map<string, Set<string>>();
  for (const item of items) {
    const terms = new Set(ngrams(tokenize(item.text)));
    itemTerms.set(item.id, terms);
    for (const t of terms) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }

  const N = items.length;
  // A term qualifies if (a) it appears in ≥ minSize items (enough for a cluster),
  // (b) it doesn't appear in *every* item (df=N is the whole corpus, not a cluster),
  // and (c) it's specific enough — for small corpora that's any term, but for
  // larger ones we reject terms appearing in nearly everything (e.g. "claude"
  // in 40/50 items would be bloat, not signal). The "≥75% of corpus" upper
  // bound only kicks in when the corpus is large enough to make it meaningful.
  const genericCap = Math.max(minSize + 1, Math.floor(N * 0.75));
  const candidateTerms = [...docFreq.entries()]
    .filter(([, df]) => df >= minSize && df < N && df <= genericCap)
    .map(([term, df]) => ({ term, df, idf: Math.log(N / df) }))
    .sort((a, b) => b.df - a.df);

  if (candidateTerms.length === 0) return [];

  // Greedy assignment: process terms by document frequency (broad first), so
  // dominant clusters absorb items before narrow terms steal them.
  const assigned = new Set<string>();
  const clusters: Cluster[] = [];

  for (const cand of candidateTerms) {
    if (clusters.length >= maxClusters) break;
    const members: ClusterItem[] = [];
    for (const item of items) {
      if (assigned.has(item.id)) continue;
      if (itemTerms.get(item.id)!.has(cand.term)) members.push(item);
    }
    if (members.length >= minSize) {
      for (const m of members) assigned.add(m.id);
      clusters.push({ term: cand.term, items: members });
    }
  }

  return clusters.sort((a, b) => b.items.length - a.items.length);
}

/** Items not assigned to any cluster. Convenience for the caller. */
export function unclustered(items: ClusterItem[], clusters: Cluster[]): ClusterItem[] {
  const assigned = new Set(clusters.flatMap(c => c.items.map(i => i.id)));
  return items.filter(i => !assigned.has(i.id));
}

// ---------------------------------------------------------------------------
// Embedding-based clustering (opt-in, requires VOYAGE_API_KEY)
// ---------------------------------------------------------------------------

/**
 * Cluster by semantic similarity instead of literal vocabulary. Sends one
 * batch request to Voyage's embeddings API, then runs a simple greedy
 * cosine-similarity grouping. Falls back to keyword clustering if the API
 * key is missing or the request fails.
 *
 * Why Voyage: Anthropic's recommended embeddings partner, voyage-3 is cheap
 * (~$0.06/1M tokens) and high-quality on short technical descriptions.
 * Swappable via `provider.embed` if you want a different backend.
 */
export interface EmbedProvider {
  /** Return one embedding vector per input text, in order. */
  embed(texts: string[]): Promise<number[][]>;
}

export const voyageProvider: EmbedProvider = {
  async embed(texts) {
    const key = process.env.VOYAGE_API_KEY;
    if (!key) throw new Error("VOYAGE_API_KEY not set");
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: texts, model: "voyage-3-lite", input_type: "document" }),
    });
    if (!res.ok) throw new Error(`Voyage API ${res.status}: ${await res.text().catch(() => "")}`);
    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    if (!Array.isArray(data.data) || data.data.length !== texts.length) {
      throw new Error("Voyage response shape unexpected");
    }
    return data.data.map(d => d.embedding);
  },
};

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Greedy clustering: pick the densest seed (item with most neighbors above
 * threshold), absorb its neighborhood, repeat on remainder.
 *
 * minSize and maxClusters semantics match `clusterByKeywords`. `threshold`
 * is the minimum cosine similarity for two items to be neighbors — 0.55 is
 * a reasonable default for voyage-3-lite on short skill descriptions.
 *
 * Cluster terms: since there's no obvious keyword to anchor a semantic
 * cluster, we derive the term by running the keyword tokenizer over just
 * the cluster's text and picking its most frequent non-stopword. This keeps
 * the output shape compatible with `clusterByKeywords` callers.
 */
export async function clusterByEmbeddings(
  items: ClusterItem[],
  opts: { minSize?: number; maxClusters?: number; threshold?: number; provider?: EmbedProvider } = {},
): Promise<Cluster[]> {
  const minSize = opts.minSize ?? 3;
  const maxClusters = opts.maxClusters ?? 10;
  const threshold = opts.threshold ?? 0.55;
  const provider = opts.provider ?? voyageProvider;
  if (items.length < minSize) return [];

  const vectors = await provider.embed(items.map(i => i.text));
  if (vectors.length !== items.length) return [];

  const remaining = new Set(items.map((_, i) => i));
  const clusters: Cluster[] = [];

  while (remaining.size >= minSize && clusters.length < maxClusters) {
    // Build a neighbor list for each remaining item and pick the densest seed.
    let bestSeed = -1;
    let bestNeighbors: number[] = [];
    for (const i of remaining) {
      const neighbors: number[] = [i];
      for (const j of remaining) {
        if (j === i) continue;
        if (cosine(vectors[i]!, vectors[j]!) >= threshold) neighbors.push(j);
      }
      if (neighbors.length > bestNeighbors.length) {
        bestSeed = i;
        bestNeighbors = neighbors;
      }
    }
    if (bestSeed < 0 || bestNeighbors.length < minSize) break;

    const memberItems = bestNeighbors.map(idx => items[idx]!);
    clusters.push({
      term: deriveClusterTerm(memberItems),
      items: memberItems,
    });
    for (const idx of bestNeighbors) remaining.delete(idx);
  }

  return clusters.sort((a, b) => b.items.length - a.items.length);
}

/**
 * For embedding-based clusters there's no anchor n-gram — we derive a
 * human-readable label by tokenizing the member texts and picking the most
 * frequent non-stopword unigram. Falls back to "cluster-N" if everything is
 * stopwords.
 */
function deriveClusterTerm(items: ClusterItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tok of tokenize(item.text)) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? `cluster-${items.length}`;
}

// ---------------------------------------------------------------------------
// Profile-overlap helpers (used by `cue profile suggest`)
// ---------------------------------------------------------------------------

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersect = 0;
  for (const x of a) if (b.has(x)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/**
 * Skills that appear in many profiles are candidates for promotion to `core`.
 * Returns skill IDs ordered by descending frequency, with the list of
 * profiles that include them.
 */
export function skillFrequency(
  profileSkills: Record<string, string[]>,
  opts: { minProfiles?: number } = {},
): Array<{ skill: string; profiles: string[] }> {
  const minProfiles = opts.minProfiles ?? 3;
  const freq = new Map<string, string[]>();
  for (const [profile, skills] of Object.entries(profileSkills)) {
    if (profile === "core" || profile === "full") continue;
    for (const s of skills) {
      const list = freq.get(s) ?? [];
      list.push(profile);
      freq.set(s, list);
    }
  }
  return [...freq.entries()]
    .filter(([, profiles]) => profiles.length >= minProfiles)
    .map(([skill, profiles]) => ({ skill, profiles }))
    .sort((a, b) => b.profiles.length - a.profiles.length);
}
