/*!
 * LearningFundClear India - calculator maths
 *
 * Pure functions, no DOM. Every output here is arithmetic on the inputs you gave,
 * not a forecast: nothing in this file knows or claims what any fund will return.
 * The formulas are reproduced on the methodology page so anyone can check them.
 */
(function (global) {
  'use strict';

  var FC = global.FC = global.FC || {};

  /**
   * Future value of a monthly investment, compounded monthly.
   * Each instalment is added at the start of the month, then the whole balance grows.
   * A yearly step-up increases the instalment every 12th month.
   */
  function sipValue(monthly, months, annualPct, stepUpPct) {
    var rate = (annualPct || 0) / 100 / 12;
    var stepUp = (stepUpPct || 0) / 100;
    var balance = 0, invested = 0, instalment = monthly;

    for (var month = 1; month <= months; month++) {
      if (month > 1 && (month - 1) % 12 === 0 && stepUp) instalment = instalment * (1 + stepUp);
      balance = (balance + instalment) * (1 + rate);
      invested += instalment;
    }
    return { value: balance, invested: invested, months: months, finalInstalment: instalment };
  }

  function sip(input) {
    var months = Math.round((input.years || 0) * 12);
    var result = sipValue(input.monthly || 0, months, input.ratePct || 0, input.stepUpPct || 0);
    result.gain = result.value - result.invested;
    result.multiple = result.invested ? result.value / result.invested : 0;
    return result;
  }

  function lumpsum(input) {
    var years = input.years || 0;
    var value = (input.amount || 0) * Math.pow(1 + (input.ratePct || 0) / 100, years);
    return { value: value, invested: input.amount || 0, gain: value - (input.amount || 0), years: years };
  }

  /**
   * What a higher expense ratio costs you.
   *
   * Same gross return, same monthly investment, same step-up - the only difference is
   * the expense ratio, which reduces the return actually credited to the investor.
   * The rupee gap is the answer to "is the Regular plan worth it?" for a given fund.
   */
  function expenseDrag(input) {
    var months = Math.round((input.years || 0) * 12);
    var gross = input.grossPct || 0;
    var direct = sipValue(input.monthly || 0, months, gross - (input.terDirect || 0), input.stepUpPct || 0);
    var regular = sipValue(input.monthly || 0, months, gross - (input.terRegular || 0), input.stepUpPct || 0);
    var gap = direct.value - regular.value;
    return {
      months: months,
      grossPct: gross,
      terDirect: input.terDirect || 0,
      terRegular: input.terRegular || 0,
      terGap: (input.terRegular || 0) - (input.terDirect || 0),
      direct: direct,
      regular: regular,
      extraCost: gap,
      extraCostShare: direct.value ? (gap / direct.value) * 100 : 0
    };
  }

  /** Cost of a one-off switch decision: how many extra months of investing the gap equals. */
  function monthsOfContributions(amount, monthly) {
    if (!monthly) return null;
    return amount / monthly;
  }

  function round(value, places) {
    var factor = Math.pow(10, places === undefined ? 0 : places);
    return Math.round(value * factor) / factor;
  }

  FC.calc = {
    sipValue: sipValue,
    sip: sip,
    lumpsum: lumpsum,
    expenseDrag: expenseDrag,
    monthsOfContributions: monthsOfContributions,
    round: round
  };
})(window);
