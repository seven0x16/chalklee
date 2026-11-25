import type { Worker } from "node:worker_threads";
import type { QuestionBankChange } from "../../shared/questionBank/search";
import type { QuestionBankArguments, QuestionBankMethod, QuestionBankReply, QuestionBankWorkerMessage } from "./workerProtocol";

/** The window and both AI surfaces share this asynchronous connection to the same index. */
export class QuestionBankService {
  private nextId = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  private failure?: Error;
  private disposed = false;
  private closing?: Promise<void>;
  private worker?: Worker;

  constructor(private readonly createWorker: () => Worker, private readonly changed: (change: QuestionBankChange) => void) {}

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.worker = this.createWorker();
    worker.on("message", (message: QuestionBankWorkerMessage) => {
      if ("change" in message) { this.changed(message.change); return; }
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error !== undefined) pending?.reject(new Error(message.error));
      else pending?.resolve(message.result);
    });
    worker.on("error", error => this.fail(error));
    worker.on("exit", code => { if (!this.disposed) this.fail(new Error(`题库后台线程已退出（${code}）。`)); });
    worker.unref();
    return worker;
  }

  private fail(error: Error) {
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private call<K extends QuestionBankMethod>(method: K, ...args: QuestionBankArguments<K>): Promise<QuestionBankReply<K>> {
    if (this.failure || this.disposed || this.closing) return Promise.reject(this.failure ?? new Error("题库服务已关闭。"));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      try { this.ensureWorker().postMessage({ id, method, args }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  open(...args: QuestionBankArguments<"open">) { return this.call("open", ...args); }
  close() { return this.call("close"); }
  update(...args: QuestionBankArguments<"update">) { return this.call("update", ...args); }
  remove(...args: QuestionBankArguments<"remove">) { return this.call("remove", ...args); }
  search(...args: QuestionBankArguments<"search">) { return this.call("search", ...args); }
  searchIfChanged(...args: QuestionBankArguments<"searchIfChanged">) { return this.call("searchIfChanged", ...args); }
  overview(...args: QuestionBankArguments<"overview">) { return this.call("overview", ...args); }
  snapshot(...args: QuestionBankArguments<"snapshot">) { return this.call("snapshot", ...args); }
  thumbnail(...args: QuestionBankArguments<"thumbnail">) { return this.call("thumbnail", ...args); }
  entry(...args: QuestionBankArguments<"entry">) { return this.call("entry", ...args); }
  copies(...args: QuestionBankArguments<"copies">) { return this.call("copies", ...args); }
  readBasket() { return this.call("readBasket"); }
  writeBasket(...args: QuestionBankArguments<"writeBasket">) { return this.call("writeBasket", ...args); }
  documentsWithTags(...args: QuestionBankArguments<"documentsWithTags">) { return this.call("documentsWithTags", ...args); }
  readTagTree() { return this.call("readTagTree"); }
  writeTagTree(...args: QuestionBankArguments<"writeTagTree">) { return this.call("writeTagTree", ...args); }
  flush() { return this.call("flush"); }

  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.disposed || !this.worker) { this.disposed = true; return Promise.resolve(); }
    const worker = this.worker;
    return this.closing = this.call("shutdown").finally(async () => {
      this.disposed = true;
      this.fail(new Error("题库服务已关闭。"));
      await worker.terminate();
    });
  }
}
