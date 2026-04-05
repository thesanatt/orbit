"""Graph algorithms: BFS, Louvain, PageRank, centrality, random walks."""

import time
import numpy as np
from typing import Dict, List, Tuple, Optional, Set
from collections import defaultdict, deque


class KnowledgeGraph:
    """In-memory graph for batch algorithm operations."""

    def __init__(self) -> None:
        self.nodes: Dict[str, dict] = {}
        self.edges: Dict[str, dict] = {}
        # node_id -> [(neighbor_id, edge_id)]
        self.adjacency: Dict[str, List[Tuple[str, str]]] = defaultdict(list)
        # node_id -> [(neighbor_id, edge_id)] for incoming edges
        self.reverse_adjacency: Dict[str, List[Tuple[str, str]]] = defaultdict(list)

    def add_node(self, node_id: str, attrs: dict) -> None:
        """Add a node with the given attributes. Overwrites if already exists."""
        self.nodes[node_id] = attrs
        # Ensure adjacency entries exist even for isolated nodes
        if node_id not in self.adjacency:
            self.adjacency[node_id] = []
        if node_id not in self.reverse_adjacency:
            self.reverse_adjacency[node_id] = []

    def add_edge(self, edge_id: str, source: str, target: str, attrs: dict) -> None:
        """Add an edge between source and target with given attributes."""
        edge_data = {**attrs, "source": source, "target": target}
        edge_data.setdefault("type", "relates_to")
        edge_data.setdefault("strength", 0.5)
        self.edges[edge_id] = edge_data

        # Symmetric adjacency for undirected traversal
        self.adjacency[source].append((target, edge_id))
        self.adjacency[target].append((source, edge_id))

        # Directed adjacency for algorithms that need direction
        self.reverse_adjacency[target].append((source, edge_id))
        self.reverse_adjacency[source].append((target, edge_id))

    def get_neighbors(self, node_id: str) -> List[Tuple[str, str]]:
        """Return list of (neighbor_id, edge_id) for the given node."""
        return self.adjacency.get(node_id, [])

    def get_edge(self, source: str, target: str) -> Optional[dict]:
        """Return the first edge between source and target, or None."""
        for neighbor_id, edge_id in self.adjacency.get(source, []):
            if neighbor_id == target:
                return self.edges[edge_id]
        return None

    def get_edges_between(self, source: str, target: str) -> List[dict]:
        """Return all edges between source and target."""
        result: List[dict] = []
        for neighbor_id, edge_id in self.adjacency.get(source, []):
            if neighbor_id == target:
                result.append(self.edges[edge_id])
        return result

    def node_count(self) -> int:
        """Return the number of nodes."""
        return len(self.nodes)

    def edge_count(self) -> int:
        """Return the number of edges."""
        return len(self.edges)

    def degree(self, node_id: str) -> int:
        """Return the degree (number of adjacent edges) for a node."""
        return len(self.adjacency.get(node_id, []))

    def weighted_degree(self, node_id: str) -> float:
        """Return the sum of edge strengths for a node."""
        total = 0.0
        for _, edge_id in self.adjacency.get(node_id, []):
            total += self.edges[edge_id].get("strength", 0.5)
        return total


# Pathfinding

def bfs_shortest_path(
    graph: KnowledgeGraph, start: str, end: str
) -> Optional[List[str]]:
    """BFS shortest path between two nodes."""
    if start not in graph.nodes or end not in graph.nodes:
        return None
    if start == end:
        return [start]

    visited: Set[str] = {start}
    queue: deque[Tuple[str, List[str]]] = deque([(start, [start])])

    while queue:
        current, path = queue.popleft()
        for neighbor, _ in graph.get_neighbors(current):
            if neighbor == end:
                return path + [neighbor]
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append((neighbor, path + [neighbor]))

    return None


def all_simple_paths(
    graph: KnowledgeGraph,
    start: str,
    end: str,
    max_depth: int = 8,
    min_edge_strength: float = 0.05,
) -> List[List[str]]:
    """Find all simple (loop-free) paths between *start* and *end* up to"""
    if start not in graph.nodes or end not in graph.nodes:
        return []
    if start == end:
        return [[start]]

    results: List[List[str]] = []

    # Stack entries: (current_node, current_path, visited_set)
    stack: List[Tuple[str, List[str], Set[str]]] = [
        (start, [start], {start})
    ]

    while stack:
        current, path, visited = stack.pop()

        if len(path) - 1 >= max_depth:
            continue

        for neighbor, edge_id in graph.get_neighbors(current):
            edge = graph.edges[edge_id]
            strength = edge.get("strength", 0.5)

            # Prune very weak edges
            if strength < min_edge_strength:
                continue

            if neighbor == end:
                results.append(path + [neighbor])
            elif neighbor not in visited:
                new_visited = visited | {neighbor}
                stack.append((neighbor, path + [neighbor], new_visited))

    return results


def weighted_path_score(graph: KnowledgeGraph, path: List[str]) -> float:
    """Score a path by the product of edge strengths along it."""
    if len(path) < 2:
        return 0.0

    score = 1.0
    for i in range(len(path) - 1):
        edge = graph.get_edge(path[i], path[i + 1])
        if edge is None:
            return 0.0
        score *= edge.get("strength", 0.5)

    return score


# Random Walks

def weighted_random_walk(
    graph: KnowledgeGraph,
    start: str,
    num_hops: int = 6,
    edge_bias: str = "weak",
) -> List[str]:
    """Perform a weighted random walk from *start* for *num_hops* steps."""
    if start not in graph.nodes:
        return [start]

    path: List[str] = [start]
    current = start

    for _ in range(num_hops):
        neighbors = graph.get_neighbors(current)
        if not neighbors:
            break

        neighbor_ids = [n for n, _ in neighbors]
        edge_ids = [eid for _, eid in neighbors]
        strengths = np.array(
            [graph.edges[eid].get("strength", 0.5) for eid in edge_ids],
            dtype=np.float64,
        )

        # Clamp strengths to a small positive floor to avoid division issues
        strengths = np.clip(strengths, 1e-6, None)

        if edge_bias == "weak":
            weights = 1.0 / strengths
        else:
            weights = strengths

        # Normalize to probability distribution
        total = weights.sum()
        if total == 0:
            break
        probs = weights / total

        idx = np.random.choice(len(neighbor_ids), p=probs)
        current = neighbor_ids[idx]
        path.append(current)

    return path


def random_walk_with_restart(
    graph: KnowledgeGraph,
    start: str,
    restart_prob: float = 0.15,
    num_steps: int = 1000,
) -> Dict[str, float]:
    """Personalized PageRank via Monte Carlo random walk with restart."""
    if start not in graph.nodes:
        return {start: 1.0}

    visit_counts: Dict[str, int] = defaultdict(int)
    current = start
    visit_counts[current] += 1

    for _ in range(num_steps):
        if np.random.random() < restart_prob:
            current = start
        else:
            neighbors = graph.get_neighbors(current)
            if not neighbors:
                current = start
            else:
                neighbor_ids = [n for n, _ in neighbors]
                edge_ids = [eid for _, eid in neighbors]
                strengths = np.array(
                    [graph.edges[eid].get("strength", 0.5) for eid in edge_ids],
                    dtype=np.float64,
                )
                strengths = np.clip(strengths, 1e-6, None)
                probs = strengths / strengths.sum()
                idx = np.random.choice(len(neighbor_ids), p=probs)
                current = neighbor_ids[idx]

        visit_counts[current] += 1

    # Normalize
    total_visits = sum(visit_counts.values())
    return {nid: count / total_visits for nid, count in visit_counts.items()}


# Community Detection

def modularity(graph: KnowledgeGraph, communities: List[Set[str]]) -> float:
    """Compute the Newman-Girvan modularity Q for a given partition."""
    if not graph.edges:
        return 0.0

    # Total edge weight (each edge counted once in graph.edges)
    m = sum(e.get("strength", 0.5) for e in graph.edges.values())
    if m == 0:
        return 0.0

    two_m = 2.0 * m

    # Build community membership lookup
    community_of: Dict[str, int] = {}
    for idx, comm in enumerate(communities):
        for node in comm:
            community_of[node] = idx

    q = 0.0
    for edge in graph.edges.values():
        src, tgt = edge["source"], edge["target"]
        w = edge.get("strength", 0.5)
        if community_of.get(src) == community_of.get(tgt):
            k_i = graph.weighted_degree(src)
            k_j = graph.weighted_degree(tgt)
            # Each undirected edge contributes twice (i->j and j->i)
            q += 2.0 * (w - k_i * k_j / two_m)

    return q / two_m


def louvain_communities(graph: KnowledgeGraph) -> List[Set[str]]:
    """Louvain algorithm for community detection."""
    if not graph.nodes:
        return []

    node_ids = list(graph.nodes.keys())
    if len(node_ids) <= 1:
        return [set(node_ids)]

    # Total edge weight
    m = sum(e.get("strength", 0.5) for e in graph.edges.values())
    if m == 0:
        # No edges: every node is its own community
        return [{nid} for nid in node_ids]

    two_m = 2.0 * m

    # Initialize: each node in its own community
    node_to_comm: Dict[str, int] = {nid: i for i, nid in enumerate(node_ids)}
    next_comm_id = len(node_ids)

    # Precompute weighted degrees
    k: Dict[str, float] = {nid: graph.weighted_degree(nid) for nid in node_ids}

    # Phase 1: local moves
    def _phase1() -> bool:
        """Return True if any node was moved."""
        improved = True
        any_moved = False

        while improved:
            improved = False
            # Shuffle for stochasticity
            order = list(node_ids)
            np.random.shuffle(order)

            for node in order:
                current_comm = node_to_comm[node]

                # Compute weights to neighboring communities
                neighbor_comm_weights: Dict[int, float] = defaultdict(float)
                for neighbor, edge_id in graph.get_neighbors(node):
                    w = graph.edges[edge_id].get("strength", 0.5)
                    nc = node_to_comm[neighbor]
                    neighbor_comm_weights[nc] += w

                # Sigma_tot for each candidate community
                comm_sigma_tot: Dict[int, float] = defaultdict(float)
                for nid in node_ids:
                    comm_sigma_tot[node_to_comm[nid]] += k[nid]

                # Remove node from its current community for calculation
                k_i = k[node]
                k_i_in_current = neighbor_comm_weights.get(current_comm, 0.0)
                sigma_tot_current = comm_sigma_tot[current_comm] - k_i

                # Modularity loss from removing node from current community
                remove_delta = (
                    -k_i_in_current / m
                    + sigma_tot_current * k_i / (two_m * m)
                )

                best_comm = current_comm
                best_gain = 0.0

                # Check each neighboring community
                for candidate_comm, k_i_in_cand in neighbor_comm_weights.items():
                    if candidate_comm == current_comm:
                        continue

                    sigma_tot_cand = comm_sigma_tot[candidate_comm]

                    # Modularity gain from adding node to candidate
                    add_delta = (
                        k_i_in_cand / m
                        - sigma_tot_cand * k_i / (two_m * m)
                    )

                    gain = add_delta + remove_delta

                    if gain > best_gain:
                        best_gain = gain
                        best_comm = candidate_comm

                if best_comm != current_comm:
                    node_to_comm[node] = best_comm
                    improved = True
                    any_moved = True

        return any_moved

    _phase1()

    # Collect communities
    comm_members: Dict[int, Set[str]] = defaultdict(set)
    for nid, cid in node_to_comm.items():
        comm_members[cid].add(nid)

    return [members for members in comm_members.values() if members]


# Centrality

def betweenness_centrality(graph: KnowledgeGraph) -> Dict[str, float]:
    """Brandes' algorithm for betweenness centrality (O(VE))."""
    node_ids = list(graph.nodes.keys())
    n = len(node_ids)
    cb: Dict[str, float] = {nid: 0.0 for nid in node_ids}

    if n < 2:
        return cb

    for s in node_ids:
        # BFS from s
        stack: List[str] = []
        pred: Dict[str, List[str]] = {nid: [] for nid in node_ids}
        sigma: Dict[str, int] = {nid: 0 for nid in node_ids}
        sigma[s] = 1
        dist: Dict[str, int] = {nid: -1 for nid in node_ids}
        dist[s] = 0

        queue: deque[str] = deque([s])
        while queue:
            v = queue.popleft()
            stack.append(v)
            for w, _ in graph.get_neighbors(v):
                # First visit
                if dist[w] < 0:
                    dist[w] = dist[v] + 1
                    queue.append(w)
                # Shortest path via v?
                if dist[w] == dist[v] + 1:
                    sigma[w] += sigma[v]
                    pred[w].append(v)

        # Back-propagation of dependencies
        delta: Dict[str, float] = {nid: 0.0 for nid in node_ids}
        while stack:
            w = stack.pop()
            for v in pred[w]:
                frac = sigma[v] / sigma[w]
                delta[v] += frac * (1.0 + delta[w])
            if w != s:
                cb[w] += delta[w]

    # Normalize for undirected graph: divide by 2 (each pair counted twice)
    norm = (n - 1) * (n - 2)
    if norm > 0:
        for nid in cb:
            cb[nid] /= norm  # already halved because undirected BFS
    return cb


def pagerank(
    graph: KnowledgeGraph,
    damping: float = 0.85,
    iterations: int = 100,
    epsilon: float = 1e-8,
) -> Dict[str, float]:
    """Weighted PageRank for node importance scoring."""
    node_ids = list(graph.nodes.keys())
    n = len(node_ids)

    if n == 0:
        return {}
    if n == 1:
        return {node_ids[0]: 1.0}

    idx_of: Dict[str, int] = {nid: i for i, nid in enumerate(node_ids)}

    # Initialize uniform
    rank = np.ones(n, dtype=np.float64) / n
    base = (1.0 - damping) / n

    for _ in range(iterations):
        new_rank = np.full(n, base, dtype=np.float64)

        for i, nid in enumerate(node_ids):
            neighbors = graph.get_neighbors(nid)
            if not neighbors:
                # Dangling node: distribute evenly
                new_rank += damping * rank[i] / n
                continue

            # Weighted out-distribution
            total_w = sum(
                graph.edges[eid].get("strength", 0.5) for _, eid in neighbors
            )
            if total_w == 0:
                new_rank += damping * rank[i] / n
                continue

            for neighbor, eid in neighbors:
                w = graph.edges[eid].get("strength", 0.5)
                j = idx_of.get(neighbor)
                if j is not None:
                    new_rank[j] += damping * rank[i] * w / total_w

        # Check convergence
        diff = np.abs(new_rank - rank).max()
        rank = new_rank
        if diff < epsilon:
            break

    # Normalize to sum to 1
    total = rank.sum()
    if total > 0:
        rank /= total

    return {nid: float(rank[i]) for i, nid in enumerate(node_ids)}


# Knowledge-Specific Operations

def find_knowledge_gaps(
    graph: KnowledgeGraph, communities: List[Set[str]]
) -> List[dict]:
    """Identify structural weaknesses in the knowledge graph."""
    gaps: List[dict] = []

    if not communities:
        return gaps

    # Build community membership
    comm_of: Dict[str, int] = {}
    for idx, comm in enumerate(communities):
        for nid in comm:
            comm_of[nid] = idx

    num_comms = len(communities)

    # Find inter-community edges for each community pair
    inter_edges: Dict[Tuple[int, int], int] = defaultdict(int)
    for edge in graph.edges.values():
        c_s = comm_of.get(edge["source"])
        c_t = comm_of.get(edge["target"])
        if c_s is not None and c_t is not None and c_s != c_t:
            pair = (min(c_s, c_t), max(c_s, c_t))
            inter_edges[pair] += 1

    # Detect islands (communities with no external edges)
    comms_with_external: Set[int] = set()
    for (a, b) in inter_edges:
        comms_with_external.add(a)
        comms_with_external.add(b)

    for idx, comm in enumerate(communities):
        if idx not in comms_with_external and len(comm) > 0:
            gaps.append({
                "type": "island",
                "nodes_involved": list(comm),
                "suggestion": (
                    f"Community of {len(comm)} concepts "
                    f"({', '.join(list(comm)[:3])}...) is completely isolated. "
                    "Try connecting it to related topics."
                ),
            })

    # Detect sparse clusters (density < threshold)
    for idx, comm in enumerate(communities):
        if len(comm) < 2:
            continue
        internal_edges = 0
        for nid in comm:
            for neighbor, _ in graph.get_neighbors(nid):
                if neighbor in comm:
                    internal_edges += 1
        # Each edge counted twice in undirected adjacency
        internal_edges //= 2
        max_edges = len(comm) * (len(comm) - 1) // 2
        density = internal_edges / max_edges if max_edges > 0 else 0.0

        if density < 0.15 and len(comm) >= 3:
            gaps.append({
                "type": "sparse_cluster",
                "nodes_involved": list(comm),
                "suggestion": (
                    f"Cluster ({', '.join(list(comm)[:3])}...) has low density "
                    f"({density:.2f}). These concepts may need more connections."
                ),
            })

    # Detect missing bridges between large communities
    for i in range(num_comms):
        for j in range(i + 1, num_comms):
            if len(communities[i]) >= 2 and len(communities[j]) >= 2:
                pair = (i, j)
                if inter_edges.get(pair, 0) == 0:
                    gaps.append({
                        "type": "missing_bridge",
                        "nodes_involved": (
                            list(communities[i])[:2] + list(communities[j])[:2]
                        ),
                        "suggestion": (
                            "No connections between these two knowledge areas. "
                            "Look for cross-domain insights."
                        ),
                    })

    return gaps


def find_bridge_concepts(
    graph: KnowledgeGraph, communities: List[Set[str]]
) -> List[str]:
    """Find concepts that have edges reaching into multiple communities."""
    if not communities:
        return []

    comm_of: Dict[str, int] = {}
    for idx, comm in enumerate(communities):
        for nid in comm:
            comm_of[nid] = idx

    # For each node, count how many distinct communities its neighbors belong to
    node_comm_reach: Dict[str, Set[int]] = defaultdict(set)

    for nid in graph.nodes:
        own_comm = comm_of.get(nid)
        for neighbor, _ in graph.get_neighbors(nid):
            nc = comm_of.get(neighbor)
            if nc is not None and nc != own_comm:
                node_comm_reach[nid].add(nc)

    # Nodes that touch at least 2 communities (including their own)
    bridges = [
        nid for nid, comms in node_comm_reach.items() if len(comms) >= 1
    ]

    # Sort by number of foreign communities touched, descending
    bridges.sort(key=lambda nid: len(node_comm_reach[nid]), reverse=True)

    return bridges


def find_orphan_nodes(graph: KnowledgeGraph, min_edges: int = 2) -> List[str]:
    """Find nodes with fewer than *min_edges* connections."""
    orphans: List[str] = []
    for nid in graph.nodes:
        if graph.degree(nid) < min_edges:
            orphans.append(nid)
    return orphans


def compute_node_importance(
    graph: KnowledgeGraph,
    alpha: float = 0.4,
    beta: float = 0.3,
    gamma: float = 0.2,
    delta: float = 0.1,
) -> Dict[str, float]:
    """Composite importance score combining multiple signals:"""
    node_ids = list(graph.nodes.keys())
    if not node_ids:
        return {}

    # --- PageRank component ---
    pr = pagerank(graph)
    pr_vals = np.array([pr.get(nid, 0.0) for nid in node_ids])
    pr_max = pr_vals.max() if pr_vals.max() > 0 else 1.0
    pr_norm = pr_vals / pr_max

    # --- Edge density component ---
    degrees = np.array([graph.degree(nid) for nid in node_ids], dtype=np.float64)
    deg_max = degrees.max() if degrees.max() > 0 else 1.0
    density_norm = degrees / deg_max

    # --- Recency component ---
    now = time.time()
    recency_scores = np.zeros(len(node_ids), dtype=np.float64)
    for i, nid in enumerate(node_ids):
        last_accessed = graph.nodes[nid].get("last_accessed", 0.0)
        if last_accessed > 0:
            hours_ago = (now - last_accessed) / 3600.0
            # Exponential decay: recent = high score
            recency_scores[i] = np.exp(-0.01 * hours_ago)
        else:
            created = graph.nodes[nid].get("created_at", 0.0)
            if created > 0:
                hours_ago = (now - created) / 3600.0
                recency_scores[i] = np.exp(-0.01 * hours_ago)
            else:
                recency_scores[i] = 0.0

    rec_max = recency_scores.max() if recency_scores.max() > 0 else 1.0
    recency_norm = recency_scores / rec_max

    # --- Access frequency component ---
    access_counts = np.array(
        [graph.nodes[nid].get("access_count", 0) for nid in node_ids],
        dtype=np.float64,
    )
    ac_max = access_counts.max() if access_counts.max() > 0 else 1.0
    access_norm = access_counts / ac_max

    # --- Composite ---
    importance = (
        alpha * pr_norm
        + beta * density_norm
        + gamma * recency_norm
        + delta * access_norm
    )

    # Normalize to [0, 1]
    imp_max = importance.max() if importance.max() > 0 else 1.0
    importance /= imp_max

    return {nid: float(importance[i]) for i, nid in enumerate(node_ids)}
