// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:8765';

async function selectDestination(page, query) {
  await page.fill('#search-input', query);
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}

test.describe('운임 조회 플로우', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/index.html`);
    // notices.json + tariff chunk 로드 대기
    await page.waitForSelector('#search-input:not(:disabled)', { timeout: 25_000 });
  });

  test('운송 유형 버튼 클릭 시 활성화', async ({ page }) => {
    await selectDestination(page, '해운대구 반여동');

    // STEP 2 토글 버튼 첫 번째 클릭
    const togBtns = page.locator('#step2-card .tog-btn');
    await expect(togBtns.first()).toBeVisible();
    await togBtns.first().click();
    await expect(togBtns.first()).toHaveClass(/active/);
  });

  test('STEP 2 선택 후 STEP 3 운임 유형 표시', async ({ page }) => {
    await selectDestination(page, '해운대구 반여동');

    const togBtns = page.locator('#step2-card .tog-btn');
    await togBtns.first().click();
    await page.waitForTimeout(200);

    const step3 = page.locator('#step3-card');
    await expect(step3).toBeVisible();
  });

  test('운임 유형 선택 후 기점 탭 표시', async ({ page }) => {
    await selectDestination(page, '해운대구 반여동');

    await page.locator('#step2-card .tog-btn').first().click();
    await page.waitForTimeout(200);

    // 위탁 버튼 클릭
    const fareTypeBtns = page.locator('#step3-card .tog-btn');
    await fareTypeBtns.first().click();
    await page.waitForTimeout(200);

    // 기점 탭 표시
    const portTabs = page.locator('.port-tabs');
    await expect(portTabs).toBeVisible();
    const ptab = page.locator('.ptab').first();
    await expect(ptab).toBeVisible();
  });

  test('기점 선택 후 운임 결과 표시', async ({ page }) => {
    await selectDestination(page, '해운대구 반여동');

    await page.locator('#step2-card .tog-btn').first().click();
    await page.waitForTimeout(200);
    await page.locator('#step3-card .tog-btn').first().click();
    await page.waitForTimeout(300);

    // 기점 탭에서 첫 번째 클릭
    const firstPort = page.locator('.ptab').first();
    await firstPort.click();
    await page.waitForTimeout(500);

    // 운임 결과 표시
    const result = page.locator('#result');
    await expect(result).toBeVisible();

    // 운임 카드 확인
    const fareCards = page.locator('.fare-card');
    await expect(fareCards).not.toHaveCount(0);
  });

  test('결과에 금액이 숫자로 표시된다', async ({ page }) => {
    await selectDestination(page, '해운대구 반여동');

    await page.locator('#step2-card .tog-btn').first().click();
    await page.waitForTimeout(200);
    await page.locator('#step3-card .tog-btn').first().click();
    await page.waitForTimeout(300);

    await page.locator('.ptab').first().click();
    await page.waitForTimeout(500);

    const fareValues = page.locator('.fv');
    const count = await fareValues.count();
    expect(count).toBeGreaterThan(0);

    // 첫 번째 금액이 '원' 단위를 포함하는지 확인
    const firstVal = await fareValues.first().textContent();
    expect(firstVal).toMatch(/원/);
  });

  test('공유 버튼 클릭 시 공유 또는 클립보드 복사', async ({ page }) => {
    await selectDestination(page, '해운대구 반여동');

    await page.locator('#step2-card .tog-btn').first().click();
    await page.waitForTimeout(200);
    await page.locator('#step3-card .tog-btn').first().click();
    await page.waitForTimeout(300);
    await page.locator('.ptab').first().click();
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      window._shared = [];
      window._copied = [];
      Object.defineProperty(navigator, 'share', {
        value: data => { window._shared.push(data); return Promise.resolve(); },
        configurable: true,
      });
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: t => { window._copied.push(t); return Promise.resolve(); } },
        configurable: true,
      });
    });

    await page.locator('#share-result-btn').click();
    await page.waitForTimeout(300);
    const shared = await page.evaluate(() => window._shared);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared[0].text).toContain('반여1동');
  });
});

test.describe('할증 기능', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#search-input:not(:disabled)', { timeout: 25_000 });
    // 기본 운임 조회 흐름 완료
    await page.fill('#search-input', '해운대구 반여동');
    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await page.locator('#step2-card .tog-btn').first().click();
    await page.waitForTimeout(200);
    await page.locator('#step3-card .tog-btn').first().click();
    await page.waitForTimeout(300);
    await page.locator('.ptab').first().click();
    await page.waitForTimeout(500);
  });

  test('할증 항목 체크 시 checked 클래스 적용', async ({ page }) => {
    const surItem = page.locator('.sur-item').first();
    await surItem.click();
    await expect(surItem).toHaveClass(/checked/);
  });

  test('할증 항목 재클릭 시 체크 해제', async ({ page }) => {
    const surItem = page.locator('.sur-item').first();
    await surItem.click();
    await surItem.click();
    const classes = await surItem.getAttribute('class');
    expect(classes).not.toMatch(/checked/);
  });
});

test.describe('문의하기 견적 반영', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#search-input:not(:disabled)', { timeout: 25_000 });
  });

  test('조회 전에는 문의하기에 견적 카드가 보이지 않는다', async ({ page }) => {
    await page.locator('#contact-fab').click();
    await expect(page.locator('#contact-modal')).toHaveClass(/open/);
    await expect(page.locator('#quote-card')).not.toHaveClass(/show/);
  });

  test('조회 완료 후 문의하기에 견적 요약이 표시된다', async ({ page }) => {
    await selectDestination(page, '해운대구 반여동');
    await page.locator('#step2-card .tog-btn').first().click();
    await page.waitForTimeout(200);
    await page.locator('#step3-card .tog-btn').first().click();
    await page.waitForTimeout(300);
    await page.locator('.ptab').first().click();
    await page.waitForTimeout(500);

    await page.locator('#contact-fab').click();
    const quoteCard = page.locator('#quote-card');
    await expect(quoteCard).toHaveClass(/show/);

    const summary = await page.locator('#quote-card-body').textContent();
    expect(summary).toContain('반여1동');
    expect(summary).toMatch(/40FT:.*원/);
    expect(summary).toMatch(/20FT:.*원/);
    expect(summary).toContain('할증: 없음');

    // 기본값: 포함 체크박스 ON
    await expect(page.locator('#quote-include')).toBeChecked();
  });

  test('견적 포함 체크 해제 시 미리보기가 흐려진다', async ({ page }) => {
    await selectDestination(page, '해운대구 반여동');
    await page.locator('#step2-card .tog-btn').first().click();
    await page.waitForTimeout(200);
    await page.locator('#step3-card .tog-btn').first().click();
    await page.waitForTimeout(300);
    await page.locator('.ptab').first().click();
    await page.waitForTimeout(500);

    await page.locator('#contact-fab').click();
    await page.locator('#quote-include').uncheck();
    await expect(page.locator('#quote-card-body')).toHaveClass(/dim/);
  });

  test('견적 복사 버튼 클릭 시 클립보드에 복사', async ({ page }) => {
    await selectDestination(page, '해운대구 반여동');
    await page.locator('#step2-card .tog-btn').first().click();
    await page.waitForTimeout(200);
    await page.locator('#step3-card .tog-btn').first().click();
    await page.waitForTimeout(300);
    await page.locator('.ptab').first().click();
    await page.waitForTimeout(500);

    await page.locator('#contact-fab').click();

    await page.evaluate(() => {
      window._copied = [];
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: t => { window._copied.push(t); return Promise.resolve(); } },
        configurable: true,
      });
    });

    await page.locator('#quote-copy-btn').click();
    await page.waitForTimeout(300);
    const copied = await page.evaluate(() => window._copied);
    expect(copied.length).toBeGreaterThan(0);
    expect(copied[0]).toContain('반여1동');
  });
});
