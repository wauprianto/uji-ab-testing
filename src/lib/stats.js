// ============================================================================
// UJI — Statistical Engine
// Implemented from first principles (no black-box stats library) so every
// number on screen can be traced back to a formula.
// ============================================================================

// ---- Basic descriptive helpers ---------------------------------------------

export function mean(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

export function sampleVariance(arr) {
  const m = mean(arr);
  const sq = arr.reduce((s, x) => s + (x - m) ** 2, 0);
  return sq / (arr.length - 1);
}

export function sampleStdDev(arr) {
  return Math.sqrt(sampleVariance(arr));
}

export function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function normalPDF(x, m, sd) {
  return (1 / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - m) / sd) ** 2);
}

// ---- Normal distribution ----------------------------------------------------
// erf approximation: Abramowitz & Stegun 7.1.26 (max error ~1.5e-7)
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export function normalCDF(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Inverse normal CDF (probit), Acklam's rational approximation, |err| < 1.15e-9
export function normalInvCDF(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];
  const pLow = 0.02425;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

// ---- Student's t-distribution ----------------------------------------------
// log-gamma via Lanczos approximation
function logGamma(x) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// continued fraction for the incomplete beta function (Numerical Recipes)
function betacf(x, a, b) {
  const MAXIT = 200, EPS = 3e-9, FPMIN = 1e-30;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function regularizedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(x, a, b)) / a;
  }
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

// regularized lower incomplete gamma P(a,x) — Numerical Recipes gammp/gammq,
// needed for the chi-square distribution's CDF
function gammaSeries(a, x) {
  const ITMAX = 200, EPS = 3e-9;
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 1; n <= ITMAX; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function gammaContinuedFraction(a, x) {
  const ITMAX = 200, EPS = 3e-9, FPMIN = 1e-30;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i <= ITMAX; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

function regularizedGammaP(a, x) {
  if (x <= 0) return 0;
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaContinuedFraction(a, x);
}

// P(T <= t) for Student's t with `df` degrees of freedom
export function studentTCDF(t, df) {
  const x = df / (df + t * t);
  const p = regularizedIncompleteBeta(x, df / 2, 0.5) / 2;
  return t > 0 ? 1 - p : p;
}

// two-tailed p-value: P(|T| >= |t|)
export function studentTTwoTailedP(t, df) {
  const x = df / (df + t * t);
  return regularizedIncompleteBeta(x, df / 2, 0.5);
}

// inverse t CDF via bisection on the monotonic forward CDF (robust, no closed form needed)
export function studentTInvCDF(p, df) {
  let lo = -100, hi = 100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCDF(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ============================================================================
// A/B TEST: two-proportion z-test (conversion-rate style metrics)
// ============================================================================
export function twoProportionZTest({ controlConversions, controlTotal, variantConversions, variantTotal, alpha = 0.05 }) {
  const p1 = controlConversions / controlTotal;
  const p2 = variantConversions / variantTotal;
  const pooled = (controlConversions + variantConversions) / (controlTotal + variantTotal);

  // pooled SE is used for the test statistic (assumes null hypothesis p1 = p2)
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / controlTotal + 1 / variantTotal));
  const z = sePooled === 0 ? 0 : (p2 - p1) / sePooled;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));

  // unpooled SE is used for the confidence interval (doesn't assume p1 = p2)
  const seDiff = Math.sqrt((p1 * (1 - p1)) / controlTotal + (p2 * (1 - p2)) / variantTotal);
  const zCrit = normalInvCDF(1 - alpha / 2);
  const diff = p2 - p1;

  return {
    testType: "proportion",
    p1, p2, diff,
    relativeLift: p1 === 0 ? null : (diff / p1) * 100,
    z, pValue,
    ci: [diff - zCrit * seDiff, diff + zCrit * seDiff],
    alpha,
    significant: pValue < alpha,
    n1: controlTotal, n2: variantTotal,
  };
}

// ============================================================================
// A/B TEST: Welch's t-test (continuous metrics — revenue, time on page, etc.)
// Welch's version (not Student's pooled) because we should never assume the
// control and variant have equal variance.
// ============================================================================
export function welchTTest({ control, variant, alpha = 0.05 }) {
  const n1 = control.length, n2 = variant.length;
  const m1 = mean(control), m2 = mean(variant);
  const v1 = sampleVariance(control), v2 = sampleVariance(variant);

  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const t = se === 0 ? 0 : (m2 - m1) / se;

  // Welch–Satterthwaite degrees of freedom
  const df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));

  const pValue = studentTTwoTailedP(t, df);
  const tCrit = studentTInvCDF(1 - alpha / 2, df);
  const diff = m2 - m1;

  return {
    testType: "continuous",
    m1, m2, diff,
    relativeLift: m1 === 0 ? null : (diff / m1) * 100,
    t, df, pValue,
    ci: [diff - tCrit * se, diff + tCrit * se],
    alpha,
    significant: pValue < alpha,
    n1, n2,
    sd1: Math.sqrt(v1), sd2: Math.sqrt(v2),
  };
}

// ============================================================================
// SAMPLE SIZE / POWER — two-proportion test, equal allocation
// Standard formula: n per arm using pooled variance for the alpha term and
// unpooled variance for the beta term.
// ============================================================================
export function sampleSizeForProportion({ baselineRate, mde, mdeType = "relative", alpha = 0.05, power = 0.8 }) {
  const p1 = baselineRate;
  const p2 = mdeType === "relative" ? p1 * (1 + mde) : p1 + mde;
  const pBar = (p1 + p2) / 2;

  const zAlpha = normalInvCDF(1 - alpha / 2);
  const zBeta = normalInvCDF(power);

  const numerator = (zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2;
  const denominator = (p2 - p1) ** 2;
  const nPerArm = numerator / denominator;

  return {
    p1, p2,
    nPerArm: Math.ceil(nPerArm),
    totalN: Math.ceil(nPerArm) * 2,
    alpha, power,
  };
}

// ============================================================================
// MULTI-VARIANT: Chi-Square test of independence (k groups × converted/not)
// For k = 2 this is mathematically equivalent to the two-proportion z-test
// (chiSq = z²), which is how the implementation below is verified.
// ============================================================================
export function chiSquareTest({ groups, alpha = 0.05 }) {
  const totalConversions = groups.reduce((s, g) => s + g.conversions, 0);
  const totalN = groups.reduce((s, g) => s + g.total, 0);
  const overallRate = totalConversions / totalN;

  let chiSq = 0;
  const details = groups.map((g) => {
    const rate = g.conversions / g.total;
    const zCrit = normalInvCDF(1 - alpha / 2);
    const se = Math.sqrt((rate * (1 - rate)) / g.total);
    const expConv = g.total * overallRate;
    const expNonConv = g.total * (1 - overallRate);
    const obsNonConv = g.total - g.conversions;
    chiSq += (g.conversions - expConv) ** 2 / expConv + (obsNonConv - expNonConv) ** 2 / expNonConv;
    return {
      name: g.name, conversions: g.conversions, total: g.total, rate,
      ci: [Math.max(0, rate - zCrit * se), Math.min(1, rate + zCrit * se)],
    };
  });

  const df = groups.length - 1;
  const pValue = 1 - regularizedGammaP(df / 2, chiSq / 2);

  return {
    testType: "chisquare",
    groups: details,
    chiSq, df, pValue, alpha,
    significant: pValue < alpha,
    overallRate,
  };
}

// ============================================================================
// MULTI-VARIANT: One-way ANOVA (k groups, continuous metric)
// For k = 2 this is mathematically equivalent to Welch's / Student's t-test
// (F = t²) under equal variance — verified against welchTTest for k=2.
// ============================================================================
export function oneWayANOVA({ groups, alpha = 0.05 }) {
  const allData = groups.flatMap((g) => g.data);
  const N = allData.length;
  const grandMean = mean(allData);
  const k = groups.length;

  let ssBetween = 0, ssWithin = 0;
  const details = groups.map((g) => {
    const n = g.data.length;
    const gMean = mean(g.data);
    const gSd = sampleStdDev(g.data);
    ssBetween += n * (gMean - grandMean) ** 2;
    ssWithin += g.data.reduce((s, x) => s + (x - gMean) ** 2, 0);
    const tCrit = studentTInvCDF(1 - alpha / 2, n - 1);
    const se = gSd / Math.sqrt(n);
    return { name: g.name, mean: gMean, sd: gSd, n, ci: [gMean - tCrit * se, gMean + tCrit * se] };
  });

  const dfBetween = k - 1;
  const dfWithin = N - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const F = msBetween / msWithin;

  const x = (dfBetween * F) / (dfBetween * F + dfWithin);
  const pValue = 1 - regularizedIncompleteBeta(x, dfBetween / 2, dfWithin / 2);

  return {
    testType: "anova",
    groups: details,
    F, dfBetween, dfWithin, pValue, alpha,
    significant: pValue < alpha,
    grandMean,
  };
}

// ============================================================================
// NON-PARAMETRIC: Mann-Whitney U test
// No assumption of normality — works directly on ranks. Uses the normal
// approximation (with tie correction) for the p-value, appropriate once each
// group has more than ~10 observations.
// ============================================================================
export function mannWhitneyU({ control, variant, alpha = 0.05 }) {
  const n1 = control.length, n2 = variant.length;
  const combined = [
    ...control.map((v) => ({ value: v, group: "control" })),
    ...variant.map((v) => ({ value: v, group: "variant" })),
  ].sort((a, b) => a.value - b.value);

  // assign tied observations the average of the ranks they span
  let i = 0;
  const tieSizes = [];
  while (i < combined.length) {
    let j = i;
    while (j + 1 < combined.length && combined[j + 1].value === combined[i].value) j++;
    const avgRank = (i + 1 + j + 1) / 2;
    for (let m = i; m <= j; m++) combined[m].rank = avgRank;
    tieSizes.push(j - i + 1);
    i = j + 1;
  }

  const rSumControl = combined.filter((d) => d.group === "control").reduce((s, d) => s + d.rank, 0);
  const U1 = rSumControl - (n1 * (n1 + 1)) / 2;
  const U2 = n1 * n2 - U1;
  const U = Math.min(U1, U2);

  const N = n1 + n2;
  const tieCorrection = tieSizes.reduce((s, t) => s + (t ** 3 - t), 0);
  const sdU = Math.sqrt((n1 * n2 / 12) * (N + 1 - tieCorrection / (N * (N - 1))));
  const meanU = (n1 * n2) / 2;

  const z = sdU === 0 ? 0 : (U - meanU) / sdU;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));

  return {
    testType: "mannwhitney",
    U, U1, U2, z, pValue, alpha,
    significant: pValue < alpha,
    n1, n2,
    medianControl: median(control), medianVariant: median(variant),
    control, variant,
  };
}

// ============================================================================
// BAYESIAN A/B TEST (proportions) — Beta-Binomial conjugate model
// Posterior for each arm is Beta(prior_a + conversions, prior_b + non-conversions).
// Monte Carlo draws from both posteriors estimate P(variant > control), the
// expected uplift, and the expected loss of picking the "wrong" arm.
// ============================================================================
function randomStandardNormal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Marsaglia & Tsang (2000) method, shape >= 1; boosts shape<1 via the standard trick
function gammaSample(shape) {
  if (shape < 1) {
    return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      x = randomStandardNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(a, b) {
  const x = gammaSample(a);
  const y = gammaSample(b);
  return x / (x + y);
}

export function betaPDF(x, a, b) {
  if (x <= 0 || x >= 1) return 0;
  const logB = logGamma(a) + logGamma(b) - logGamma(a + b);
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logB);
}

// bisection inverse of the incomplete-beta CDF, used for credible intervals
function betaInvCDF(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(mid, a, b) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function bayesianProportionTest({
  controlConversions, controlTotal, variantConversions, variantTotal,
  priorAlpha = 1, priorBeta = 1, samples = 40000,
}) {
  const aC = priorAlpha + controlConversions, bC = priorBeta + (controlTotal - controlConversions);
  const aV = priorAlpha + variantConversions, bV = priorBeta + (variantTotal - variantConversions);

  let variantWins = 0, upliftSum = 0, lossIfVariantSum = 0, lossIfControlSum = 0;
  for (let i = 0; i < samples; i++) {
    const sc = betaSample(aC, bC);
    const sv = betaSample(aV, bV);
    if (sv > sc) variantWins++;
    upliftSum += (sv - sc) / sc;
    lossIfVariantSum += Math.max(sc - sv, 0);
    lossIfControlSum += Math.max(sv - sc, 0);
  }

  return {
    testType: "bayesian",
    controlRate: aC / (aC + bC),
    variantRate: aV / (aV + bV),
    controlCI: [betaInvCDF(0.025, aC, bC), betaInvCDF(0.975, aC, bC)],
    variantCI: [betaInvCDF(0.025, aV, bV), betaInvCDF(0.975, aV, bV)],
    probVariantBeatsControl: variantWins / samples,
    expectedUplift: (upliftSum / samples) * 100,
    expectedLossChoosingVariant: lossIfVariantSum / samples,
    expectedLossChoosingControl: lossIfControlSum / samples,
    posteriorControl: { a: aC, b: bC },
    posteriorVariant: { a: aV, b: bV },
    samples,
  };
}

// ============================================================================
// CSV → grouped raw data → auto-run the right test
// Expects columns: group (control/variant, or a/b, or 0/1) plus either
// `converted` (0/1) for a proportion test or `value` (numeric) for a t-test.
// ============================================================================
export function summarizeRawData(rows) {
  const isControl = (g) => ["control", "a", "0"].includes(String(g).trim().toLowerCase());
  const isVariant = (g) => ["variant", "treatment", "b", "1"].includes(String(g).trim().toLowerCase());

  const control = [];
  const variant = [];
  rows.forEach((row) => {
    if (isControl(row.group)) control.push(row);
    else if (isVariant(row.group)) variant.push(row);
  });

  const hasConverted = rows.some((r) => r.converted !== undefined && r.converted !== "");
  const hasValue = rows.some((r) => r.value !== undefined && r.value !== "");

  if (hasConverted) {
    const controlConversions = control.filter((r) => Number(r.converted) === 1).length;
    const variantConversions = variant.filter((r) => Number(r.converted) === 1).length;
    return {
      detectedType: "proportion",
      controlConversions, controlTotal: control.length,
      variantConversions, variantTotal: variant.length,
    };
  }
  if (hasValue) {
    return {
      detectedType: "continuous",
      control: control.map((r) => Number(r.value)).filter((v) => !Number.isNaN(v)),
      variant: variant.map((r) => Number(r.value)).filter((v) => !Number.isNaN(v)),
    };
  }
  throw new Error("CSV harus punya kolom 'converted' (0/1) atau 'value' (angka), plus kolom 'group'.");
}
