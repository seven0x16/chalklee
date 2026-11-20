import { parentPort } from "node:worker_threads";
import { QuestionBankIndex } from "./questionIndex";
import { QUESTION_BANK_METHODS, type QuestionBankWorkerRequest, type QuestionBankWorkerMessage } from "./workerProtocol";

if (!parentPort) throw new Error("题库服务需要在后台线程运行。");
const port = parentPort;
const post = (message: QuestionBankWorkerMessage) => port.postMessage(message);
const index = new QuestionBankIndex({ changed: change => post({ change }) });
port.on("message", (request: QuestionBankWorkerRequest) => {
  void (async () => {
    try {
      if (!QUESTION_BANK_METHODS.includes(request.method)) throw new Error("未知的题库操作。");
      const result: unknown = await Reflect.apply(index[request.method], index, request.args);
      post({ id: request.id, result });
    } catch (error) { post({ id: request.id, error: error instanceof Error ? error.message : String(error) }); }
  })();
});
