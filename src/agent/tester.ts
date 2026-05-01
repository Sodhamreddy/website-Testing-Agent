import type { TestIssue, TestResult, ChecklistStatus } from '../types';

type LogType = 'info' | 'success' | 'warning' | 'error';
type LogCallback = (msg: string, type?: LogType) => void;
type ProgressCallback = (pct: number) => void;

export class TestingAgent {
  private url: string;
  private onLog: LogCallback;
  private onProgress: ProgressCallback;
  public checklistStatus: ChecklistStatus = {};
  public foundData: { title?: string; h1?: string; description?: string } = {};

  constructor(url: string, onLog: LogCallback, onProgress: ProgressCallback) {
    this.url = url;
    this.onLog = onLog;
    this.onProgress = onProgress;
  }

  async runFullAudit(): Promise<{
    issues: TestIssue[];
    result: TestResult | null;
    checklistStatus: ChecklistStatus;
  }> {
    return new Promise((resolve, reject) => {
      const sse = new EventSource(`/api/audit/stream?url=${encodeURIComponent(this.url)}`);

      sse.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        switch (msg.type) {
          case 'log':
            this.onLog(msg.msg as string, msg.logType as LogType);
            break;
          case 'progress':
            this.onProgress(msg.pct as number);
            break;
          case 'complete':
            sse.close();
            this.checklistStatus = msg.checklistStatus as ChecklistStatus;
            this.foundData = (msg.result as TestResult)?.foundData ?? {};
            resolve({
              issues: msg.issues as TestIssue[],
              result: msg.result as TestResult | null,
              checklistStatus: msg.checklistStatus as ChecklistStatus,
            });
            break;
          case 'error':
            sse.close();
            reject(new Error(msg.msg as string));
            break;
        }
      };

      sse.onerror = () => {
        sse.close();
        reject(
          new Error(
            'Lost connection to audit server. Make sure the backend is running: npm run server',
          ),
        );
      };
    });
  }
}
