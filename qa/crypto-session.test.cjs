const test=require('node:test'),assert=require('node:assert/strict'),D=require('../assets/js/crypto-desk-engine.js');
test('expiry payoff cannot rescue an unprofitable session target',()=>{const e=D.sessionEconomics(100,10000,61,95);assert.equal(e.eligible,false);assert.match(e.reason,/fees/)});
test('spread already beyond its stop is rejected',()=>{assert.equal(D.sessionEconomics(100,400,1,49).eligible,false)});
test('net reward must cover modeled net stop loss',()=>{assert.equal(D.sessionEconomics(100,400,6,95).eligible,false);const e=D.sessionEconomics(100,400,2,95);assert.ok(e.eligible);assert.equal(e.netReward,58);assert.equal(e.netLoss,52);assert.equal(e.rr,58/52)});
test('more distant expiry maximum does not improve unchanged session ranking',()=>{assert.equal(D.sessionEconomics(100,400,2,95).rr,D.sessionEconomics(100,4000,2,95).rr)});
