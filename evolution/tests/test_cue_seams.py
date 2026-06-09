"""Regression tests for the cue-specific seams (no DSPy / LLM needed).

Covers skill discovery, frontmatter parsing, reassembly, the constraint set,
and the `cue lint-skill` gate. The lint tests skip gracefully when the `cue`
CLI is not on PATH (e.g. minimal CI), so the structural tests still run.
"""

import shutil
import pytest

from evolution.core.config import CueEvolutionConfig
from evolution.core.cue_skill import find_skill, load_skill, reassemble_skill
from evolution.core.constraints import ConstraintValidator
from evolution.core.cue_lint import lint_text

CFG = CueEvolutionConfig()
SAMPLE = "eu-funding/ted-tender-search"
_HAVE_CUE = shutil.which("cue") is not None


def test_repo_and_skills_root_resolve():
    assert CFG.skills_root.exists(), "resources/skills/skills not found from package"


def test_find_skill_by_category_slug():
    p = find_skill(SAMPLE, CFG.skills_root)
    assert p is not None and p.name == "SKILL.md"
    assert p.parent.name == "ted-tender-search"


def test_find_skill_by_bare_slug():
    p = find_skill("ted-tender-search", CFG.skills_root)
    assert p is not None and p.parent.name == "ted-tender-search"


def test_find_skill_missing_returns_none():
    assert find_skill("definitely/not-a-real-skill-xyz", CFG.skills_root) is None


def test_load_skill_parses_frontmatter():
    p = find_skill(SAMPLE, CFG.skills_root)
    skill = load_skill(p)
    assert skill["name"] == "ted-tender-search"
    assert skill["description"]
    assert skill["body"] and not skill["body"].startswith("---")


def test_reassemble_preserves_frontmatter():
    p = find_skill(SAMPLE, CFG.skills_root)
    skill = load_skill(p)
    rebuilt = reassemble_skill(skill["frontmatter"], "new body here")
    assert rebuilt.startswith("---\n")
    assert "name: ted-tender-search" in rebuilt
    assert "new body here" in rebuilt


@pytest.mark.skipif(not _HAVE_CUE, reason="cue CLI not on PATH")
def test_lint_gate_passes_clean_skill():
    p = find_skill(SAMPLE, CFG.skills_root)
    res = lint_text(p.read_text(), CFG)
    assert res.ran and res.ok and res.score >= 70


@pytest.mark.skipif(not _HAVE_CUE, reason="cue CLI not on PATH")
def test_lint_gate_fails_broken_skill():
    res = lint_text("# heading only\n\nno frontmatter", CFG)
    assert res.ran and not res.ok and res.errors


@pytest.mark.skipif(not _HAVE_CUE, reason="cue CLI not on PATH")
def test_constraint_set_on_real_skill():
    p = find_skill(SAMPLE, CFG.skills_root)
    skill = load_skill(p)
    results = ConstraintValidator(CFG).validate_all(skill["body"], skill["raw"])
    names = {c.constraint_name for c in results}
    assert {"size_limit", "non_empty", "skill_structure", "cue_lint"} <= names
    assert all(c.passed for c in results)


def test_lint_gate_fails_closed_when_cmd_broken():
    """A non-existent lint command must yield ok=False (never silently pass)."""
    cfg = CueEvolutionConfig()
    cfg.lint_cmd = "this-command-does-not-exist-xyz {path} --json"
    res = lint_text("anything", cfg)
    assert not res.ok and not res.ran


def test_reflective_extract_falls_back_without_sentinel():
    """Model output lacking the sentinels must yield the ORIGINAL body (safe
    no-op), never raw error-prose that could get applied."""
    from evolution.skills.reflective import _extract_body
    fb = "ORIGINAL BODY"
    # No sentinel (e.g. a refusal) -> fallback.
    assert _extract_body("Sorry, I can't help with that.", fb) == fb
    # With sentinel -> extracted, fences stripped.
    assert _extract_body("<SKILL_BODY>\n```md\nNEW BODY\n```\n</SKILL_BODY>", fb) == "NEW BODY"
    # Empty sentinel content -> fallback.
    assert _extract_body("<SKILL_BODY></SKILL_BODY>", fb) == fb


def test_auto_evolve_selects_top_existing_skill(tmp_path, monkeypatch):
    """Seeded skill_gap events → pick the most-flagged skill that EXISTS and is
    not in cooldown (the auto-trigger CHECK)."""
    from datetime import datetime, timezone
    from evolution.auto_evolve import select_skill
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    cfg = CueEvolutionConfig()  # skills_root auto-resolves to the real repo
    now = datetime.now(timezone.utc)
    ts = now.isoformat()
    al = cfg.analytics_log
    al.parent.mkdir(parents=True, exist_ok=True)

    def ev(skill, n):
        return "\n".join(
            f'{{"ts":"{ts}","event":"skill_gap","source":"critic","skill":"{skill}"}}'
            for _ in range(n))

    # nonexistent skill is most-flagged (5) but must be skipped; ted (3) wins.
    al.write_text("\n".join([
        ev("nope/does-not-exist", 5),
        ev("eu-funding/ted-tender-search", 3),
        ev("hostinger/dns", 1),
    ]) + "\n", encoding="utf-8")

    skill, count = select_skill(cfg, window_days=7, cooldown_days=7,
                                now=now.timestamp())
    assert skill == "eu-funding/ted-tender-search" and count == 3

    # Cooldown: mark ted recently evolved → next existing skill (dns) is chosen.
    cfg.evolution_log.write_text(
        f'{{"ts":"{ts}","kind":"skill-content","skill":"eu-funding/ted-tender-search","applied":true}}\n',
        encoding="utf-8")
    skill2, _ = select_skill(cfg, window_days=7, cooldown_days=7, now=now.timestamp())
    assert skill2 == "hostinger/dns"


def test_judge_is_better_parses_verdicts(monkeypatch):
    """The self-judge maps only BETTER → apply; everything else (incl. an
    unparseable reply) → don't apply. Conservative by design."""
    import evolution.skills.reflective as r
    skill = {"description": "d", "body": "orig"}
    cfg = CueEvolutionConfig()
    cases = {
        "VERDICT: BETTER — clearer triggers": True,
        "VERDICT: WORSE - dropped a command": False,
        "VERDICT: EQUAL — just reworded": False,
        "i think it's fine": False,  # unparseable → False
    }
    for reply, expected in cases.items():
        monkeypatch.setattr(r, "run_claude_p", lambda *a, **k: reply)
        ok, reason = r.judge_is_better(skill, "revised", cfg)
        assert ok is expected, f"{reply!r} -> {ok}, expected {expected} ({reason})"


def test_config_rejects_lint_cmd_without_path_placeholder():
    """A lint_cmd lacking {path} would lint nothing — reject it at construction."""
    with pytest.raises(ValueError):
        CueEvolutionConfig(lint_cmd="cue lint-skill --json")


def test_lint_gate_fails_closed_on_stray_braces():
    """Stray braces in lint_cmd must not raise — they must fail closed (M1)."""
    cfg = CueEvolutionConfig()
    cfg.lint_cmd = "echo {path} {unexpected}"  # {unexpected} would crash str.format
    res = lint_text("anything", cfg)
    assert not res.ok  # never raises, never silently passes
