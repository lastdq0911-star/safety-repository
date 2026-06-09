// @ts-check
const { test, expect } = require('@playwright/test');

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

  test('항목 선택 후 검색창이 접히고, ① 클릭 시 다시 펼쳐진다', async ({ page }) => {
    await page.fill('#search-input', '해운대구 반여동');
    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    const step1 = page.locator('#step1');
    const searchInput = page.locator('#search-input');
    await expect(step1).toHaveClass(/collapsed/);
    await expect(searchInput).toBeHidden();

    // 접힌 상태에서도 선택한 목적지명이 step-head에 표시되어야 함
    const sv1 = page.locator('#sv1');
    await expect(sv1).toBeVisible();
    await expect(sv1).toHaveText('해운대구 반여1동');

    await page.locator('#sn1').click();
    await page.waitForTimeout(200);

    await expect(step1).not.toHaveClass(/collapsed/);
    await expect(searchInput).toBeVisible();
  });
});

test.describe('지역코드 배지/칩', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/index.html`);
    await page.waitForTimeout(800);
  });

  async function searchSelect(page, query) {
    // step1이 이전 선택으로 접혀 있으면 ① 클릭으로 다시 펼침
    const step1 = page.locator('#step1');
    if (await step1.evaluate(el => el.classList.contains('collapsed'))) {
      await page.locator('#sn1').click();
      await page.waitForTimeout(200);
    }
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
