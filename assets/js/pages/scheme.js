/*!
 * FundClear India - single scheme page
 * Reads ?code= (AMFI scheme code) and renders one scheme, its other plan if it has
 * one, the expense-ratio assumption, and same-category peers.
 */
(function (global) {
  'use strict';

  var FC = global.FC, ui = FC.ui, el = ui.el, funds = FC.funds, calc = FC.calc;

  var DEMO = { monthly: 5000, years: 10, grossPct: 11 };

  function boot() {
    var code = ui.queryOne('code', '');
    var scheme = code ? funds.byCode(code) : null;
    var main = document.getElementById('scheme');

    if (!scheme) {
      document.getElementById('missing').hidden = false;
      document.getElementById('scheme-body').hidden = true;
      return;
    }
    render(scheme);
    void main;
  }

  function render(scheme) {
    document.title = scheme.name + ' — FundClear India';
    document.getElementById('missing').hidden = true;
    document.getElementById('scheme-body').hidden = false;

    var sibling = funds.siblingPlan(scheme);
    var ter = funds.terAssumption(scheme);
    var gap = sibling ? funds.planGap(scheme.plan === 'Direct' ? scheme : sibling, scheme.plan === 'Direct' ? sibling : scheme) : null;

    var drag = calc.expenseDrag({
      monthly: DEMO.monthly, years: DEMO.years, grossPct: DEMO.grossPct,
      terDirect: ter.directMid, terRegular: ter.regularMid
    });

    var head = document.getElementById('scheme-head');
    ui.clear(head);
    head.appendChild(el('h1', { text: scheme.name }));
    head.appendChild(el('p', { class: 'scheme-meta' }, [
      el('span', { class: 'badge ' + (scheme.plan === 'Direct' ? 'badge-direct' : 'badge-regular'), text: scheme.plan + ' plan' }),
      el('span', { class: 'badge badge-group', text: scheme.group }),
      el('span', { text: scheme.category })
    ]));

    var facts = document.getElementById('scheme-facts');
    ui.clear(facts);
    facts.appendChild(el('div', { class: 'result-box' }, [
      el('div', { class: 'result-label', text: 'Latest NAV' }),
      el('div', { class: 'result-figure', text: ui.nav(scheme.nav) }),
      el('div', { class: 'result-label', text: 'as published by AMFI for ' + scheme.date })
    ]));

    var table = document.getElementById('scheme-table');
    ui.clear(table);
    [
      ['Fund house', scheme.amc],
      ['Category', scheme.category],
      ['Group', scheme.group],
      ['Plan', scheme.plan + ' plan'],
      ['Option', scheme.option + ' option'],
      ['AMFI scheme code', scheme.code],
      ['ISIN', scheme.isin || 'not published'],
      ['NAV', ui.nav(scheme.nav)],
      ['NAV date', scheme.date]
    ].forEach(function (pair) {
      table.appendChild(el('li', null, [
        el('span', { class: 'k', text: pair[0] }),
        el('span', { class: 'v', text: pair[1] })
      ]));
    });

    /* Sibling plan: the same fund bought the other way round. */
    var siblingHost = document.getElementById('sibling');
    ui.clear(siblingHost);
    if (sibling) {
      siblingHost.appendChild(el('div', { class: 'card' }, [
        el('h3', { text: 'The same fund, ' + sibling.plan.toLowerCase() + ' plan' }),
        el('p', { class: 'card-note', text: 'Both plans invest the same portfolio; they differ in what they charge and therefore in the NAV you buy at.' }),
        el('ul', { class: 'kv' }, [
          el('li', null, [
            el('span', { class: 'k', text: 'This scheme (' + scheme.plan + ')' }),
            el('span', { class: 'v', text: ui.nav(scheme.nav) + ' · ' + scheme.date })
          ]),
          el('li', null, [
            el('span', { class: 'k', text: sibling.plan + ' plan' }),
            el('span', { class: 'v', text: ui.nav(sibling.nav) + ' · ' + sibling.date })
          ]),
          el('li', null, [
            el('span', { class: 'k', text: 'Gap between plans' }),
            el('span', { class: 'v', text: gap === null ? '—' : ui.pct(gap) })
          ])
        ]),
        el('div', { class: 'scheme-foot', style: { marginTop: '12px' } }, [
          el('a', { class: 'btn btn-sm', href: 'scheme.html?code=' + sibling.code, text: 'Open the ' + sibling.plan.toLowerCase() + ' plan' }),
          el('a', { class: 'btn btn-sm', href: 'compare.html?codes=' + scheme.code + ',' + sibling.code, text: 'Compare side by side' })
        ])
      ]));
    } else {
      siblingHost.appendChild(el('p', { class: 'card-note', text: 'AMFI does not list the other plan for this fund in the current snapshot.' }));
    }

    /* Expense ratio: an assumption, always labelled. */
    var terHost = document.getElementById('ter');
    ui.clear(terHost);
    terHost.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: 'Expense ratio (assumed)' }),
      el('p', { class: 'card-note' }, [
        'FundClear does not publish a per-scheme expense ratio, because AMFI has no machine-readable TER file. ',
        el('span', { class: 'tag-assumed', text: 'These are illustrative industry ranges, not this fund\'s actual figures.' }),
        ' Check the fund\'s factsheet for the real number.'
      ]),
      el('ul', { class: 'kv' }, [
        el('li', null, [el('span', { class: 'k', text: 'Direct plan range' }), el('span', { class: 'v', text: ui.pct(ter.direct[0]) + ' – ' + ui.pct(ter.direct[1]) })]),
        el('li', null, [el('span', { class: 'k', text: 'Regular plan range' }), el('span', { class: 'v', text: ui.pct(ter.regular[0]) + ' – ' + ui.pct(ter.regular[1]) })])
      ]),
      el('p', { class: 'card-note', style: { marginTop: '12px' } }, [
        'If those assumptions held, ' + ui.inr(DEMO.monthly, 0) + '/month for ' + DEMO.years + ' years at ' + ui.pct(DEMO.grossPct, 1)
          + ' gross would end ' + ui.inr(Math.abs(drag.extraCost), 0) + ' apart: ',
        el('strong', { text: ui.inrCompact(Math.abs(drag.extraCost)) }),
        ' more in the direct plan. An arithmetic illustration of the fee difference, not a forecast.'
      ]),
      el('div', { class: 'scheme-foot', style: { marginTop: '12px' } }, [
        el('a', { class: 'btn btn-sm', href: 'calculators.html#drag', text: 'Open the expense calculator' }),
        el('a', { class: 'btn btn-sm', href: 'methodology.html#ter', text: 'Why TER is an assumption' })
      ])
    ]));

    /* Peers */
    var peerHost = document.getElementById('peers');
    ui.clear(peerHost);
    funds.peers(scheme, 5).forEach(function (peer) {
      peerHost.appendChild(el('li', { class: 'scheme' }, [
        el('div', { class: 'scheme-top' }, [
          el('div', { class: 'scheme-name' }, [el('a', { href: 'scheme.html?code=' + peer.code, text: peer.name })]),
          el('div', { class: 'scheme-nav' }, [el('b', { text: ui.nav(peer.nav) }), el('span', { text: peer.date })])
        ]),
        el('div', { class: 'scheme-meta' }, [el('span', { text: peer.amc }), el('span', { text: peer.plan }), el('span', { text: 'AMFI ' + peer.code })])
      ]));
    });
    if (!peerHost.children.length) peerHost.appendChild(el('li', { class: 'card-note', text: 'No peers found in this category.' }));

    /* Verification links: point at AMFI itself, never at a fabricated deep link. */
    var verify = document.getElementById('verify');
    ui.clear(verify);
    verify.appendChild(el('ul', { class: 'kv' }, [
      el('li', null, [el('span', { class: 'k', text: 'Source file' }), el('span', { class: 'v', text: funds.meta().source })]),
      el('li', null, [el('span', { class: 'k', text: 'Snapshot taken' }), el('span', { class: 'v', text: funds.meta().fetchedAt })]),
      el('li', null, [el('span', { class: 'k', text: 'Verify at AMFI' }), el('span', { class: 'v' },
        [el('a', { href: 'https://www.amfiindia.com/net-asset-value', target: '_blank', rel: 'noopener', text: 'amfiindia.com → NAV search' })])]),
      el('li', null, [el('span', { class: 'k', text: 'Fund house' }), el('span', { class: 'v', text: scheme.amc })])
    ]));
  }

  ui.ready(boot);
})(window);
