import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export interface BrowserConnection {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function connectBrowser(port: number): Promise<BrowserConnection> {
  let browser: Browser;

  try {
    browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to connect to Chrome via CDP on port ${port}: ${message}\n\n` +
      `Make sure Chrome is running with remote debugging enabled:\n` +
      `  macOS:  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=${port}\n` +
      `  Linux:  google-chrome --remote-debugging-port=${port}\n` +
      `  Windows: chrome.exe --remote-debugging-port=${port}\n\n` +
      `You must be logged in to Baekjoon (acmicpc.net) in that Chrome instance.`
    );
  }

  const contexts = browser.contexts();
  const context = contexts[0];

  if (!context) {
    await browser.close();
    throw new Error(
      'No browser context found. Make sure Chrome has at least one window open.'
    );
  }

  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();

  return { browser, context, page };
}

export async function disconnectBrowser(browser: Browser): Promise<void> {
  await browser.close();
}
