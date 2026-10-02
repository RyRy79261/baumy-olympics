import type { CreateIssueResult, NewIssue } from "./github";

// The E2E stand-in for GitHub Issues (issue #133): reports filed under
// E2E_TEST_MODE=1 land here, numbered from 1, and GET /api/test/github reads
// them back, so a spec can check what WOULD have been published (that the
// email it typed is not in the body). Per server process, on globalThis so
// every route bundle shares one list.

const KEY = Symbol.for("baumy.github.issues");
type Store = typeof globalThis & { [KEY]?: (NewIssue & { number: number })[] };

function issues(): (NewIssue & { number: number })[] {
  const g = globalThis as Store;
  return (g[KEY] ??= []);
}

export async function memoryGithub(
  issue: NewIssue,
): Promise<CreateIssueResult> {
  const list = issues();
  const number = list.length + 1;
  list.push({ ...issue, number });
  return {
    ok: true,
    number,
    url: `https://github.com/e2e/fake-tracker/issues/${number}`,
  };
}

/** Every issue filed so far, oldest first. */
export function memoryIssues(): readonly (NewIssue & { number: number })[] {
  return issues();
}

export function clearMemoryIssues(): void {
  issues().length = 0;
}
