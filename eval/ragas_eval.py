"""Optional RAGAS batch evaluation (faithfulness / answer relevancy).

Run when you have a labeled CSV or JSONL with columns:
  question, answer, contexts (JSON array string), ground_truth (optional)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def run_ragas_on_records(records: list[dict[str, Any]]) -> dict[str, float] | str:
    try:
        from datasets import Dataset
        from ragas import evaluate
        from ragas.metrics import answer_relevancy, faithfulness
    except ImportError as e:
        return f"ragas/datasets not available: {e}"

    questions: list[str] = []
    answers: list[str] = []
    contexts: list[list[str]] = []
    for r in records:
        questions.append(str(r["question"]))
        answers.append(str(r["answer"]))
        ctx = r.get("contexts")
        if isinstance(ctx, str):
            ctx = json.loads(ctx)
        contexts.append([str(c) for c in (ctx or [])])

    ds = Dataset.from_dict(
        {
            "question": questions,
            "answer": answers,
            "contexts": contexts,
        }
    )
    result = evaluate(ds, metrics=[faithfulness, answer_relevancy])
    scores = getattr(result, "scores", None)
    if isinstance(scores, dict):
        return {str(k): float(v) for k, v in scores.items()}
    if isinstance(result, dict):
        return {str(k): float(v) for k, v in result.items()}
    return {"result": str(result)}


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(
            "Usage: python -m eval.ragas_eval path/to/examples.jsonl\n"
            "Each line: "
            '{"question":"...","answer":"...","contexts":["chunk1","chunk2"]}',
            file=sys.stderr,
        )
        return 2
    path = Path(argv[1])
    if not path.is_file():
        print(f"Not found: {path}", file=sys.stderr)
        return 1
    records = load_jsonl(path)
    out = run_ragas_on_records(records)
    if isinstance(out, str):
        print(out, file=sys.stderr)
        return 1
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
