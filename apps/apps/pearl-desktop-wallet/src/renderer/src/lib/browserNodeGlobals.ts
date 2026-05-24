type BufferConstructor = typeof import('buffer').Buffer;

type BrowserProcessShim = {
  browser: true;
  env: Record<string, string | undefined>;
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void;
  platform: 'browser';
  version: string;
  versions: Record<string, string | undefined>;
  cwd: () => string;
  emit: () => false;
  stdout: undefined;
  stderr: undefined;
};

type BrowserGlobal = {
  Buffer?: BufferConstructor;
  process?: BrowserProcessShim;
};

export function installBrowserNodeProcess(): void {
  const browserGlobal = globalThis as unknown as BrowserGlobal;

  browserGlobal.process ??= {
    browser: true,
    env: {},
    nextTick(callback, ...args) {
      queueMicrotask(() => callback(...args));
    },
    platform: 'browser',
    version: '',
    versions: {},
    cwd: () => '/',
    emit: () => false,
    stdout: undefined,
    stderr: undefined,
  };
}

export async function installBrowserNodeGlobals(): Promise<BufferConstructor> {
  installBrowserNodeProcess();
  const { Buffer } = await import('buffer');
  (globalThis as unknown as BrowserGlobal).Buffer ??= Buffer;
  return Buffer;
}
