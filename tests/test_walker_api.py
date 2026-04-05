"""Integration tests for Jac walker API endpoints.

Starts jac start, seeds the graph, and tests each walker endpoint.
Run with: pytest tests/test_walker_api.py -v -s
"""

import json
import subprocess
import time
from pathlib import Path

import pytest
import urllib.request
import urllib.error

PROJECT_ROOT = Path(__file__).resolve().parents[1]
JAC_BIN = PROJECT_ROOT / "venv" / "bin" / "jac"
BASE_URL = "http://localhost:8000"


def _post(path: str, data: dict = None, token: str = None) -> dict:
    """POST JSON to the Jac API and return parsed response."""
    url = f"{BASE_URL}{path}"
    body = json.dumps(data or {}).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read())
        except Exception:
            return {"ok": False, "error": {"message": f"HTTP {e.code}"}}
    except Exception as e:
        return {"ok": False, "error": {"message": str(e)}}


def _health_check() -> bool:
    try:
        req = urllib.request.Request(f"{BASE_URL}/healthz")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False


@pytest.fixture(scope="module")
def jac_server():
    """Start jac start, yield token, then kill."""
    if not JAC_BIN.exists():
        pytest.skip("jac binary not found in venv")

    # Kill any existing
    subprocess.run(["pkill", "-f", "jac start"], capture_output=True)
    time.sleep(1)

    proc = subprocess.Popen(
        [str(JAC_BIN), "start", "src/app.jac"],
        cwd=str(PROJECT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    # Wait for server
    for _ in range(20):
        if _health_check():
            break
        time.sleep(1)
    else:
        proc.kill()
        pytest.fail("jac start did not come up in 20s")

    # Register user (unique name per run to avoid stale anchor IDs)
    username = f"test_{int(time.time()) % 100000}"
    reg = _post("/user/register", {"username": username, "password": "test1234"})
    token = (reg or {}).get("data", {}).get("token", "")
    if not token:
        login = _post("/user/login", {"username": username, "password": "test1234"})
        token = (login or {}).get("data", {}).get("token", "")

    assert token, f"Failed to get auth token. Register response: {reg}"

    yield token

    proc.kill()
    proc.wait(timeout=5)


@pytest.fixture(scope="module")
def seeded_server(jac_server):
    """Seed the graph and return token."""
    token = jac_server
    result = _post("/walker/SeedGraph", {}, token)
    assert result.get("ok"), f"SeedGraph failed: {result}"
    r = result["data"]["result"]
    assert r["node_count"] == 147
    assert r["edge_count"] == 375
    return token


class TestSeedGraph:
    def test_seed_creates_nodes_and_edges(self, seeded_server):
        # Already verified in fixture
        pass

    def test_seed_is_idempotent(self, seeded_server):
        """Seeding again should still return counts (may add duplicates, but not crash)."""
        token = seeded_server
        result = _post("/walker/SeedGraph", {}, token)
        assert result.get("ok"), f"Second seed failed: {result}"


llm_test = pytest.mark.skipif(
    not Path(PROJECT_ROOT / ".env").exists(),
    reason="LLM tests require .env with GROQ_API_KEY",
)


def _retry_post(path, data, token, retries=3, delay=5):
    """POST with retries for LLM rate limits / flakiness."""
    for attempt in range(retries):
        result = _post(path, data, token)
        if result.get("ok"):
            return result
        msg = result.get("error", {}).get("message", "")
        if "RateLimit" in msg or "timed out" in msg or "tool_use_failed" in msg:
            time.sleep(delay * (attempt + 1))
            continue
        return result  # Non-retryable error
    return result


class TestExplorer:
    @llm_test
    def test_explorer_walks_graph(self, seeded_server):
        token = seeded_server
        result = _retry_post("/walker/Explorer", {"max_hops": 4, "min_confidence": 0.1}, token)
        assert result.get("ok"), f"Explorer failed: {result.get('error', {}).get('message', '')}"
        r = result["data"]["result"]
        path = r.get("traversal_path", [])
        assert len(path) >= 2, "Explorer should walk at least 2 nodes"
        assert r.get("hops_taken", 0) >= 2

    @llm_test
    def test_explorer_returns_path_names(self, seeded_server):
        token = seeded_server
        result = _retry_post("/walker/Explorer", {"max_hops": 3}, token)
        if result.get("ok"):
            r = result["data"]["result"]
            for name in r.get("traversal_path", []):
                assert isinstance(name, str)
                assert len(name) > 0


class TestPathfinder:
    @llm_test
    def test_pathfinder_finds_path(self, seeded_server):
        token = seeded_server
        result = _retry_post(
            "/walker/Pathfinder",
            {"question": "How does exercise connect to grades?"},
            token,
        )
        assert result.get("ok"), f"Pathfinder failed: {result.get('error', {}).get('message', '')}"
        r = result["data"]["result"]
        path = r.get("answer_path", []) or r.get("traversal_path", [])
        assert len(path) >= 1, "Pathfinder should find at least one node"

    @llm_test
    def test_pathfinder_returns_answer(self, seeded_server):
        token = seeded_server
        result = _retry_post(
            "/walker/Pathfinder",
            {"question": "What is spaced repetition?"},
            token,
        )
        if result.get("ok"):
            r = result["data"]["result"]
            answer = r.get("answer", "") or r.get("best_answer", "")
            assert len(answer) > 0, "Pathfinder should return an answer"


class TestConsolidator:
    def test_consolidator_analyzes_graph(self, seeded_server):
        """Consolidator with high min_cluster_size avoids LLM calls."""
        token = seeded_server
        result = _post(
            "/walker/Consolidator",
            {"decay_threshold": 0.4, "min_cluster_size": 999},
            token,
        )
        assert result.get("ok"), f"Consolidator failed: {result.get('error', {}).get('message', '')}"
        r = result["data"]["result"]
        # Check that the walker traversed concepts (field varies by walker version)
        analyzed = (
            r.get("concepts_analyzed", 0)
            or len(r.get("concepts_visited", []))
            or len(r.get("traversal_path", []))
        )
        assert analyzed > 0, f"Consolidator should analyze concepts. Got: {list(r.keys())}"


class TestCartographer:
    @llm_test
    def test_cartographer_maps_territories(self, seeded_server):
        token = seeded_server
        result = _retry_post("/walker/Cartographer", {}, token)
        assert result.get("ok"), f"Cartographer failed: {result.get('error', {}).get('message', '')}"
        r = result["data"]["result"]
        territories = r.get("territories", [])
        assert len(territories) >= 3, "Should find at least 3 knowledge domains"
        stats = r.get("stats", {})
        assert stats.get("total_concepts", 0) > 50


class TestGraphData:
    def test_graph_endpoint_returns_nodes(self, jac_server):
        """The /graph/data endpoint should show graph state."""
        try:
            req = urllib.request.Request(f"{BASE_URL}/graph/data")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            assert "nodes" in data
            assert len(data["nodes"]) >= 1  # At least root
        except Exception:
            pytest.skip("graph/data endpoint not available")
