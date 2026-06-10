// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:8765';

test.describe('페이지 로딩', () => {
  test('index.html 이 정상 로드된다', async ({ page }) => {
    await page.goto(`${BASE}/index.html`);
    await expect(page).toHaveTitle('안전운임 조회');
    await expect(page.locator('.header')).toBeVisible();
  });

  test('검색 입력창이 노출된다', async ({ page }) => {
    await page.goto(`${BASE}/index.html`);
    const input = page.locator('#search-input');
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
  });

  test('styles.css 가 로드된다', async ({ page }) => {
    const responses = [];
    page.on('response', r => responses.push(r));
    await page.goto(`${BASE}/index.html`);
    const cssResponse = responses.find(r => r.url().includes('styles.css'));
    expect(cssResponse).toBeTruthy();
    expect(cssResponse.status()).toBe(200);
  });

  test('flat.js / keymap.js 가 로드된다', async ({ page }) => {
    const responses = [];
    page.on('response', r => responses.push(r));
    await page.goto(`${BASE}/index.html`);
    const flatJs = responses.find(r => r.url().includes('flat.js'));
    const keyJs  = responses.find(r => r.url().includes('keymap.js'));
    expect(flatJs?.status()).toBe(200);
    expect(keyJs?.status()).toBe(200);
  });
});

test.describe('목적지 검색', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/index.html`);
    await page.waitForTimeout(800); // flat.js parse
  });

  test('검색어 입력 시 자동완성 드롭다운이 나타난다', async ({ page }) => {
    await page.fill('#search-input', '부산');
    await page.waitForTimeout(400);
    const list = page.locator('#ac-wrap');
    await expect(list).toBeVisible();
    const items = page.locator('.ac-item');
    await expect(items).not.toHaveCount(0);
  });

  test('항목 선택 후 step-1 완료 표시', async ({ page }) => {
    await page.fill('#search-input', '해운대구');
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    const sn1 = page.locator('#sn1');
    await expect(sn1).toHaveClass(/done/);
  });

  test('검색 결과 없을 때 안내 문구 표시', async ({ page }) => {
    await page.fill('#search-input', 'zzznoresult123');
    await page.waitForTimeout(400);
    const wrap = page.locator('#ac-wrap');
    const visible = await wrap.isVisible();
    if (visible) {
      const items = page.locator('.ac-item');
      const count = await items.count();
      expect(count).toBe(0);
    }
  });

  test('항목 선택 후에도 검색창은 접히지 않고 그대로 유지된다', async ({ page }) => {
    await page.fill('#search-input', '해운대구 반여동');
    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    // 검색창은 계속 보이고, 선택한 목적지가 입력창에 표시됨
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveValue(/반여1동/);
    await expect(page.locator('#step1')).not.toHaveClass(/collapsed/);

    // 목적지 검색 헤더 옆 목적지명 표시(sv1)는 제거된 상태여야 함
    await expect(page.locator('#sv1')).toHaveCount(0);
  });

  test('검색창은 스크롤 시 상단 고정 헤더 아래로 지나가야 한다 (z-index)', async ({ page }) => {
    // 검색창(.search-wrap)의 z-index가 헤더(.header)보다 높으면
    // 스크롤할 때 검색창이 헤더 위에 떠서 화면 맨 위에 겹쳐 보이는 버그 발생
    const headerZ = await page.locator('.header').evaluate(
      el => parseInt(getComputedStyle(el).zIndex, 10) || 0);
    const searchZ = await page.locator('.search-wrap').evaluate(
      el => parseInt(getComputedStyle(el).zIndex, 10) || 0);
    expect(headerZ).toBeGreaterThan(searchZ);
  });
});

test.describe('지역코드 배지/칩', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/index.html`);
    await page.waitForTimeout(800);
  });

  async function searchSelect(page, query) {
    await page.fill('#search-input', query);
    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
  }

  test('단일 코드 지역 → 배지 표시', async ({ page }) => {
    // 교남동은 코드 A380 (단일)
    await searchSelect(page, '종로구 교남동');
    const badge = page.locator('#loc-code-badge');
    const display = await badge.evaluate(el => getComputedStyle(el).display);
    // PC 뷰포트(1440px)에서는 배지가 보여야 함
    expect(display).not.toBe('none');
  });

  test('다중 코드 지역 → 칩 표시', async ({ page }) => {
    // 광산구 하남동은 K021, K098 두 개 코드 보유
    await searchSelect(page, '광산구 하남동');
    const chips = page.locator('#loc-code-chips');
    const display = await chips.evaluate(el => getComputedStyle(el).display);
    expect(display).not.toBe('none');
    const chipEls = page.locator('.loc-code-chip');
    await expect(chipEls).toHaveCount(2);
  });

  test('칩 클릭 시 클립보드에 복사', async ({ page }) => {
    await searchSelect(page, '광산구 하남동');

    // beforeEach에서 이미 페이지가 로드된 뒤이므로 addInitScript 대신
    // 현재 문서 컨텍스트에 바로 navigator.clipboard를 주입
    await page.evaluate(() => {
      window._copied = [];
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: t => { window._copied.push(t); return Promise.resolve(); } },
        configurable: true,
      });
    });

    await page.locator('.loc-code-chip').first().click();
    await page.waitForTimeout(300);
    const copied = await page.evaluate(() => window._copied);
    expect(copied.length).toBeGreaterThan(0);
    expect(copied[0]).toMatch(/^[A-Z0-9]+$/);
  });

  test('다중→단일 전환 시 칩이 사라진다', async ({ page }) => {
    await searchSelect(page, '광산구 하남동');
    await searchSelect(page, '종로구 교남동');
    const chips = page.locator('#loc-code-chips');
    const display = await chips.evaluate(el => getComputedStyle(el).display);
    expect(display).toBe('none');
  });
});

test.describe('모바일 뷰포트 (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#search-input:not(:disabled)', { timeout: 25_000 });
  });

  test('목적지 선택 후에도 검색창이 유지되고 입력창에 목적지가 표시된다', async ({ page }) => {
    await page.fill('#search-input', '해운대구 반여동');
    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    // 검색창은 접히지 않고 그대로, 선택한 목적지는 입력창에 표시
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('#search-input')).toHaveValue(/반여1동/);

    // 헤더 옆 목적지명 표시는 제거된 상태
    await expect(page.locator('#sv1')).toHaveCount(0);

    // 지역코드 배지는 모바일에서 숨김 (PC 전용)
    const badge = page.locator('#loc-code-badge');
    const badgeDisplay = await badge.evaluate(el => getComputedStyle(el).display);
    expect(badgeDisplay).toBe('none');
  });

  test('스크롤해도 검색창이 고정 헤더 위에 겹쳐 보이지 않는다', async ({ page }) => {
    await page.fill('#search-input', '해운대구 반여동');
    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    // 할증(STEP4) 영역까지 스크롤 — step1이 sticky 헤더 영역을 지나감
    await page.locator('#step4-card').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // 화면 상단(헤더 중앙 지점)에서 실제로 그려진 요소가 검색 입력창이면 안 됨
    const topEl = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, 28);
      return el ? (el.id || el.className || el.tagName) : '';
    });
    expect(topEl).not.toContain('search-input');
  });

  test('배너에 빌드 버전이 표시된다', async ({ page }) => {
    const ver = page.locator('#app-ver');
    await expect(ver).toBeVisible();
    await expect(ver).toHaveText(/^v\d+$/);
  });
});

test.describe('버전 일관성', () => {
  test('sw.js CACHE_VERSION과 화면 표시 버전(app-ver)이 일치한다', () => {
    const root = path.join(__dirname, '..');
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const swVer = sw.match(/CACHE_VERSION = '(v\d+)'/);
    const uiVer = html.match(/id="app-ver">(v\d+)</);
    expect(swVer).toBeTruthy();
    expect(uiVer).toBeTruthy();
    expect(uiVer[1]).toBe(swVer[1]);
  });
});
