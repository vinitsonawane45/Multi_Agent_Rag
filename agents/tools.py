"""External tools: safe calculator and a demo internal metrics store."""

from __future__ import annotations

import ast
import operator
from typing import Any

from langchain_core.tools import tool

_ALLOWED_BINOPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}


def _eval_ast(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval_ast(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_eval_ast(node.operand)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.UAdd):
        return _eval_ast(node.operand)
    if isinstance(node, ast.BinOp):
        op = type(node.op)
        if op not in _ALLOWED_BINOPS:
            raise ValueError("Operator not allowed")
        return float(_ALLOWED_BINOPS[op](_eval_ast(node.left), _eval_ast(node.right)))
    raise ValueError("Unsupported expression")


def safe_calculate(expression: str) -> str:
    expression = (expression or "").strip()
    if not expression:
        return "Error: empty expression"
    tree = ast.parse(expression, mode="eval")
    try:
        return str(_eval_ast(tree))
    except Exception as e:  # noqa: BLE001 — surface to model as string
        return f"Error: {e}"


# Simulated internal DB rows (replace with real SQL in production).
_INTERNAL_METRICS: dict[str, str] = {
    "headcount": "As of FY24 close: 1,240 full-time employees.",
    "revenue_yoy": "Reported YoY revenue growth: 12.4% (internal consolidated view).",
    "pto_policy_days": "Standard annual PTO accrual: 20 days for L3–L5; 25 for L6+.",
}


@tool
def calculator(expression: str) -> str:
    """Evaluate a numeric arithmetic expression safely, e.g. '(18.5 + 3) * 1.07' or '2**10'."""
    return safe_calculate(expression)


@tool
def internal_metric_lookup(metric_key: str) -> str:
    """Look up a canned internal KPI or policy figure by key. Keys: headcount, revenue_yoy, pto_policy_days."""
    key = (metric_key or "").strip().lower()
    if key not in _INTERNAL_METRICS:
        return (
            f"No canned metric for {metric_key!r}. "
            f"Known keys: {', '.join(sorted(_INTERNAL_METRICS))}."
        )
    return _INTERNAL_METRICS[key]


def all_tools() -> list[Any]:
    return [calculator, internal_metric_lookup]
