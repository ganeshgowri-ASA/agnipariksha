"""Two-parameter Weibull fit and CDF.

Implemented without SciPy: the shape parameter ``k`` is found via
Newton-Raphson on the MLE score equation, then the scale ``lambda`` is
computed in closed form. A rolling window keeps the fit responsive to
the most recent ``window`` failure intervals.

Reference: maximum-likelihood equations from
Weibull (1951), as standard in reliability engineering.
"""
from __future__ import annotations

import math
from typing import Iterable, List, Optional, Tuple


def _mle_score(k: float, xs: List[float], log_xs: List[float]) -> float:
    """Score function whose root gives the MLE shape parameter.

    f(k) = 1/k + mean(log x) - sum(x^k * log x) / sum(x^k)
    """
    pow_xs = [x ** k for x in xs]
    s_pow = sum(pow_xs)
    if s_pow == 0:
        return float("inf")
    s_pow_log = sum(p * lx for p, lx in zip(pow_xs, log_xs))
    return 1.0 / k + sum(log_xs) / len(xs) - s_pow_log / s_pow


def _mle_score_deriv(k: float, xs: List[float], log_xs: List[float]) -> float:
    pow_xs = [x ** k for x in xs]
    s_pow = sum(pow_xs)
    if s_pow == 0:
        return float("-inf")
    pow_log = [p * lx for p, lx in zip(pow_xs, log_xs)]
    pow_log2 = [p * lx * lx for p, lx in zip(pow_xs, log_xs)]
    s_pow_log = sum(pow_log)
    s_pow_log2 = sum(pow_log2)
    # d/dk of (sum x^k * log x) / sum x^k
    quot_deriv = (
        s_pow_log2 * s_pow - s_pow_log * s_pow_log
    ) / (s_pow * s_pow)
    return -1.0 / (k * k) - quot_deriv


def weibull_fit(
    intervals_hours: Iterable[float],
    window: Optional[int] = 50,
    max_iter: int = 60,
    tol: float = 1e-7,
) -> Optional[Tuple[float, float]]:
    """Maximum-likelihood Weibull fit.

    Returns ``(shape_k, scale_lambda_hours)``, or ``None`` if the sample
    is too small or degenerate (need >=2 positive intervals with variation).
    """
    xs = [float(x) for x in intervals_hours if x is not None and x > 0]
    if window is not None and window > 0:
        xs = xs[-window:]
    if len(xs) < 2:
        return None
    if max(xs) - min(xs) < 1e-9:
        return None

    log_xs = [math.log(x) for x in xs]

    # Initial guess from method of moments: k0 ~ (sigma/mean)^-1.086.
    mean = sum(xs) / len(xs)
    var = sum((x - mean) ** 2 for x in xs) / len(xs)
    sd = math.sqrt(var)
    if sd <= 0:
        return None
    cv = sd / mean
    k = max(0.5, min(8.0, 1.0 / max(cv, 1e-3) ** 1.086))

    # Newton-Raphson with bracketing fallback.
    for _ in range(max_iter):
        f = _mle_score(k, xs, log_xs)
        if abs(f) < tol:
            break
        fp = _mle_score_deriv(k, xs, log_xs)
        if not math.isfinite(fp) or abs(fp) < 1e-12:
            break
        step = f / fp
        k_new = k - step
        # Keep shape positive; damp aggressive steps.
        if k_new <= 0:
            k_new = k / 2
        if abs(k_new - k) > 4.0:
            k_new = k + math.copysign(4.0, k_new - k)
        k = k_new
        if k <= 0:
            return None

    # Scale: lambda = (mean of x^k) ^ (1/k)
    s_pow = sum(x ** k for x in xs) / len(xs)
    if s_pow <= 0:
        return None
    lam = s_pow ** (1.0 / k)
    if not (math.isfinite(k) and math.isfinite(lam)) or lam <= 0:
        return None
    return k, lam


def weibull_cdf(t: float, shape: float, scale: float) -> float:
    """F(t) = 1 - exp(-(t/lambda)^k)."""
    if t <= 0 or scale <= 0 or shape <= 0:
        return 0.0
    return 1.0 - math.exp(-((t / scale) ** shape))


def weibull_quantile(p: float, shape: float, scale: float) -> float:
    """Inverse CDF: t = lambda * (-ln(1-p))^(1/k)."""
    if not 0 < p < 1 or shape <= 0 or scale <= 0:
        raise ValueError("invalid args")
    return scale * (-math.log(1.0 - p)) ** (1.0 / shape)
