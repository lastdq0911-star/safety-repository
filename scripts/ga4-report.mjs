#!/usr/bin/env node
'use strict';

// GA4 사용 현황 리포트
//
// 사전 준비:
//   1. GCP에서 서비스 계정을 만들고 JSON 키를 발급받는다.
//   2. GA4 관리 > 속성 액세스 관리에서 해당 서비스 계정 이메일을
//      "뷰어" 권한으로 추가한다.
//   3. 환경변수 설정 후 실행:
//        GA4_PROPERTY_ID=xxxxxxxxx \
//        GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
//        node scripts/ga4-report.mjs [days]
//
//   days(선택, 기본 7) = 조회할 최근 일수

import { BetaAnalyticsDataClient } from '@google-analytics/data';

const propertyId = process.env.GA4_PROPERTY_ID;
if (!propertyId) {
  console.error('환경변수 GA4_PROPERTY_ID 가 설정되지 않았습니다.');
  process.exit(1);
}

const days = process.argv[2] ? Number(process.argv[2]) : 7;
const dateRanges = [{ startDate: `${days}daysAgo`, endDate: 'today' }];

const client = new BetaAnalyticsDataClient();

// 해외(주로 US, Direct·Chrome/Windows·세션당 1페이지뷰)는 대부분 봇 트래픽이라
// 실 사용자 분석을 왜곡하므로 국내(South Korea) 트래픽만 집계한다.
const KR_FILTER = { filter: { fieldName: 'country', stringFilter: { value: 'South Korea' } } };

function printRows(title, response) {
  console.log(`\n## ${title}`);
  const dimHeaders = (response.dimensionHeaders || []).map((h) => h.name);
  const metHeaders = (response.metricHeaders || []).map((h) => h.name);
  console.log([...dimHeaders, ...metHeaders].join(' | '));
  if (!response.rows || !response.rows.length) {
    console.log('(데이터 없음)');
    return;
  }
  for (const row of response.rows) {
    const dims = (row.dimensionValues || []).map((v) => v.value);
    const mets = (row.metricValues || []).map((v) => v.value);
    console.log([...dims, ...mets].join(' | '));
  }
}

async function runReport({ dimensionFilter, ...request }) {
  const mergedFilter = dimensionFilter
    ? { andGroup: { expressions: [KR_FILTER, dimensionFilter] } }
    : KR_FILTER;

  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dimensionFilter: mergedFilter,
    ...request,
  });
  return response;
}

async function main() {
  console.log(`==== 안전운임 조회 GA4 리포트 (최근 ${days}일, 국내 기준) ====`);

  printRows(
    '전체 요약',
    await runReport({
      dateRanges,
      metrics: [
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
      ],
    })
  );

  printRows(
    '이벤트별 발생 횟수',
    await runReport({
      dateRanges,
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    })
  );

  printRows(
    '인기 검색 목적지 TOP 15',
    await runReport({
      dateRanges,
      dimensions: [{ name: 'customEvent:destination' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { value: 'search_destination' } },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 15,
    })
  );

  printRows(
    '운임 유형 선호도 (안전위탁/사업자간/안전운송)',
    await runReport({
      dateRanges,
      dimensions: [{ name: 'customEvent:fare_type' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { value: 'select_fare_type' } },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    })
  );

  printRows(
    '왕복/편도 선호도',
    await runReport({
      dateRanges,
      dimensions: [{ name: 'customEvent:transport_type' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { value: 'select_transport_type' } },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    })
  );

  printRows(
    '검색 결과 없음 (개선 필요 키워드)',
    await runReport({
      dateRanges,
      dimensions: [{ name: 'customEvent:search_query' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { value: 'search_no_result' } },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 20,
    })
  );

  printRows(
    '디바이스 분포',
    await runReport({
      dateRanges,
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    })
  );
}

main().catch((err) => {
  console.error('리포트 조회 실패:', err.message);
  process.exit(1);
});
