'use strict';
/*
 * 하불대사 3원 대사 엔진 — PoC (Proof of Concept)
 *  ① 안전운임(앱의 실제 데이터·계산로직 재사용) — 법적 하한
 *  ② 당사 내역(세방 인정: 운임+합의 추가비용)   — 샘플
 *  ③ 협력사 명세서(청구액)                       — 샘플
 *  → 항목·총액 3원 대조 후 과오/미달/근거없는청구 자동 적발
 *
 *  주의: ②③는 실제론 사내 시스템/문서추출로 들어옴. PoC라 샘플로 시연.
 *        ①은 실제 고시 운임 데이터(2022-07)로 계산.
 */
const fs = require('fs');
const path = require('path');

// ── 1. 실제 운임 데이터 로드 (window.TARIFF_CHUNKn = {...};) ──
const TARIFF = {};
const NOTICE_DIR = path.join(__dirname, '..', '2022-07');
for (const f of fs.readdirSync(NOTICE_DIR).filter(f => /^data\d+\.js$/.test(f))) {
  let t = fs.readFileSync(path.join(NOTICE_DIR, f), 'utf8');
  t = t.slice(t.indexOf('=') + 1).trim();
  if (t.endsWith(';')) t = t.slice(0, -1);
  Object.assign(TARIFF, JSON.parse(t));
}

// ── 2. 앱과 동일한 계산 로직 (index.html 그대로) ──
function calcMulti(arr) {
  const s = arr.slice().sort((a, b) => b - a);
  if (!s.length) return 0;
  return s.slice(0, 3).reduce((acc, val, i) => acc + (i === 0 ? val : val * 0.5), 0);
}
function applySur(val, rate, fixedTotal) {
  return Math.round(val * (1 + rate / 100) / 100) * 100 + fixedTotal;
}
const SUR_RATE = { 냉동냉장:30, 탱크:30, 위험물:30, 덤프:25, 공휴일:20, 심야:20,
  험로오지:20, 플렉시액체:20, 플렉시분말:10, 통행제한:30, 화약:100, 방사성:200, '45ft':12.5 };
const FARE_IDX = { 위탁:0, 사업자:1, 운송:2 };
const FARE_LABEL = { 위탁:'안전위탁운임', 사업자:'운수사업자간', 운송:'안전운송운임' };

// 안전운임(기본+% 할증) = 법적 하한. 정액할증(xray 등)은 PoC 단순화 위해 제외.
function safeRate(dest, port, size, fareType, surKeys) {
  const entry = TARIFF[dest];
  if (!entry) throw new Error('목적지 데이터 없음: ' + dest);
  const pd = entry[port];
  if (!pd) throw new Error('기점(항구) 데이터 없음: ' + port);
  const base = (size === 40 ? pd.f40 : pd.f20)[FARE_IDX[fareType]];
  const pct = (surKeys || []).map(k => SUR_RATE[k]).filter(r => r != null);
  const rate = calcMulti(pct);
  return { base, dist: pd.dist, total: applySur(base, rate, 0), surRate: rate };
}

// ── 3. 3원 대사 엔진 ──
const won = n => Number(n).toLocaleString('ko-KR') + '원';
function reconcile(c) {
  const sr = safeRate(c.dest, c.port, c.size, c.fareType, c.surcharges);
  const flags = [];
  const lines = [];

  // (1) 운임(기본+할증): 안전운임(하한) vs 당사 vs 협력사
  const 안전 = sr.total, 당사운임 = c.당사.운임, 협력운임 = c.협력사.운임;
  let 운임판정 = '일치';
  if (당사운임 < 안전) { 운임판정 = '⛔ 안전운임 미달(법적 위반 위험)'; flags.push('안전운임미달'); }
  if (협력운임 !== 당사운임) {
    const d = 협력운임 - 당사운임;
    운임판정 = (d > 0 ? '⚠️ 협력사 과다청구 ' : '⚠️ 협력사 과소청구 ') + won(Math.abs(d));
    flags.push(d > 0 ? '운임과다' : '운임과소');
  }
  lines.push({ 항목:'운임(기본+할증)', 안전운임:안전, 당사:당사운임, 협력사:협력운임, 판정:운임판정 });

  // (2) 추가비용: 명목별 당사 vs 협력사 (안전운임 계산 대상 아님)
  const names = new Set([...c.당사.추가비용.map(x=>x.명목), ...c.협력사.추가비용.map(x=>x.명목)]);
  for (const nm of names) {
    const a = (c.당사.추가비용.find(x=>x.명목===nm)   || {}).금액;
    const b = (c.협력사.추가비용.find(x=>x.명목===nm) || {}).금액;
    let 판정 = '일치';
    if (a == null) { 판정 = '⚠️ 당사 내역에 없음(근거 확인 필요)'; flags.push('근거없는청구'); }
    else if (b == null) { 판정 = '⚠️ 협력사 명세서에 누락'; flags.push('항목누락'); }
    else if (a !== b) { const d=b-a; 판정 = (d>0?'⚠️ 과다 ':'⚠️ 과소 ')+won(Math.abs(d)); flags.push('추가비과오'); }
    lines.push({ 항목:'추가비용·'+nm, 안전운임:'-', 당사:a==null?'-':a, 협력사:b==null?'-':b, 판정 });
  }

  // (3) 총액
  const 당사합 = 당사운임 + c.당사.추가비용.reduce((s,x)=>s+x.금액,0);
  const 협력합 = 협력운임 + c.협력사.추가비용.reduce((s,x)=>s+x.금액,0);
  lines.push({ 항목:'■ 총액', 안전운임:안전, 당사:당사합, 협력사:협력합,
    판정: 협력합===당사합 ? '일치' : (협력합>당사합?'⚠️ 협력사 과다 ':'⚠️ 협력사 과소 ')+won(Math.abs(협력합-당사합)) });

  return { sr, lines, flags: [...new Set(flags)], 당사합, 협력합 };
}

// ── 4. 샘플 운송 건 (실제 목적지/항구, ②③는 가상) ──
function mk(dest, port, size, fareType, surcharges, 당사, 협력사) {
  return { dest, port, size, fareType, surcharges: surcharges||[], 당사, 협력사 };
}
const sr1 = safeRate('경기도_안성시_보개면', '부산신항', 40, '위탁', []);
const sr2 = safeRate('경기도_안성시_보개면', '부산북항', 40, '위탁', ['냉동냉장']);
const sr3 = safeRate('경기도_안성시_보개면', '평택항', 20, '위탁', []);

const CASES = [
  // 정상: 모두 일치
  mk('경기도_안성시_보개면','부산신항',40,'위탁',[],
     { 운임: sr1.total, 추가비용:[{명목:'대기료', 금액:30000}] },
     { 운임: sr1.total, 추가비용:[{명목:'대기료', 금액:30000}] }),
  // 협력사 대기료 과다청구
  mk('경기도_안성시_보개면','부산북항',40,'위탁',['냉동냉장'],
     { 운임: sr2.total, 추가비용:[{명목:'대기료', 금액:30000}] },
     { 운임: sr2.total, 추가비용:[{명목:'대기료', 금액:50000}] }),
  // 당사 운임이 안전운임 미달(법 위반 위험) + 협력사는 안전운임대로 청구
  mk('경기도_안성시_보개면','평택항',20,'위탁',[],
     { 운임: sr3.total - 50000, 추가비용:[] },
     { 운임: sr3.total, 추가비용:[] }),
  // 근거없는 추가청구(셔틀비) — 당사 내역에 없음
  mk('경기도_안성시_보개면','부산신항',40,'위탁',[],
     { 운임: sr1.total, 추가비용:[{명목:'대기료', 금액:20000}] },
     { 운임: sr1.total, 추가비용:[{명목:'대기료', 금액:20000},{명목:'셔틀비', 금액:40000}] }),
];

// ── 5. 리포트 출력 ──
console.log('═'.repeat(70));
console.log(' 하불대사 3원 대사 — PoC 시연 (고시: 2022-07, 실제 운임 데이터)');
console.log('═'.repeat(70));
let 적발 = 0;
CASES.forEach((c, i) => {
  const r = reconcile(c);
  console.log(`\n[건 ${i+1}] ${c.dest.replace(/_/g,' ')} ← ${c.port} | ${c.size}FT | ${FARE_LABEL[c.fareType]}`
    + (c.surcharges.length?` | 할증:${c.surcharges.join(',')}`:'') + ` | 거리 ${r.sr.dist}km`);
  console.log(`  · 안전운임(계산 하한): ${won(r.sr.total)}` + (r.sr.surRate?` (할증 ${r.sr.surRate}% 포함)`:''));
  console.log('  ' + '─'.repeat(66));
  console.log('  ' + '항목'.padEnd(16) + '안전운임'.padStart(12) + '당사내역'.padStart(12) + '협력사청구'.padStart(12) + '  판정');
  r.lines.forEach(l => {
    const f = v => (v==='-'?'-':won(v));
    console.log('  ' + String(l.항목).padEnd(16)
      + f(l.안전운임).padStart(12) + f(l.당사).padStart(12) + f(l.협력사).padStart(12) + '  ' + l.판정);
  });
  if (r.flags.length) { 적발++; console.log('  ▶ 적발: ' + r.flags.join(', ')); }
  else console.log('  ▶ 이상 없음 ✅');
});
console.log('\n' + '═'.repeat(70));
console.log(` 결과: 총 ${CASES.length}건 중 ${적발}건에서 이상 적발`);
console.log('═'.repeat(70));
