/* Conservative market-regime policy. Context can only withhold eligibility,
   require more confirmations or reduce risk. It never creates a BUY/SELL. */
(function (root) {
  'use strict';

  var DEFAULTS = {
    normalConfirmations: 1,
    weakBreadth: 0.4,
    weakRiskMultiplier: 0.5
  };

  function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
  function clampRisk(v) { return isNum(v) ? Math.max(0, Math.min(1, v)) : 0; }

  function unavailableReason(regime, policy) {
    if (!regime) return 'Market-regime context is unavailable. Context-dependent setups need at least two confirmations.';
    if (regime.freshness === 'STALE') return 'Market-regime context is stale (as of ' + regime.asOf + '). Context-dependent setups need fresh data and at least two confirmations.';
    if (regime.freshness === 'UNAVAILABLE' || regime.regime === 'UNAVAILABLE') return 'Market-regime context is unavailable from ' + (regime.provider || 'the provider') + '. Context-dependent setups are blocked.';
    return 'Market-regime context is not fresh. Context-dependent setups are blocked.';
  }

  function decide(regime, policy) {
    policy = Object.assign({}, DEFAULTS, policy || {});
    policy.normalConfirmations = Math.max(1, Math.floor(policy.normalConfirmations || 1));
    if (!regime || regime.regime === 'UNAVAILABLE' || regime.freshness !== 'FRESH') {
      return {
        available: false,
        regime: regime && regime.regime ? regime.regime : 'UNAVAILABLE',
        riskMultiplier: 0,
        requiredConfirmations: Math.max(2, policy.normalConfirmations),
        normalConfirmations: policy.normalConfirmations,
        reason: unavailableReason(regime, policy),
        blockers: ['CONTEXT_UNAVAILABLE']
      };
    }
    var breadthWeak = isNum(regime.breadth) && regime.breadth < policy.weakBreadth;
    var downtrend = regime.indexTrend === 'DOWN';
    if (regime.regime === 'RISK_OFF' || downtrend || breadthWeak) {
      var why = regime.regime === 'RISK_OFF' ? 'Risk-off regime' : downtrend ? 'Index trend is down' : 'Market breadth is weak';
      return {
        available: true,
        regime: regime.regime,
        riskMultiplier: Math.min(policy.weakRiskMultiplier, 1),
        requiredConfirmations: Math.max(2, policy.normalConfirmations),
        normalConfirmations: policy.normalConfirmations,
        reason: why + '. Additional confirmation is required and suggested risk is reduced.',
        blockers: []
      };
    }
    if (regime.regime === 'RISK_ON') {
      return {
        available: true,
        regime: 'RISK_ON',
        riskMultiplier: 1,
        requiredConfirmations: policy.normalConfirmations,
        normalConfirmations: policy.normalConfirmations,
        reason: 'Supportive regime. Normal confirmations apply; hard invalidations still apply.',
        blockers: []
      };
    }
    return {
      available: true,
      regime: 'NEUTRAL',
      riskMultiplier: 1,
      requiredConfirmations: policy.normalConfirmations,
      normalConfirmations: policy.normalConfirmations,
      reason: 'Neutral regime. Normal confirmations apply.',
      blockers: []
    };
  }

  function apply(candidate, context, policy) {
    if (!candidate || typeof candidate !== 'object') throw new Error('candidate is required');
    context = context || {};
    var decision = decide(context.regime, policy);
    var out = Object.assign({}, candidate);
    var baseDecision = candidate.decision === 'BUY' || candidate.decision === 'SELL' ? candidate.decision : (candidate.decision || 'WAIT');
    var confirmations = isNum(candidate.confirmationCount) ? Math.max(0, Math.floor(candidate.confirmationCount)) : 0;
    // Optional context never imposes its two-confirmation floor on a
    // candle-only setup when context is unavailable.
    var required = needsContext || decision.available ? decision.requiredConfirmations : decision.normalConfirmations;
    var blockers = [];
    var effects = [decision.reason];

    if (candidate.valid === false || baseDecision === 'NO_TRADE') {
      return Object.assign(out, {
        decision: 'NO_TRADE',
        status: candidate.status || 'INVALID_SETUP',
        confirmationCount: confirmations,
        requiredConfirmations: Math.max(required, 1),
        blockers: blockers.concat(candidate.blockers || []).concat(['INVALID_SETUP']),
        explanation: 'The setup is invalid before market context is considered. Context cannot make it valid.',
        riskMultiplier: 0,
        marketRegime: decision.regime,
        strategyVersion: candidate.strategyVersion || 'unversioned',
        contextEffects: effects
      });
    }

    var needsContext = candidate.requiresContext === true;
    var needsOi = candidate.requiresOI === true;
    var needsBulk = candidate.requiresBulk === true;

    // Optional context never blocks a candle-only setup.
    if (needsContext && !decision.available) {
      blockers.push('BLOCKED_BY_CONTEXT');
    }
    if (needsOi && !context.oi) {
      blockers.push('OPTIONS_OI_UNAVAILABLE');
      effects.push('Options OI is required by this rule but is unavailable.');
    }
    if (needsBulk && !context.bulk) {
      blockers.push('BULK_DEAL_UNAVAILABLE');
      effects.push('Bulk-deal context is required by this rule but is unavailable.');
    }

    // Risk can be reduced, never raised. Absent optional context leaves risk
    // unchanged instead of zeroing a candle-only plan.
    var candidateRisk = isNum(candidate.riskMultiplier) ? clampRisk(candidate.riskMultiplier) : 1;
    var regimeRisk = decision.available || needsContext ? decision.riskMultiplier : 1;
    out.riskMultiplier = Math.min(1, candidateRisk, regimeRisk);

    if (blockers.length) {
      out.decision = 'WAIT';
      out.status = blockers[0];
    } else if (confirmations < required) {
      out.decision = 'WAIT';
      out.status = 'AWAITING_CONTEXT_CONFIRMATION';
    } else if (baseDecision === 'BUY' || baseDecision === 'SELL') {
      out.decision = baseDecision;
      out.status = candidate.status || 'ELIGIBLE';
    } else {
      out.decision = 'WAIT';
      out.status = candidate.status || 'WAIT';
    }

    out.confirmationCount = confirmations;
    out.requiredConfirmations = required;
    out.blockers = blockers.concat(candidate.blockers || []);
    out.explanation = effects.concat([
      'Required confirmations: ' + required + '; available: ' + confirmations + '.',
      'Risk multiplier: ' + out.riskMultiplier + '×.'
    ]).join(' ');
    out.marketRegime = decision.regime;
    out.strategyVersion = candidate.strategyVersion || 'unversioned';
    out.contextEffects = effects;
    return out;
  }

  var api = { DEFAULTS: DEFAULTS, decide: decide, apply: apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LfcMarketRegime = api;
})(typeof window !== 'undefined' ? window : globalThis);
