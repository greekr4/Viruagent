const { chromium } = require('playwright');
const readline = require('readline');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://tkman.tistory.com/manage/newpost');

  console.log('\n========================================');
  console.log('브라우저에서 로그인을 완료하세요.');
  console.log('로그인 후 여기서 Enter를 누르면 세션이 저장됩니다.');
  console.log('========================================\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('', resolve));
  rl.close();

  await context.storageState({ path: './session.json' });
  console.log('세션이 session.json에 저장되었습니다!');

  await browser.close();
})();
