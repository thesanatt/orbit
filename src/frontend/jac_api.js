/**
 * Jac Backend API Client for ORBIT
 *
 * Handles authentication, walker invocation, and graph data retrieval
 * from the jac start server on :8000.
 *
 * Falls back gracefully when the Jac backend is unavailable.
 */

// In dev mode, Vite proxies /walker/* to localhost:8000
// In production, use direct URL
const JAC_URL = window.location.port === '3000' ? '' : 'http://localhost:8000';

let _token = null;

/**
 * POST JSON to the Jac API. Returns parsed JSON or null on failure.
 */
async function jacPost(path, data = {}, requireAuth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (requireAuth && _token) {
        headers['Authorization'] = `Bearer ${_token}`;
    }
    try {
        const resp = await fetch(`${JAC_URL}${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data),
        });
        const json = await resp.json();
        return json;
    } catch (e) {
        console.warn(`Jac API ${path} failed:`, e.message);
        return null;
    }
}

/**
 * Register + login to get a JWT token. Idempotent — reuses existing token.
 */
export async function jacAuth() {
    if (_token) return _token;

    const username = `orbit_${Date.now() % 100000}`;
    const password = 'orbit2026';

    // Try register
    const reg = await jacPost('/user/register', { username, password }, false);
    if (reg?.ok && reg?.data?.token) {
        _token = reg.data.token;
        console.log('[Jac] Authenticated as', username);
        return _token;
    }

    // Try login with default user
    const login = await jacPost('/user/login', { username: 'orbit', password }, false);
    if (login?.ok && login?.data?.token) {
        _token = login.data.token;
        console.log('[Jac] Logged in as orbit');
        return _token;
    }

    console.warn('[Jac] Auth failed');
    return null;
}

/**
 * Check if the Jac backend is reachable.
 */
export async function jacHealthCheck() {
    try {
        const url = JAC_URL ? `${JAC_URL}/healthz` : '/healthz';
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
        return resp.ok;
    } catch {
        return false;
    }
}

/**
 * Seed the demo knowledge graph. Call once on startup.
 */
export async function jacSeedGraph() {
    const result = await jacPost('/walker/SeedGraph');
    if (result?.ok) {
        const r = result.data?.result || {};
        console.log(`[Jac] Seeded: ${r.node_count} nodes, ${r.edge_count} edges`);
        return r;
    }
    return null;
}

/**
 * Get the full graph data for visualization.
 * Tries the public get_graph endpoint first, falls back to authenticated.
 */
export async function jacGetGraph() {
    // Per-user graph: must be called authenticated so walker reaches the user's
    // root (not the server's global root). Reports are at data.reports[0].
    const result = await jacPost('/walker/get_graph', {});
    if (!result?.ok) return null;
    const reports = result.data?.reports || [];
    if (reports.length > 0 && reports[0].nodes) return reports[0];
    return null;
}

/**
 * Run the Explorer walker. Returns traversal path + discoveries.
 */
export async function jacExplore(maxHops = 5, minConfidence = 0.3) {
    const result = await jacPost('/walker/Explorer', {
        max_hops: maxHops,
        min_confidence: minConfidence,
    });
    if (result?.ok) {
        return result.data?.result || {};
    }
    return null;
}

/**
 * Run the Pathfinder walker to answer a question.
 */
export async function jacAskQuestion(question) {
    const result = await jacPost('/walker/Pathfinder', { question });
    if (result?.ok) {
        return result.data?.result || {};
    }
    return null;
}

/**
 * Run the Ingestor walker to add new knowledge.
 */
export async function jacIngest(text, sourceType = 'note', url = '') {
    const result = await jacPost('/walker/Ingestor', {
        text,
        source_type: sourceType,
        url,
        source_node: null,
    });
    if (result?.ok) {
        return result.data?.result || {};
    }
    return null;
}

/**
 * Run the Cartographer walker to map knowledge territory.
 */
export async function jacMapTerritory() {
    const result = await jacPost('/walker/Cartographer');
    if (result?.ok) {
        return result.data?.result || {};
    }
    return null;
}

/**
 * Run the Consolidator walker for decay detection.
 */
export async function jacConsolidate(decayThreshold = 0.3) {
    const result = await jacPost('/walker/Consolidator', {
        decay_threshold: decayThreshold,
        min_cluster_size: 999, // Skip cluster summarization for speed
    });
    if (result?.ok) {
        return result.data?.result || {};
    }
    return null;
}

export const JAC_API_URL = JAC_URL;
