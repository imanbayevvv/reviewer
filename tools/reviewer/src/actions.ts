/**
 * UI Action Sequence Executor for Playwright.
 *
 * Executes a series of actions (click, fill, wait, press) on a page
 * before taking a snapshot. Used for screens that require UI interaction
 * to reach the desired state (e.g., clicking a tab, submitting a form).
 */
import type { Page } from '@playwright/test';

export interface ActionStep {
  action: 'click' | 'fill' | 'wait' | 'press';
  selector?: string;
  value?: string;
  key?: string;
  timeout?: number;
}

const DEFAULT_ACTION_TIMEOUT = 5000;

export async function executeActions(
  page: Page,
  actions: ActionStep[],
): Promise<void> {
  for (const step of actions) {
    const timeout = step.timeout ?? DEFAULT_ACTION_TIMEOUT;

    switch (step.action) {
      case 'click': {
        if (!step.selector) throw new Error('click action requires selector');
        await page.locator(step.selector).click({ timeout });
        break;
      }
      case 'fill': {
        if (!step.selector) throw new Error('fill action requires selector');
        await page.locator(step.selector).fill(step.value ?? '', { timeout });
        break;
      }
      case 'wait': {
        if (step.selector) {
          await page.locator(step.selector).waitFor({ state: 'visible', timeout });
        } else if (step.timeout) {
          await page.waitForTimeout(step.timeout);
        }
        break;
      }
      case 'press': {
        const key = step.key ?? step.value ?? 'Enter';
        if (step.selector) {
          await page.locator(step.selector).press(key, { timeout });
        } else {
          await page.keyboard.press(key);
        }
        break;
      }
    }
  }
}
