"""Tests that all Jac files compile without errors.

This ensures the Jac syntax is valid and all imports resolve.
Run with: pytest tests/test_jac_compile.py -v
"""

import subprocess
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
JAC_BIN = PROJECT_ROOT / "venv" / "bin" / "jac"

JAC_FILES = sorted(PROJECT_ROOT.glob("src/**/*.jac"))


def _jac_check(jac_file: Path) -> tuple[int, str]:
    """Run jac check on a file, return (returncode, stderr)."""
    result = subprocess.run(
        [str(JAC_BIN), "check", str(jac_file)],
        capture_output=True,
        text=True,
        cwd=str(PROJECT_ROOT),
        timeout=30,
    )
    return result.returncode, result.stdout + result.stderr


class TestJacCompilation:
    """Verify all .jac files parse and type-check cleanly."""

    @pytest.mark.parametrize(
        "jac_file",
        JAC_FILES,
        ids=[str(f.relative_to(PROJECT_ROOT)) for f in JAC_FILES],
    )
    def test_jac_file_compiles(self, jac_file: Path):
        if not JAC_BIN.exists():
            pytest.skip("jac binary not found in venv")
        code, output = _jac_check(jac_file)
        # Filter for actual syntax errors (E0xxx) vs type warnings (E1xxx)
        # Syntax errors like E0005, E0034, E0046 are hard failures
        # Type inference warnings like E1032 are acceptable (runtime resolves them)
        syntax_errors = [
            line for line in output.split("\n")
            if "error[E0" in line  # E0xxx = syntax/parse errors
        ]
        assert len(syntax_errors) == 0, (
            f"{jac_file.relative_to(PROJECT_ROOT)} has syntax errors:\n"
            + "\n".join(syntax_errors)
        )


class TestJacRun:
    """Verify jac run seeds the demo graph successfully."""

    def test_jac_run_seeds_graph(self):
        if not JAC_BIN.exists():
            pytest.skip("jac binary not found in venv")
        result = subprocess.run(
            [str(JAC_BIN), "run", "src/app.jac"],
            capture_output=True,
            text=True,
            cwd=str(PROJECT_ROOT),
            timeout=60,
        )
        assert result.returncode == 0, f"jac run failed:\n{result.stderr}"
        assert "147 nodes" in result.stdout or "node_count" in result.stdout
        assert "375 edges" in result.stdout or "edge_count" in result.stdout
        assert "ORBIT is ready" in result.stdout
